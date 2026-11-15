import { Modal, Notice, Setting, type App } from "obsidian";
import { parseCard } from "@rlc/contract";
import { cardFilePath } from "@rlc/vault-core";
import type RlcPlugin from "../main";
import { newUuid } from "../core/id";
import type { CardContext } from "./card-modal";

export interface PracticeSeed {
  /** 从哪张精读卡片立项而来；为空表示从文献直接建。 */
  linkedCards: string[];
}

/** 实践卡：计划 → 过程（后补）→ 总结（后补）。 */
export class PracticeCardModal extends Modal {
  private readonly cardId = newUuid();
  private busy = false;

  private goal = "";
  private steps = "";
  private resources = "";
  private scheduledFor = "";
  private dueBy = "";
  private criteria = "";

  constructor(
    app: App,
    private readonly rlc: RlcPlugin,
    private readonly context: CardContext,
    private readonly seed: PracticeSeed,
  ) {
    super(app);
    this.scheduledFor = this.rlc.today();
  }

  override onOpen(): void {
    this.modalEl.addClass("rlc-modal");
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "新建实践卡" });
    const context = contentEl.createDiv({ cls: "rlc-context" });
    context.createSpan({ text: this.context.domain, cls: "rlc-chip" });
    context.createSpan({ text: "›", cls: "rlc-muted" });
    context.createSpan({ text: this.context.literatureTitle, cls: "rlc-chip" });

    contentEl.createEl("p", {
      text:
        this.seed.linkedCards.length > 0
          ? "这张实践卡会关联到刚才的精读卡片：先有 Aha，再立项。"
          : "从文献直接立项：计划先写清楚，过程和总结可以之后回来补。",
      cls: "rlc-hint",
    });

    this.areaRow("目标", "做完这件事，什么会不一样？", this.goal, (value) => {
      this.goal = value;
    }, 1);
    this.areaRow("步骤", "一行一步，按顺序写", this.steps, (value) => {
      this.steps = value;
    }, 4);
    this.areaRow("成功标准", "一行一条：怎么算做到了（至少一条）", this.criteria, (value) => {
      this.criteria = value;
    }, 2);
    this.areaRow("资源（可选）", "需要的人、材料、工具，一行一个", this.resources, (value) => {
      this.resources = value;
    }, 2);

    this.textRow("计划开始日", "YYYY-MM-DD，用于日历与提醒", this.scheduledFor, (value) => {
      this.scheduledFor = value;
    });
    this.textRow("截止日（可选）", "YYYY-MM-DD", this.dueBy, (value) => {
      this.dueBy = value;
    });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("保存实践卡").setCta().onClick(async () => {
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
    setting.addText((text) => text.setPlaceholder(desc).setValue(initial).onChange(setter));
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

  private lines(value: string): string[] {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private date(value: string): string | undefined {
    const trimmed = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
  }

  private async save(buttonEl: HTMLButtonElement): Promise<void> {
    if (this.busy) return;

    const goal = this.goal.trim();
    const steps = this.lines(this.steps);
    const criteria = this.lines(this.criteria);

    if (goal.length === 0) {
      new Notice("先写目标：做完这件事，什么会不一样？");
      return;
    }
    if (steps.length === 0) {
      new Notice("至少写一步：没有步骤的计划无法开始。");
      return;
    }
    if (criteria.length === 0) {
      new Notice("至少写一条成功标准，否则之后无法复盘。");
      return;
    }
    const scheduledFor = this.date(this.scheduledFor);
    if (this.scheduledFor.trim() && !scheduledFor) {
      new Notice("计划开始日要写成 YYYY-MM-DD，例如 2026-11-20。");
      return;
    }

    this.busy = true;
    buttonEl.disabled = true;
    buttonEl.setText("保存中…");

    try {
      const now = new Date().toISOString();
      const candidate = {
        schema: "pc-card@1",
        cardId: this.cardId,
        kind: "practice",
        domain: { name: this.context.domain, slug: this.context.domainSlug },
        title: goal.split(/\r?\n/)[0]?.slice(0, 120) ?? "实践卡",
        tags: [],
        plan: {
          goal,
          steps: steps.map((text) => ({ text, done: false })),
          resources: this.lines(this.resources),
          ...(scheduledFor ? { scheduledFor } : {}),
          ...(this.date(this.dueBy) ? { dueBy: this.date(this.dueBy) } : {}),
          successCriteria: criteria,
        },
        process: [],
        linkedCards: this.seed.linkedCards,
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

      const path = cardFilePath("practice", this.context.domain, this.context.folder, this.cardId);
      const file = await this.rlc.cards.writeCard(path, parsed.card);
      if (parsed.card.schema === "pc-card@1") {
        await this.rlc.practice.writePlanLine(parsed.card);
      }
      await this.rlc.cards.openFile(file);
      this.close();
    } catch (error) {
      new Notice(`保存失败：${(error as Error).message}`);
    } finally {
      this.busy = false;
      buttonEl.disabled = false;
      buttonEl.setText("保存实践卡");
    }
  }
}
