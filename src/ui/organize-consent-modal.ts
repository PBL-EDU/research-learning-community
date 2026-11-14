import { App, Modal } from "obsidian";

/**
 * 首次整理前的知情同意。
 *
 * 文献整理会把 PDF 原文上传到用户自己配置的 AI 服务商做 OCR。
 * 这是一条新的数据流出，必须让用户明确点一次，不能默认同意。
 */
export class OrganizeConsentModal extends Modal {
  constructor(
    app: App,
    private readonly onAccept: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "整理前，先确认一件事" });

    contentEl.createEl("p", {
      text: "文献整理会把文献文件夹里的「原文.pdf」上传到你在设置里配置的 AI 服务商（默认 DeepSeek），用来识别文字。",
    });
    contentEl.createEl("p", {
      text: "只上传这一篇 PDF；你的卡片、笔记、Aha 都不会上传。",
    });
    contentEl.createEl("p", {
      text: "费用大致是：OCR 约 ¥0.015/页，加上整理与翻译的对话费用，一篇 10 页英文论文约 ¥0.7–1.2。",
      cls: "setting-item-description",
    });

    const actions = contentEl.createDiv({ cls: "rlc-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());

    const accept = actions.createEl("button", {
      text: "同意并继续",
      cls: "mod-cta",
    });
    accept.addEventListener("click", () => {
      this.close();
      this.onAccept();
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
