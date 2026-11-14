import { Modal, Setting } from "obsidian";
import { STATUS_LABEL } from "@rlc/vault-core";
import type RlcPlugin from "../main";
import type { LiteratureSummary } from "../core/overview";

/** 没有上下文时选一篇文献，再进入卡片表单。 */
export class LiteraturePickerModal extends Modal {
  constructor(
    app: Modal["app"],
    private readonly rlc: RlcPlugin,
    private readonly literatures: LiteratureSummary[],
    private readonly onPick: (item: LiteratureSummary) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "选择文献" });

    if (this.literatures.length === 0) {
      contentEl.createEl("p", {
        text: "还没有文献。先建领域，再添加文献，然后才能写精读卡片。",
        cls: "rlc-hint",
      });
      new Setting(contentEl)
        .addButton((button) =>
          button.setButtonText("新建领域").onClick(() => {
            this.close();
            this.rlc.openDomainModal();
          }),
        )
        .addButton((button) =>
          button.setButtonText("添加文献").setCta().onClick(() => {
            this.close();
            this.rlc.openLiteratureModal();
          }),
        );
      return;
    }

    const groups = new Map<string, LiteratureSummary[]>();
    for (const item of this.literatures) {
      const list = groups.get(item.domain) ?? [];
      list.push(item);
      groups.set(item.domain, list);
    }

    for (const [domain, items] of groups) {
      contentEl.createEl("h4", { text: domain });
      for (const item of items) {
        const meta = [
          item.year ? String(item.year) : "",
          item.authors.join("、"),
          STATUS_LABEL[item.status],
          `${item.cardCount} 张卡片`,
        ]
          .filter(Boolean)
          .join(" · ");

        new Setting(contentEl)
          .setName(item.title)
          .setDesc(meta)
          .addButton((button) =>
            button.setButtonText("写卡片").setCta().onClick(() => {
              this.close();
              this.onPick(item);
            }),
          );
      }
    }
  }
}
