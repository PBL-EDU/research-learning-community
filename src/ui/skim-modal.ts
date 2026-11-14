import { Modal, Notice, Setting, TFile } from "obsidian";
import {
  domainSlug,
  literatureNotePath,
  skimReportDocument,
  skimReportPath,
} from "@rlc/vault-core";
import type RlcPlugin from "../main";
import type { LiteratureSummary } from "../core/overview";
import { skimReportMessages } from "../core/prompts";
import { parseSkimVerdict, statusForDecision, stripSkimVerdict } from "../core/skim";

const DECISION_LABEL: Record<string, string> = {
  deep_read: "值得精读",
  skip: "跳过",
  undecided: "未定",
};

/**
 * 略读报告。
 *
 * 学生只需要贴一段摘要（文献笔记里的「## 摘要」会自动带出来），
 * AI 产出四节分析 + 结论，结论驱动文献状态机。
 */
export class SkimModal extends Modal {
  private busy = false;

  constructor(
    app: Modal["app"],
    private readonly rlc: RlcPlugin,
    private readonly literature: LiteratureSummary,
    private excerpt: string,
    private readonly onDone?: () => void,
  ) {
    super(app);
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

    contentEl.createEl("h2", { text: "略读报告" });
    const context = contentEl.createDiv({ cls: "rlc-context" });
    context.createSpan({ text: this.literature.domain, cls: "rlc-chip" });
    context.createSpan({ text: "›", cls: "rlc-muted" });
    context.createSpan({ text: this.literature.title, cls: "rlc-chip" });

    contentEl.createEl("p", {
      text: "贴摘要或正文片段。AI 只根据你给的材料判断，材料不足时会写「需看原文」，不会编内容。",
      cls: "rlc-hint",
    });

    const setting = new Setting(contentEl).setName("摘要 / 正文片段");
    setting.addTextArea((area) => {
      area.inputEl.rows = 8;
      area.inputEl.addClass("rlc-skim-input");
      area
        .setPlaceholder("粘贴文献摘要；如果文献笔记里已经写了「## 摘要」，这里会自动带出来")
        .setValue(this.excerpt)
        .onChange((value) => {
          this.excerpt = value;
        });
    });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("生成略读报告").setCta().onClick(async () => {
          await this.generate(button.buttonEl);
        }),
      )
      .addButton((button) =>
        button.setButtonText("取消").onClick(() => {
          this.close();
        }),
      );
  }

  private async generate(buttonEl: HTMLButtonElement): Promise<void> {
    if (this.busy) return;

    const excerpt = this.excerpt.trim();
    if (excerpt.length < 20) {
      new Notice("至少贴一段摘要或正文片段（20 字以上），否则只能瞎猜。");
      return;
    }

    this.busy = true;
    buttonEl.disabled = true;
    buttonEl.setText("生成中…");

    try {
      const raw = await this.rlc.ai.chat(
        skimReportMessages({
          paper: {
            title: this.literature.title,
            authors: this.literature.authors,
            year: this.literature.year,
            doi: this.literature.doi,
          },
          abstract: excerpt,
        }),
        { maxTokens: 2000 },
      );

      const verdict = parseSkimVerdict(raw);
      const now = new Date().toISOString();

      const document = skimReportDocument({
        domainName: this.literature.domain,
        domainSlug: domainSlug(this.literature.domain),
        citekey: this.literature.citekey,
        decision: verdict.decision,
        confidence: verdict.confidence,
        createdAt: now,
        body: stripSkimVerdict(raw),
        model: this.rlc.settings.aiModel,
      });

      const path = skimReportPath(this.literature.domain, this.literature.folder);
      await this.rlc.cards.writeText(path, document);

      // 结论驱动文献状态机。
      const nextStatus = statusForDecision(verdict.decision);
      if (nextStatus) {
        const noteFile = this.app.vault.getAbstractFileByPath(
          literatureNotePath(this.literature.domain, this.literature.folder),
        );
        if (noteFile instanceof TFile) {
          await this.rlc.cards.patchFile(noteFile, { status: nextStatus, updatedAt: now });
        }
      }

      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.rlc.cards.openFile(file);

      this.close();
      new Notice(
        verdict.decision === "undecided"
          ? "报告已生成，但没解析到结论。文献状态保持不变。"
          : `报告已生成：${DECISION_LABEL[verdict.decision] ?? verdict.decision}`,
      );
      this.onDone?.();
    } catch (error) {
      new Notice(`生成失败：${(error as Error).message}`);
    } finally {
      this.busy = false;
      buttonEl.disabled = false;
    }
  }
}
