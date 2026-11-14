import { Modal, Notice, Setting } from "obsidian";
import { parseLiterature } from "@rlc/contract";
import { citekeyFor, domainSlug, literatureFolder, literatureNotePath, literatureTemplate } from "@rlc/vault-core";
import type RlcPlugin from "../main";
import { normalizeDoi, parseYear, splitAuthors } from "../core/normalize";

/**
 * 添加文献：领域下的一等实体。
 * DOI 与链接至少一个，否则不允许录入——无法核验的文献不进综述。
 */
export class LiteratureModal extends Modal {
  private domain: string;
  private title = "";
  private authors = "";
  private year = "";
  private reference = "";
  private busy = false;

  constructor(
    app: Modal["app"],
    private readonly rlc: RlcPlugin,
    private readonly domains: string[],
    initialDomain: string | undefined,
    private readonly onCreated?: (domain: string, citekey: string) => void,
  ) {
    super(app);
    this.domain = initialDomain ?? domains[0] ?? "";
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
    contentEl.createEl("h2", { text: "添加文献" });

    if (this.domains.length === 0) {
      contentEl.createEl("p", { text: "还没有领域。先新建一个领域，再把文献放进去。", cls: "rlc-hint" });
      new Setting(contentEl).addButton((button) =>
        button.setButtonText("新建领域").setCta().onClick(() => {
          this.close();
          this.rlc.openDomainModal();
        }),
      );
      return;
    }

    contentEl.createEl("p", {
      text: "文献会挂在「领域/文献/<citekey>/」下，之后的略读报告与精读卡片都放进这个目录。",
      cls: "rlc-hint",
    });

    new Setting(contentEl)
      .setName("所属领域")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(Object.fromEntries(this.domains.map((name) => [name, name])))
          .setValue(this.domain)
          .onChange((value) => {
            this.domain = value;
          }),
      );

    new Setting(contentEl)
      .setName("标题")
      .addText((text) =>
        text.setPlaceholder("单元设计：撬动课堂转型的一个支点").setValue(this.title).onChange((value) => {
          this.title = value;
        }),
      );

    new Setting(contentEl)
      .setName("作者")
      .setDesc("多人用顿号分隔；citekey 会优先用第一作者的拉丁名")
      .addText((text) =>
        text.setPlaceholder("钟启泉").setValue(this.authors).onChange((value) => {
          this.authors = value;
        }),
      );

    new Setting(contentEl)
      .setName("年份")
      .addText((text) =>
        text.setPlaceholder("2015").setValue(this.year).onChange((value) => {
          this.year = value;
        }),
      );

    new Setting(contentEl)
      .setName("DOI 或链接")
      .setDesc("二选一，必填")
      .addText((text) =>
        text
          .setPlaceholder("10.1234/abcd.2015.001 或 https://…")
          .setValue(this.reference)
          .onChange((value) => {
            this.reference = value;
          }),
      );

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("添加")
        .setCta()
        .onClick(async () => {
          await this.create(button.buttonEl);
        }),
    );
  }

  private async create(buttonEl: HTMLButtonElement): Promise<void> {
    if (this.busy) return;

    const title = this.title.trim();
    if (title.length === 0) {
      new Notice("文献标题不能为空");
      return;
    }

    const reference = this.reference.trim();
    const isUrl = /^https?:\/\//i.test(reference);
    const doi = !isUrl && reference.length > 0 ? normalizeDoi(reference) : undefined;
    const url = isUrl ? reference : undefined;

    if (!doi && !url) {
      new Notice("请填 DOI 或链接——无法核验的文献不进综述");
      return;
    }

    this.busy = true;
    buttonEl.disabled = true;
    try {
      const authors = splitAuthors(this.authors);
      const year = parseYear(this.year);
      const citekey = citekeyFor({ title, authors, year, doi });
      const now = new Date().toISOString();

      const parsed = parseLiterature({
        schema: "lit@1",
        citekey,
        domain: { name: this.domain, slug: domainSlug(this.domain) },
        title,
        authors,
        ...(year ? { year } : {}),
        ...(doi ? { doi } : {}),
        ...(url ? { url } : {}),
        status: "to_read",
        addedAt: now,
        updatedAt: now,
      });

      if (!parsed.ok) {
        const detail = parsed.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".") || "(根)"}：${issue.message}`)
          .join("\n");
        new Notice(`文献校验未通过：\n${detail}`);
        return;
      }

      // 文件夹用可读标题（截断），citekey 只写进 frontmatter。
      const baseFolder = literatureFolder(title, citekey);
      let folder = baseFolder;
      let path = literatureNotePath(this.domain, folder);
      let attempt = 2;
      while (await this.rlc.cards.exists(path)) {
        folder = `${baseFolder} (${attempt})`;
        path = literatureNotePath(this.domain, folder);
        attempt += 1;
        if (attempt > 50) {
          new Notice(`同名文献过多：${baseFolder}`);
          return;
        }
      }

      await this.rlc.cards.writeText(path, literatureTemplate(parsed.note));

      void this.rlc.translateTitleFor(path, parsed.note.title);

      this.close();
      new Notice(`已添加文献：${parsed.note.title}`);
      this.onCreated?.(this.domain, citekey);
    } catch (error) {
      new Notice(`添加失败：${(error as Error).message}`);
    } finally {
      this.busy = false;
      buttonEl.disabled = false;
    }
  }
}
