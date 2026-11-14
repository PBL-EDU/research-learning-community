import { ItemView, TFile, type WorkspaceLeaf } from "obsidian";
import { domainSlug, literatureReviewPath, STATUS_LABEL } from "@rlc/vault-core";
import { buildOverview, formatDay } from "../core/overview";
import { isReviewEmpty } from "../core/review";
import type RlcPlugin from "../main";
import type { CardContext } from "./card-modal";

export const VIEW_TYPE_RLC_OVERVIEW = "rlc-overview";

/**
 * 右侧栏总览：领域 → 文献 → 卡片。
 *
 * 交互原则：动作挂在它作用的层级上——
 * 领域行有「生成综述 / ＋文献」，文献行有「略读 / ＋卡片」，卡片行有「发布」。
 * 顶部只保留「＋领域」，因为领域是最顶层。
 *
 * 折叠：领域与文献都可以收起，状态存在 settings 里（见 RlcSettings）。
 * 默认文献在卡片 > 1 张时折叠——第一篇文献的卡片直接可见，文献多了自动收敛。
 */
export class ResearchOverviewView extends ItemView {
  private refreshTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly rlc: RlcPlugin,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_RLC_OVERVIEW;
  }

  override getDisplayText(): string {
    return "研究性学习总览";
  }

  override getIcon(): string {
    return "notebook-pen";
  }

  override async onOpen(): Promise<void> {
    const rerender = (): void => this.scheduleRender();
    this.registerEvent(this.app.vault.on("modify", rerender));
    this.registerEvent(this.app.vault.on("create", rerender));
    this.registerEvent(this.app.vault.on("delete", rerender));
    this.registerEvent(this.app.vault.on("rename", rerender));
    this.registerEvent(this.app.metadataCache.on("changed", rerender));
    await this.render();
  }

  override async onClose(): Promise<void> {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  private scheduleRender(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.render();
    }, 350);
  }

  private async toggleDomain(name: string): Promise<void> {
    const settings = this.rlc.settings;
    if (settings.collapsedDomains.includes(name)) {
      settings.collapsedDomains = settings.collapsedDomains.filter((item) => item !== name);
    } else {
      settings.collapsedDomains = [...settings.collapsedDomains, name];
    }
    await this.rlc.saveSettings();
    await this.render();
  }

  private async toggleLiterature(notePath: string, currentlyOpen: boolean): Promise<void> {
    this.rlc.settings.literatureOpen[notePath] = currentlyOpen ? "closed" : "open";
    await this.rlc.saveSettings();
    await this.render();
  }

  private async collapseAll(overview: ReturnType<typeof buildOverview>): Promise<void> {
    const settings = this.rlc.settings;
    settings.collapsedDomains = overview.domains.map((domain) => domain.domain);
    for (const domain of overview.domains) {
      for (const literature of domain.literatures) {
        settings.literatureOpen[literature.notePath] = "closed";
      }
    }
    await this.rlc.saveSettings();
    await this.render();
  }

  private async expandAll(): Promise<void> {
    const settings = this.rlc.settings;
    settings.collapsedDomains = [];
    settings.literatureOpen = {};
    await this.rlc.saveSettings();
    await this.render();
  }

  private async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("rlc-overview");

    const cards = this.rlc.index.listCards();
    const literatures = this.rlc.index.listLiteratures();
    const domainsOnDisk = await this.rlc.index.listDomains();
    const overview = buildOverview(cards, literatures, domainsOnDisk);

    // 待发布卡片：折叠的文献行上也要能看见「待发布 N」。
    const pendingPaths = new Set(await this.rlc.publisher.outboxCardPaths());

    this.renderHeader(root, overview);
    this.renderStats(root, overview);

    if (pendingPaths.size > 0) {
      const row = root.createDiv({ cls: "rlc-pending" });
      row.createSpan({ text: `待发布 ${pendingPaths.size} 张` });
      const retry = row.createEl("button", { text: "重试", cls: "rlc-btn rlc-btn-ghost" });
      retry.addEventListener("click", () => void this.rlc.retryOutbox());
    }

    if (overview.domains.length === 0) {
      this.renderEmpty(root);
      return;
    }

    for (const domain of overview.domains) {
      await this.renderDomain(root, domain, pendingPaths);
    }
  }

  private renderHeader(root: HTMLElement, overview: ReturnType<typeof buildOverview>): void {
    const header = root.createDiv({ cls: "rlc-header" });
    const left = header.createDiv({ cls: "rlc-header-left" });
    left.createDiv({ text: "研究性学习", cls: "rlc-title" });
    left.createDiv({ text: "总览", cls: "rlc-title-sub" });

    const right = header.createDiv({ cls: "rlc-header-right" });
    const settings = this.rlc.settings;
    const name = settings.bindName || settings.authorName || "我";
    const avatar = right.createDiv({ cls: "rlc-avatar" });
    avatar.setText(name.slice(0, 1));
    right.createDiv({
      text: settings.bindHandle ? name : "未绑定",
      cls: "rlc-identity",
      title: settings.bindHandle
        ? `${settings.bindName}（${settings.bindHandle}）· ${settings.bindOrgName || settings.bindOrg}`
        : "在设置里用邀请码绑定身份",
    });

    const collapse = right.createEl("button", {
      text: "收起",
      cls: "rlc-btn rlc-btn-small",
      attr: { "aria-label": "全部收起" },
    });
    collapse.addEventListener("click", () => void this.collapseAll(overview));

    const expand = right.createEl("button", {
      text: "展开",
      cls: "rlc-btn rlc-btn-small",
      attr: { "aria-label": "全部展开" },
    });
    expand.addEventListener("click", () => void this.expandAll());

    const add = right.createEl("button", {
      text: "＋ 领域",
      cls: "rlc-btn rlc-btn-primary",
    });
    add.addEventListener("click", () => this.rlc.openDomainModal());
  }

  private renderStats(root: HTMLElement, overview: ReturnType<typeof buildOverview>): void {
    const stats = root.createDiv({ cls: "rlc-stats" });
    const item = (label: string, value: number): void => {
      const box = stats.createDiv({ cls: "rlc-stat" });
      box.createDiv({ text: String(value), cls: "rlc-stat-value" });
      box.createDiv({ text: label, cls: "rlc-stat-label" });
    };
    item("领域", overview.domainTotal);
    item("文献", overview.literatureTotal);
    item("卡片", overview.cardTotal);
    item("精读", overview.deepRead);
  }

  private renderEmpty(root: HTMLElement): void {
    const empty = root.createDiv({ cls: "rlc-empty" });
    empty.createDiv({ text: "还没有领域", cls: "rlc-empty-title" });
    empty.createDiv({
      text: "先建一个领域，AI 会帮你起草这个领域的文献综述。",
      cls: "rlc-empty-text",
    });
    const button = empty.createEl("button", {
      text: "新建领域",
      cls: "rlc-btn rlc-btn-primary",
    });
    button.addEventListener("click", () => this.rlc.openDomainModal());
  }

  private async renderDomain(
    root: HTMLElement,
    domain: ReturnType<typeof buildOverview>["domains"][number],
    pendingPaths: Set<string>,
  ): Promise<void> {
    const card = root.createDiv({ cls: "rlc-domain-card" });
    const collapsed = this.rlc.settings.collapsedDomains.includes(domain.domain);
    if (collapsed) card.addClass("rlc-domain-collapsed");

    const head = card.createDiv({ cls: "rlc-domain-head" });

    const caret = head.createEl("button", {
      text: collapsed ? "▸" : "▾",
      cls: "rlc-caret",
      attr: { "aria-label": collapsed ? "展开领域" : "收起领域", "aria-expanded": String(!collapsed) },
    });
    caret.addEventListener("click", () => void this.toggleDomain(domain.domain));

    const info = head.createDiv({ cls: "rlc-domain-info" });
    info.createDiv({ text: domain.domain, cls: "rlc-domain-name" });
    info.createDiv({
      text: `${domain.literatureTotal} 篇文献 · ${domain.cardTotal} 张卡片`,
      cls: "rlc-domain-meta",
    });

    const actions = head.createDiv({ cls: "rlc-domain-actions" });
    const reviewPath = literatureReviewPath(domain.domain);
    const reviewState = await this.readReviewState(reviewPath);

    const reviewButton = actions.createEl("button", {
      text: reviewState === "ready" ? "查看综述" : "生成综述",
      cls: reviewState === "ready" ? "rlc-btn rlc-btn-ghost" : "rlc-btn rlc-btn-primary",
    });
    reviewButton.addEventListener("click", () => {
      if (reviewState === "ready") {
        void this.openPath(reviewPath);
      } else {
        void this.rlc.generateDomainReview(domain.domain);
      }
    });

    if (reviewState === "ready") {
      const pick = actions.createEl("button", { text: "选文献", cls: "rlc-btn rlc-btn-ghost" });
      pick.addEventListener("click", () => void this.rlc.openCandidatePicker(domain.domain));
    }

    const addLit = actions.createEl("button", { text: "＋ 文献", cls: "rlc-btn rlc-btn-ghost" });
    addLit.addEventListener("click", () => this.rlc.openLiteratureModal(domain.domain));

    const body = card.createDiv({ cls: "rlc-domain-body" });
    if (collapsed) {
      body.addClass("rlc-hidden");
      return;
    }

    if (domain.literatures.length === 0) {
      const hint = body.createDiv({ cls: "rlc-domain-empty" });
      hint.setText(
        reviewState === "ready"
          ? "综述已就绪。点「选文献」从候选里挑，或手动「＋ 文献」。"
          : "还没有文献。点「生成综述」让 AI 起草，或直接「＋ 文献」。",
      );
      return;
    }

    for (const literature of domain.literatures) {
      this.renderLiterature(body, literature, pendingPaths);
    }
  }

  private renderLiterature(
    parent: HTMLElement,
    literature: ReturnType<typeof buildOverview>["domains"][number]["literatures"][number],
    pendingPaths: Set<string>,
  ): void {
    const block = parent.createDiv({ cls: "rlc-lit-card" });

    const explicit = this.rlc.settings.literatureOpen[literature.notePath];
    const expanded = explicit ? explicit === "open" : literature.cards.length <= 1;
    const pendingCount = literature.cards.filter((card) => pendingPaths.has(card.path)).length;

    const head = block.createDiv({ cls: "rlc-lit-head" });

    if (literature.cards.length > 0) {
      const caret = head.createEl("button", {
        text: expanded ? "▾" : "▸",
        cls: "rlc-caret",
        attr: {
          "aria-label": expanded ? "收起卡片" : "展开卡片",
          "aria-expanded": String(expanded),
        },
      });
      caret.addEventListener("click", () =>
        void this.toggleLiterature(literature.notePath, expanded),
      );
    }

    const info = head.createDiv({ cls: "rlc-lit-info" });
    const titleRow = info.createDiv({ cls: "rlc-lit-title-row" });
    const titleSpan = titleRow.createSpan({ text: literature.title, cls: "rlc-lit-title" });
    titleSpan.title = [literature.title, literature.titleZh ? `中文：${literature.titleZh}` : ""]
      .filter(Boolean)
      .join("\n");
    titleSpan.addEventListener("click", () => void this.openPath(literature.notePath));
    titleRow.createSpan({
      text: STATUS_LABEL[literature.status] ?? literature.status,
      cls: `rlc-status-chip rlc-status-${literature.status}`,
    });
    if (pendingCount > 0) {
      titleRow.createSpan({
        text: `待发布 ${pendingCount}`,
        cls: "rlc-status-chip rlc-pending-chip",
      });
    }

    const meta = [
      literature.year ? String(literature.year) : "",
      literature.authors.join("、"),
      literature.updatedAt ? formatDay(literature.updatedAt) : "",
      `${literature.cards.length} 张`,
    ]
      .filter(Boolean)
      .join(" · ");
    info.createDiv({ text: meta, cls: "rlc-lit-meta" });

    // 操作按固定顺序排一行：1 下载原文 → 2 整理 → 3 略读 → 4 精读卡片。
    // 放在标题下方而不是同一行，标题长短就不会再推动按钮位置。
    const actions = block.createDiv({ cls: "rlc-lit-actions" });

    const hasPdf = Boolean(literature.pdfPath);
    const download = actions.createEl("button", {
      text: hasPdf ? "1 原文已下载" : "1 下载原文",
      cls: "rlc-btn rlc-btn-ghost",
    });
    download.disabled = hasPdf || !literature.doi;
    download.title = hasPdf
      ? "原文已在文献文件夹里"
      : literature.doi
        ? "下载开放获取的原文 PDF"
        : "这篇文献没有 DOI，无法自动定位开放获取版本";
    if (!download.disabled) {
      download.addEventListener("click", () => void this.rlc.downloadLiteraturePdf(literature));
    }

    const organize = actions.createEl("button", { text: "2 整理", cls: "rlc-btn rlc-btn-ghost" });
    organize.title = "PDF → Markdown（OCR + 分节 + 英文翻译）";
    organize.addEventListener("click", () => void this.rlc.organizeLiterature(literature));

    const skim = actions.createEl("button", { text: "3 略读", cls: "rlc-btn rlc-btn-ghost" });
    skim.title = "生成略读报告，推进阅读状态";
    skim.addEventListener("click", () => void this.rlc.openSkimModal(literature));

    const addCard = actions.createEl("button", {
      text: "4 ＋精读卡片",
      cls: "rlc-btn rlc-btn-primary",
    });
    addCard.title = "为这篇文献新建精读卡片";
    addCard.addEventListener("click", () => this.rlc.openCardModal(this.contextFor(literature)));

    if (literature.cards.length === 0) return;

    const list = block.createDiv({ cls: "rlc-lit-body" });
    if (!expanded) {
      list.addClass("rlc-hidden");
      return;
    }

    const cardList = list.createDiv({ cls: "rlc-card-list" });
    for (const cardSummary of literature.cards) {
      const row = cardList.createDiv({ cls: "rlc-card-row" });
      const name = row.createSpan({ text: cardSummary.title, cls: "rlc-card-title" });
      name.addEventListener("click", () => void this.openPath(cardSummary.path));

      if (pendingPaths.has(cardSummary.path)) {
        row.createSpan({ text: "待发布", cls: "rlc-status-chip rlc-pending-chip" });
      }

      const poster = row.createEl("button", { text: "海报", cls: "rlc-btn rlc-btn-small" });
      poster.title = "生成文案 + 插画 + 排版的海报";
      poster.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.rlc.openPosterByPath(cardSummary.path);
      });

      if (cardSummary.updatedAt) {
        row.createSpan({ text: formatDay(cardSummary.updatedAt), cls: "rlc-card-date" });
      }

      if (cardSummary.publishId) {
        const chip = row.createSpan({ text: "已发布", cls: "rlc-status-chip rlc-published" });
        if (cardSummary.publishUrl) {
          chip.addEventListener("click", () => window.open(cardSummary.publishUrl, "_blank"));
        }
      } else {
        const publish = row.createEl("button", { text: "发布", cls: "rlc-btn rlc-btn-small" });
        publish.addEventListener("click", (event) => {
          event.stopPropagation();
          void this.rlc.publishCardByPath(cardSummary.path);
        });
      }
    }
  }

  private contextFor(literature: {
    domain: string;
    citekey: string;
    folder: string;
    title: string;
    authors: string[];
    year?: number;
    doi?: string;
    url?: string;
  }): CardContext {
    return {
      domain: literature.domain,
      domainSlug: domainSlug(literature.domain),
      citekey: literature.citekey,
      folder: literature.folder,
      literatureTitle: literature.title,
      authors: literature.authors,
      year: literature.year,
      doi: literature.doi,
      url: literature.url,
    };
  }

  private async openPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf("tab").openFile(file);
    }
  }

  private async readReviewState(path: string): Promise<"missing" | "blank" | "ready"> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return "missing";
    const content = await this.app.vault.cachedRead(file);
    return isReviewEmpty(content) ? "blank" : "ready";
  }
}
