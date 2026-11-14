import { Modal, Notice, Setting } from "obsidian";
import { domainDir, literatureReviewPath } from "@rlc/vault-core";
import type RlcPlugin from "../main";

/**
 * 新建领域。
 *
 * 只负责建目录；综述由回调触发 AI 生成（见 main.generateDomainReview）。
 * 不再写「空模板」——用户点了新建，期望的是内容，不是一张白纸。
 */
export class DomainModal extends Modal {
  private name = "";
  private busy = false;

  constructor(
    app: Modal["app"],
    private readonly rlc: RlcPlugin,
    private readonly onCreated?: (domain: string) => void,
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
    contentEl.createEl("h2", { text: "新建领域" });
    contentEl.createEl("p", {
      text: "创建后会立刻调用 AI 生成该领域的文献综述，写到「领域/<名称>/文献综述.md」。",
      cls: "rlc-hint",
    });

    new Setting(contentEl)
      .setName("领域名称")
      .setDesc("如：课程与教学论、教育心理学")
      .addText((text) =>
        text.setPlaceholder("课程与教学论").setValue(this.name).onChange((value) => {
          this.name = value;
        }),
      );

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("创建并生成综述")
        .setCta()
        .onClick(async () => {
          await this.create(button.buttonEl);
        }),
    );
  }

  private async create(buttonEl: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    const name = this.name.trim();
    if (name.length === 0) {
      new Notice("领域名称不能为空");
      return;
    }

    this.busy = true;
    buttonEl.disabled = true;
    try {
      await this.rlc.cards.ensureFolder(domainDir(name));

      const path = literatureReviewPath(name);
      if (await this.rlc.cards.exists(path)) {
        new Notice(`领域「${name}」已存在，直接打开它的综述`);
        this.close();
        this.onCreated?.(name);
        return;
      }

      this.close();

      if (!this.rlc.ai.ready) {
        new Notice(`已创建领域「${name}」。还没配置 AI；配置好后点领域名即可生成综述。`);
        this.onCreated?.(name);
        return;
      }

      this.onCreated?.(name);
    } catch (error) {
      new Notice(`创建失败：${(error as Error).message}`);
    } finally {
      this.busy = false;
      buttonEl.disabled = false;
    }
  }
}
