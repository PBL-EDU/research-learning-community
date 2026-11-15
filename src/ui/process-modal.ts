import { Modal, Notice, Setting, type App, type TFile } from "obsidian";
import type { PracticeCardV1 } from "@rlc/contract";
import type RlcPlugin from "../main";
import { newUuid } from "../core/id";

/** 记录一条过程：写入每日笔记，并更新卡片缓存。 */
export class ProcessRecordModal extends Modal {
  private busy = false;
  private saved = false;
  private what = "";
  private evidence = "";
  private obstacle = "";
  private adjust = "";

  constructor(
    app: App,
    private readonly rlc: RlcPlugin,
    private readonly card: PracticeCardV1,
    private readonly cardFile: TFile,
    private readonly onDone: () => void,
    private readonly onCancel?: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("rlc-modal");
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.saved) this.onCancel?.();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "记录今天" });
    contentEl.createEl("p", {
      text: `实践：${this.card.title}`,
      cls: "rlc-hint",
    });

    this.areaRow("做了什么", "一句话说清今天推进到哪", this.what, (value) => {
      this.what = value;
    }, 2);
    this.areaRow("证据（可选）", "录音、截图、链接、别人能验证的东西", this.evidence, (value) => {
      this.evidence = value;
    }, 1);
    this.areaRow("阻碍（可选）", "卡在哪", this.obstacle, (value) => {
      this.obstacle = value;
    }, 1);
    this.areaRow("调整（可选）", "下次怎么改", this.adjust, (value) => {
      this.adjust = value;
    }, 1);

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("保存记录").setCta().onClick(async () => {
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
    const what = this.what.trim();
    if (what.length === 0) {
      new Notice("先写一句「做了什么」。");
      return;
    }

    this.busy = true;
    buttonEl.disabled = true;
    buttonEl.setText("保存中…");

    try {
      await this.rlc.practice.writeProcessEntry(this.card, this.cardFile, {
        entryId: newUuid(),
        date: new Date().toISOString(),
        what,
        ...(this.evidence.trim() ? { evidence: this.evidence.trim() } : {}),
        ...(this.obstacle.trim() ? { obstacle: this.obstacle.trim() } : {}),
        ...(this.adjust.trim() ? { adjust: this.adjust.trim() } : {}),
      });
      this.saved = true;
      this.onDone();
      this.close();
    } catch (error) {
      new Notice(`保存失败：${(error as Error).message}`);
    } finally {
      this.busy = false;
      buttonEl.disabled = false;
      buttonEl.setText("保存记录");
    }
  }
}
