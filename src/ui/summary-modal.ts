import { Modal, Notice, Setting, type App, type TFile } from "obsidian";
import type { PracticeCardV1 } from "@rlc/contract";
import type RlcPlugin from "../main";

/** 实践总结：结果 → 变化 → 下次怎么改。 */
export class PracticeSummaryModal extends Modal {
  private busy = false;
  private outcome = "";
  private delta = "";
  private nextTime = "";

  constructor(
    app: App,
    private readonly rlc: RlcPlugin,
    private readonly card: PracticeCardV1,
    private readonly cardFile: TFile,
    private readonly onDone: () => void,
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

    contentEl.createEl("h2", { text: "写实践总结" });
    contentEl.createEl("p", {
      text: `实践：${this.card.title} · 成功标准：${this.card.plan.successCriteria.join("；")}`,
      cls: "rlc-hint",
    });

    this.areaRow("结果", "实际发生了什么", this.outcome, (value) => {
      this.outcome = value;
    }, 2);
    this.areaRow("变化（可选）", "和计划相比，哪里不一样", this.delta, (value) => {
      this.delta = value;
    }, 2);
    this.areaRow("下次怎么改（可选）", "如果再来一次", this.nextTime, (value) => {
      this.nextTime = value;
    }, 2);

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("保存总结").setCta().onClick(async () => {
          await this.save(button.buttonEl);
        }),
      )
      .settingEl.addClass("rlc-actions");
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

  private async save(buttonEl: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    const outcome = this.outcome.trim();
    if (outcome.length === 0) {
      new Notice("先写结果：实际发生了什么。");
      return;
    }

    this.busy = true;
    buttonEl.disabled = true;
    buttonEl.setText("保存中…");

    try {
      await this.rlc.practice.saveSummary(this.cardFile, {
        outcome,
        ...(this.delta.trim() ? { delta: this.delta.trim() } : {}),
        ...(this.nextTime.trim() ? { nextTime: this.nextTime.trim() } : {}),
      });
      this.onDone();
      this.close();
    } catch (error) {
      new Notice(`保存失败：${(error as Error).message}`);
    } finally {
      this.busy = false;
      buttonEl.disabled = false;
      buttonEl.setText("保存总结");
    }
  }
}
