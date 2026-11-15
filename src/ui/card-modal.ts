import { Modal, Notice, Setting, TFile } from "obsidian";
import { parseCard } from "@rlc/contract";
import { assetsDir, cardFilePath, literatureNotePath, shortId } from "@rlc/vault-core";
import type RlcPlugin from "../main";
import { newUuid } from "../core/id";
import { deepReadDraftMessages, parseDraftResult } from "../core/prompts";

/** 卡片的归属上下文：领域 + 文献。新建卡片必须从一篇文献进来。 */
export interface CardContext {
  domain: string;
  domainSlug: string;
  citekey: string;
  /** 文献文件夹名，卡片与资产路径都基于它。 */
  folder: string;
  literatureTitle: string;
  authors: string[];
  year?: number;
  doi?: string;
  url?: string;
}

type Level = "高" | "中" | "低";

interface DraftState {
  title: string;
  quote: string;
  experience: string;
  insight: string;
  inspiration: string;
  meaning: string;
  level: Level;
  conceptNote: string;
  action: string;
  trigger: string;
  metric: string;
  notes: string;
}

export class DeepReadCardModal extends Modal {
  private readonly cardId = newUuid();
  private busy = false;

  private readonly state: DraftState = {
    title: "",
    quote: "",
    experience: "",
    insight: "",
    inspiration: "",
    meaning: "",
    level: "中",
    conceptNote: "",
    action: "",
    trigger: "",
    metric: "",
    notes: "",
  };

  constructor(
    app: Modal["app"],
    private readonly rlc: RlcPlugin,
    private readonly context: CardContext,
    private readonly onSaved?: () => void,
    private readonly initialQuote?: string,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("rlc-modal");
    // 优先用调用方显式传入的选区（编辑器右键），其次读当前活动编辑器。
    const explicit = this.initialQuote?.trim();
    const selection = explicit || this.app.workspace.activeEditor?.editor?.getSelection()?.trim();
    if (selection && selection.length <= 300 && this.state.quote.trim().length === 0) {
      this.state.quote = selection;
    }
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "新建精读卡片" });
    const context = contentEl.createDiv({ cls: "rlc-context" });
    context.createSpan({ text: this.context.domain, cls: "rlc-chip" });
    context.createSpan({ text: "›", cls: "rlc-muted" });
    context.createSpan({ text: this.context.literatureTitle, cls: "rlc-chip" });

    contentEl.createEl("p", {
      text: "Aha 只能由你自己产生。AI 起草只是把你的零散笔记整理成句子，草稿要逐条改成你自己的话。",
      cls: "rlc-hint",
    });

    this.textRow("卡片标题", "一句话说清这张卡片的主张", this.state.title, (value) => {
      this.state.title = value;
    });

    contentEl.createEl("h4", { text: "Aha 五点" });
    this.areaRow("原文摘录", "只粘贴原文，不改写；上限 300 字（版权红线）", this.state.quote, (value) => {
      this.state.quote = value;
    }, 2);
    this.areaRow("我的体验", "一个具体的生活/学习场景，不要泛泛而谈", this.state.experience, (value) => {
      this.state.experience = value;
    }, 2);
    this.areaRow("Aha", "它推翻了什么默认假设？「原来我以为…，现在发现…」", this.state.insight, (value) => {
      this.state.insight = value;
    }, 2);
    this.areaRow("新启发", "由此产生的新想法或新问题", this.state.inspiration, (value) => {
      this.state.inspiration = value;
    }, 2);
    this.areaRow("对生活的意义", "改变了什么观念，或让你能做什么", this.state.meaning, (value) => {
      this.state.meaning = value;
    }, 2);

    new Setting(contentEl)
      .setName("这个 Aha 的分量")
      .setDesc("决定它值不值得进一步做成实践、科普或海报")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ 高: "高", 中: "中", 低: "低" })
          .setValue(this.state.level)
          .onChange((value) => {
            this.state.level = value as Level;
          }),
      );

    contentEl.createEl("h4", { text: "AI 辅助" });
    this.areaRow("零散笔记（可选）", "想到什么写什么，AI 会据此起草上面五段", this.state.notes, (value) => {
      this.state.notes = value;
    }, 2);

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("AI 起草思考部分").onClick(async () => {
          await this.draftWithAi(button.buttonEl);
        }),
      )
      .settingEl.addClass("rlc-actions");

    contentEl.createEl("h4", { text: "行动指导" });
    this.textRow("行动", "下周就能做的一件具体事", this.state.action, (value) => {
      this.state.action = value;
    });
    this.textRow("触发时机", "什么时候做", this.state.trigger, (value) => {
      this.state.trigger = value;
    });
    this.textRow("衡量标准", "怎么算做到了", this.state.metric, (value) => {
      this.state.metric = value;
    });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("保存卡片").setCta().onClick(async () => {
          await this.save(button.buttonEl);
        }),
      )
      .settingEl.addClass("rlc-actions");

  }

  private textRow(
    name: string,
    desc: string,
    initial: string,
    setter: (value: string) => void,
  ): void {
    const setting = new Setting(this.contentEl).setName(name);
    if (desc.length > 0) setting.setDesc(desc);
    setting.settingEl.addClass("rlc-field-stacked");
    setting.addText((text) =>
      text.setPlaceholder(desc).setValue(initial).onChange((value) => setter(value)),
    );
  }

  private areaRow(
    name: string,
    desc: string,
    initial: string,
    setter: (value: string) => void,
    rows: number,
  ): void {
    const setting = new Setting(this.contentEl).setName(name);
    if (desc.length > 0) setting.setDesc(desc);
    setting.settingEl.addClass("rlc-field-stacked");
    setting.addTextArea((area) => {
      area.inputEl.rows = rows;
      area.setPlaceholder(desc).setValue(initial).onChange((value) => setter(value));
    });
  }

  private async draftWithAi(buttonEl: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    if (this.state.quote.trim().length === 0) {
      new Notice("先粘贴原文摘录。AI 不会替你编造原文——这是硬规则。");
      return;
    }

    this.busy = true;
    buttonEl.disabled = true;
    buttonEl.setText("起草中…");
    try {
      const draft = await this.rlc.ai.chatJson(
        deepReadDraftMessages({
          paper: {
            title: this.context.literatureTitle,
            authors: this.context.authors,
            year: this.context.year,
            doi: this.context.doi,
          },
          quote: this.state.quote.trim(),
          notes: this.state.notes,
          domain: this.context.domain,
        }),
        parseDraftResult,
      );

      this.state.experience = draft.experience;
      this.state.insight = draft.insight;
      this.state.inspiration = draft.inspiration;
      this.state.meaning = draft.meaning;
      this.state.level = draft.conceptLevel;
      this.state.conceptNote = draft.conceptNote;
      const first = draft.actions[0];
      if (first) {
        this.state.action = first.action;
        this.state.trigger = first.trigger ?? "";
        this.state.metric = first.metric ?? "";
      }
      this.render();
      new Notice("已起草。请逐条改成你自己的话，AI 的句子不能直接当 Aha。");
    } catch (error) {
      new Notice(`AI 起草失败：${(error as Error).message}`);
    } finally {
      this.busy = false;
      buttonEl.disabled = false;
    }
  }

  private async save(buttonEl: HTMLButtonElement): Promise<void> {
    if (this.busy) return;

    this.busy = true;
    buttonEl.disabled = true;
    buttonEl.setText("保存中…");

    try {
      const now = new Date().toISOString();
      const candidate = {
        schema: "dr-card@1",
        cardId: this.cardId,
        kind: "deep_read",
        domain: { name: this.context.domain, slug: this.context.domainSlug },
        title: this.state.title.trim(),
        tags: [],
        source: {
          type: "literature",
          citekey: this.context.citekey,
          title: this.context.literatureTitle,
          authors: this.context.authors,
          ...(this.context.year ? { year: this.context.year } : {}),
          ...(this.context.doi ? { doi: this.context.doi } : {}),
          ...(!this.context.doi && this.context.url ? { url: this.context.url } : {}),
          license: "unknown",
        },
        aha: {
          quote: this.state.quote.trim(),
          experience: this.state.experience.trim(),
          insight: this.state.insight.trim(),
          inspiration: this.state.inspiration.trim(),
          meaning: this.state.meaning.trim(),
        },
        conceptValue: {
          level: this.state.level,
          // 合并后不再单独填说明：直接用 Aha 本身作为「改变了哪个认知」的记录。
          note: this.state.insight.trim() || this.state.title.trim() || "（待补充）",
        },
        actionGuidance: [
          {
            action: this.state.action.trim(),
            ...(this.state.trigger.trim() ? { trigger: this.state.trigger.trim() } : {}),
            ...(this.state.metric.trim() ? { metric: this.state.metric.trim() } : {}),
          },
        ],
        visuals: [],
        createdAt: now,
        updatedAt: now,
      };

      const parsed = parseCard(candidate);
      if (!parsed.ok) {
        const detail = parsed.issues
          .slice(0, 4)
          .map((issue) => `${issue.path.join(".") || "(根)"}：${issue.message}`)
          .join("\n");
        new Notice(`校验未通过：\n${detail}`);
        return;
      }

      const path = cardFilePath("deep_read", this.context.domain, this.context.folder, this.cardId);
      const file = await this.rlc.cards.writeCard(path, parsed.card);

      // 文献状态推进到「已出卡片」，总览才能显示进度。
      const notePath = literatureNotePath(this.context.domain, this.context.folder);
      const noteFile = this.app.vault.getAbstractFileByPath(notePath);
      if (noteFile instanceof TFile) {
        await this.rlc.cards.patchFile(noteFile, { status: "deep_read", updatedAt: now });
      }

      await this.rlc.cards.openFile(file);
      this.close();
      new Notice(`卡片已保存：${path}`);
      this.onSaved?.();
    } catch (error) {
      new Notice(`保存失败：${(error as Error).message}`);
    } finally {
      this.busy = false;
      buttonEl.disabled = false;
    }
  }
}
