import { Modal, Notice, Setting, TFile, type App } from "obsidian";
import type { AnyCardV1, PromoVariant } from "@rlc/contract";
import { assetsDir, shortId, splitFrontmatter } from "@rlc/vault-core";
import type RlcPlugin from "../main";
import type { AudienceProfile } from "../settings";
import {
  generatePromo,
  parsePromoVariants,
  promoPathForCard,
  serializePromoVariants,
} from "../core/promo";
import {
  composePoster,
  generateIllustration,
  posterPrompt,
  posterTextFrom,
} from "../core/poster";

/**
 * 海报 = 文案（科普版）→ 插画 → 排版，一个入口走完。
 *
 * 没有「科普」独立按钮：生成文案只是海报流程的第一步；
 * 文案存在侧车里，可编辑、可多读者版本，发布时随卡片上传。
 */
export class PosterModal extends Modal {
  private variants: PromoVariant[] = [];
  private selected = new Set<string>();
  private activeIndex = 0;
  private busy = false;
  private previewPath: string | null = null;

  constructor(
    app: App,
    private readonly rlc: RlcPlugin,
    private readonly file: TFile,
    private readonly card: AnyCardV1,
    private readonly markdown: string,
    private readonly onSaved: () => void,
  ) {
    super(app);
  }

  override async onOpen(): Promise<void> {
    this.variants = parsePromoVariants(
      await this.rlc.cards.readTextPath(promoPathForCard(this.file.path)),
    );
    this.previewPath = this.variants[0]?.figureImagePath ?? null;

    const profiles = this.profiles();
    if (profiles[0]) this.selected.add(profiles[0].name);
    for (const variant of this.variants) this.selected.add(variant.audienceName);

    this.render();
  }

  override onClose(): void {
    void this.persist();
    this.contentEl.empty();
  }

  private profiles(): AudienceProfile[] {
    return this.rlc.settings.audienceProfiles.filter((profile) => profile.name.trim().length > 0);
  }

  private cardBody(): string {
    return splitFrontmatter(this.markdown).body;
  }

  private sourceLine(): string {
    if (this.card.schema !== "dr-card@1") return "";
    return [
      this.card.source.title,
      this.card.source.year ? String(this.card.source.year) : "",
      this.card.source.doi ?? "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  private footerLeft(): string {
    if (this.card.schema === "dr-card@1") {
      const authors = this.card.source.authors ?? [];
      const year = this.card.source.year ? ` (${this.card.source.year})` : "";
      if (authors[0]) return `${authors[0]}${year}`;
    }
    return "学习笔记";
  }

  private async persist(): Promise<void> {
    if (this.variants.length === 0) return;
    await this.rlc.cards.writeText(
      promoPathForCard(this.file.path),
      serializePromoVariants(this.variants),
    );
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("rlc-modal");
    contentEl.createEl("h2", { text: "生成海报" });
    contentEl.createEl("p", {
      text: "一步走完：按读者画像生成文案 → seedream 画插画 → 本地排版成 1080×1440。",
      cls: "rlc-hint",
    });

    const profiles = this.profiles();
    if (profiles.length === 0) {
      contentEl.createEl("p", {
        text: "还没有读者画像。先到「设置 → 研究性学习社区 → 我的读者」添加一条。",
        cls: "rlc-hint",
      });
      return;
    }

    // 第一步：选读者
    contentEl.createEl("h3", { text: "1. 写给谁" });
    for (const profile of profiles) {
      new Setting(contentEl)
        .setName(profile.name)
        .setDesc(profile.description || "无描述")
        .addToggle((toggle) =>
          toggle.setValue(this.selected.has(profile.name)).onChange((value) => {
            if (value) this.selected.add(profile.name);
            else this.selected.delete(profile.name);
          }),
        );
    }

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText(this.busy ? "生成中…" : this.variants.length > 0 ? "重新生成文案" : "生成文案")
        .setCta()
        .setDisabled(this.busy)
        .onClick(() => void this.generateCopy()),
    );

    if (this.variants.length === 0) return;

    // 第二步：确认文案（可编辑）
    contentEl.createEl("h3", { text: "2. 确认文案" });

    const tabs = contentEl.createDiv({ cls: "rlc-context" });
    this.variants.forEach((variant, index) => {
      const chip = tabs.createEl("button", {
        text: variant.audienceName,
        cls: index === this.activeIndex ? "rlc-btn rlc-btn-primary" : "rlc-btn",
      });
      chip.addEventListener("click", () => {
        this.activeIndex = index;
        this.previewPath = this.variants[index]?.figureImagePath ?? null;
        this.render();
      });
    });

    const active = this.variants[this.activeIndex];
    if (!active) return;

    const editor = contentEl.createDiv({ cls: "rlc-cand" });
    const main = editor.createDiv({ cls: "rlc-cand-main" });

    main.createEl("div", { text: "标题", cls: "rlc-cand-title" });
    const titleInput = main.createEl("input", { type: "text", cls: "rlc-skim-input" });
    titleInput.value = active.title;
    titleInput.addEventListener("input", () => {
      active.title = titleInput.value;
    });

    main.createEl("div", { text: "正文（海报会取前 5 行）", cls: "rlc-cand-title" });
    const bodyInput = main.createEl("textarea", { cls: "rlc-skim-input" });
    bodyInput.value = active.bodyMd;
    bodyInput.rows = 6;
    bodyInput.addEventListener("input", () => {
      active.bodyMd = bodyInput.value;
    });

    // 第三步：出海报
    contentEl.createEl("h3", { text: "3. 生成海报" });
    new Setting(contentEl)
      .setName(this.busy ? "处理中…" : "插画 + 排版")
      .setDesc(
        this.rlc.settings.imageApiKey
          ? "用 seedream 画插画，文字在本地排版。"
          : "未配置生图 Key，本次只做纯文字排版。",
      )
      .addButton((button) =>
        button
          .setButtonText("生成海报")
          .setCta()
          .setDisabled(this.busy)
          .onClick(() => void this.generatePoster(active)),
      );

    if (this.previewPath) {
      const img = contentEl.createEl("img", {
        cls: "rlc-poster-preview",
        attr: {
          src: this.app.vault.adapter.getResourcePath(this.previewPath),
          alt: "海报预览",
        },
      });
      img.style.maxWidth = "100%";
      img.style.maxHeight = "460px";
      img.style.borderRadius = "10px";
      img.style.display = "block";
      img.style.margin = "8px auto";
    }
  }

  private async generateCopy(): Promise<void> {
    if (this.busy) return;
    const profiles = this.profiles().filter((profile) => this.selected.has(profile.name));
    if (profiles.length === 0) {
      new Notice("至少选一个读者画像");
      return;
    }

    this.busy = true;
    this.render();

    try {
      const generated: PromoVariant[] = [];
      for (const profile of profiles) {
        new Notice(`正在为「${profile.name}」写文案…`, 0);
        generated.push(
          await generatePromo(this.rlc.ai, {
            cardTitle: this.card.title,
            cardBody: this.cardBody(),
            sourceLine: this.sourceLine(),
            profile,
          }),
        );
      }
      this.variants = generated.slice(0, 3);
      this.activeIndex = 0;
      this.previewPath = null;
      await this.persist();
      new Notice("文案已生成，可以按需修改后出海报");
    } catch (error) {
      new Notice(`生成文案失败：${(error as Error).message}`);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async generatePoster(variant: PromoVariant): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();

    const progress = new Notice("正在生成插画…", 0);
    try {
      const settings = this.rlc.settings;
      let illustration: ArrayBuffer | null = null;

      if (settings.imageApiKey) {
        illustration = await generateIllustration(settings, posterPrompt(variant));
        progress.setMessage("正在排版海报…");
      } else {
        new Notice("未配置生图 Key，本次只做文字排版（无插画）");
      }

      const composed = await composePoster(
        illustration,
        posterTextFrom(variant, {
          label: `写给 ${variant.audienceName}`,
          footerLeft: this.footerLeft(),
        }),
      );

      const parts = this.file.path.split("/");
      const domain = parts[1] ?? "";
      const folder = parts[3] ?? "";
      const path = await this.rlc.cards.writeAsset(
        assetsDir(domain, folder),
        `${shortId(this.card.cardId)}-poster.jpg`,
        composed,
      );

      variant.figureImagePath = path;
      await this.persist();

      this.previewPath = path;
      progress.hide();
      new Notice(`海报已生成：${path}`);
      this.onSaved();
    } catch (error) {
      progress.hide();
      new Notice(`生成海报失败：${(error as Error).message}`);
    } finally {
      this.busy = false;
      this.render();
    }
  }
}
