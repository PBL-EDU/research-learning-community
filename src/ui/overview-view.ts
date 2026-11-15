import { ItemView, Menu, TFile, type WorkspaceLeaf } from "obsidian";
import { domainSlug, fullTextPath, literatureReviewPath, STATUS_LABEL } from "@rlc/vault-core";
import { buildOverview, formatDay, type CardSummary, type LiteratureNode } from "../core/overview";
import { isReviewEmpty } from "../core/review";
import type RlcPlugin from "../main";
import type { CardContext } from "./card-modal";

export const VIEW_TYPE_RLC_OVERVIEW = "rlc-overview";

const LIT_STEP_LABELS = ["下载原文", "整理", "略读", "精读卡片", "实践卡"];
const LIT_NEXT_LABELS = ["下载原文", "整理", "略读", "精读", "实践"];

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
  private monthCursor = new Date();
  private activeDay = "";

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
    const statsPanel = root.createDiv({ cls: "rlc-stats-panel" });
    this.renderStats(statsPanel, overview);
    this.renderPracticeTop(root, overview);

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
    header.createDiv({ text: "研究性学习", cls: "rlc-title" });

    const right = header.createDiv({ cls: "rlc-header-right" });
    const settings = this.rlc.settings;
    const name = settings.bindName || settings.authorName || "我";
    right.createDiv({
      text: name,
      cls: "rlc-identity",
      title: settings.bindHandle
        ? `${settings.bindName}（${settings.bindHandle}）· ${settings.bindOrgName || settings.bindOrg}`
        : "在设置里用邀请码绑定身份",
    });
    right.createSpan({
      text: settings.bindHandle ? "已绑定" : "未绑定",
      cls: "rlc-identity-status",
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
    item("实践", overview.practice);
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
    const progress = this.literatureProgress(literature);
    const done = progress.filter(Boolean).length;
    const nextIndex = progress.findIndex((value) => !value);

    const dots = actions.createDiv({ cls: "rlc-phase-dots" });
    progress.forEach((value, index) => {
      // 原文 / 整理 / 略读 是一次性环节，完成后禁止再点；
      // 精读与实践可以产出多张，保持可点。
      const locked = value && index <= 2;
      const dot = dots.createEl("button", {
        cls:
          "rlc-phase-dot" +
          (value ? " rlc-dot-done" : "") +
          (index === nextIndex ? " rlc-dot-current" : "") +
          (locked ? " rlc-phase-locked" : ""),
        attr: { "aria-label": `第 ${index + 1} 步：${LIT_STEP_LABELS[index]}` },
      });
      dot.disabled = locked;
      dot.title = locked
        ? `${index + 1} ${LIT_STEP_LABELS[index]}（已完成）`
        : `${index + 1} ${LIT_STEP_LABELS[index]}`;
      dot.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!locked) this.runLiteratureStep(literature, index);
      });
    });
    actions.createSpan({ text: `${done}/5`, cls: "rlc-phase-count" });

    const next = actions.createEl("button", {
      text: nextIndex < 0 ? "已完成" : `下一步：${LIT_NEXT_LABELS[nextIndex]}`,
      cls: "rlc-btn rlc-btn-primary rlc-btn-small",
    });
    next.disabled = nextIndex < 0;
    next.addEventListener("click", (event) => {
      event.stopPropagation();
      if (nextIndex >= 0) this.runLiteratureStep(literature, nextIndex);
    });

    const more = actions.createEl("button", {
      text: "⋯",
      cls: "rlc-btn rlc-btn-small rlc-lit-more",
      attr: { "aria-label": "全部动作" },
    });
    more.title = "全部动作";
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      this.showLiteratureMenu(event, literature);
    });

    if (literature.cards.length === 0) return;

    const list = block.createDiv({ cls: "rlc-lit-body" });
    if (!expanded) {
      list.addClass("rlc-hidden");
      return;
    }

    const deepRead = literature.cards.filter((card) => card.path.includes("-dr-"));
    const practices = literature.cards.filter((card) => card.path.includes("-pc-"));
    const others = literature.cards.filter(
      (card) => !card.path.includes("-dr-") && !card.path.includes("-pc-"),
    );

    if (deepRead.length > 0) {
      list.createDiv({ text: `精读卡片 ${deepRead.length}`, cls: "rlc-card-group rlc-group-read" });
      const cardList = list.createDiv({ cls: "rlc-card-list" });
      for (const cardSummary of deepRead) {
        this.renderDeepReadRow(cardList, cardSummary, literature, pendingPaths);
      }
    }

    if (practices.length > 0) {
      list.createDiv({ text: `实践卡片 ${practices.length}`, cls: "rlc-card-group rlc-group-practice" });
      const cardList = list.createDiv({ cls: "rlc-card-list rlc-card-list-practice" });
      for (const cardSummary of practices) {
        this.renderPracticeRow(cardList, cardSummary);
      }
    }

    if (others.length > 0) {
      const cardList = list.createDiv({ cls: "rlc-card-list" });
      for (const cardSummary of others) {
        this.renderDeepReadRow(cardList, cardSummary, literature, pendingPaths);
      }
    }
  }

  private renderDeepReadRow(
    container: HTMLElement,
    cardSummary: CardSummary,
    literature: { domain: string; citekey: string; folder: string; title: string; authors: string[]; year?: number; doi?: string; url?: string },
    pendingPaths: Set<string>,
  ): void {
    const row = container.createDiv({ cls: "rlc-card-row" });
    const name = row.createSpan({ text: cardSummary.title, cls: "rlc-card-title" });
    name.addEventListener("click", () => void this.openPath(cardSummary.path));

    if (pendingPaths.has(cardSummary.path)) {
      row.createSpan({ text: "待发布", cls: "rlc-status-chip rlc-pending-chip" });
    }

    if (cardSummary.path.includes("-dr-")) {
      const poster = row.createEl("button", { text: "海报", cls: "rlc-btn rlc-btn-small" });
      poster.title = "生成文案 + 插画 + 排版的海报";
      poster.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.rlc.openPosterByPath(cardSummary.path);
      });

      const practice = row.createEl("button", { text: "立项", cls: "rlc-btn rlc-btn-small" });
      practice.title = "以这张精读卡片的 Aha 立项，新建实践卡";
      practice.addEventListener("click", (event) => {
        event.stopPropagation();
        this.rlc.openPracticeModal(this.contextFor(literature), cardSummary.path);
      });
    }

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

  private practiceStatus(card: CardSummary): { text: string; tone: string } {
    const today = this.rlc.today();
    if (card.hasSummary) return { text: "已复盘", tone: "done" };
    if (card.processCount && card.processCount > 0) return { text: "进行中", tone: "active" };
    if (card.scheduledFor && card.scheduledFor < today) {
      const days = this.daysBetween(card.scheduledFor, today);
      return { text: days >= 7 ? `卡住 ${days} 天` : `逾期 ${days} 天`, tone: "overdue" };
    }
    return { text: "计划中", tone: "planned" };
  }

  private daysBetween(from: string, to: string): number {
    const start = Date.parse(`${from}T00:00:00`);
    const end = Date.parse(`${to}T00:00:00`);
    if (Number.isNaN(start) || Number.isNaN(end)) return 0;
    return Math.max(0, Math.round((end - start) / 86_400_000));
  }

  private renderPracticeRow(container: HTMLElement, cardSummary: CardSummary): void {
    const wrap = container.createDiv({ cls: "rlc-practice-item" });
    const row = wrap.createDiv({ cls: "rlc-card-row rlc-card-row-practice" });

    const caret = row.createEl("button", { text: "▸", cls: "rlc-practice-caret" });
    const name = row.createSpan({ text: cardSummary.title, cls: "rlc-card-title" });
    name.addEventListener("click", () => void this.openPath(cardSummary.path));

    const status = this.practiceStatus(cardSummary);
    row.createSpan({ text: status.text, cls: `rlc-practice-status rlc-practice-${status.tone}` });
    if (cardSummary.scheduledFor) {
      row.createSpan({ text: `${cardSummary.scheduledFor.slice(5)}`, cls: "rlc-card-date" });
    }
    if (cardSummary.processCount) {
      row.createSpan({ text: `过程 ${cardSummary.processCount}`, cls: "rlc-card-date" });
    }

    const record = row.createEl("button", { text: "记录", cls: "rlc-btn rlc-btn-small" });
    record.addEventListener("click", (event) => {
      event.stopPropagation();
      const file = this.app.vault.getAbstractFileByPath(cardSummary.path);
      if (file instanceof TFile) this.rlc.openProcessModalByFile(file);
    });

    const summary = row.createEl("button", { text: "总结", cls: "rlc-btn rlc-btn-small" });
    summary.addEventListener("click", (event) => {
      event.stopPropagation();
      const file = this.app.vault.getAbstractFileByPath(cardSummary.path);
      if (file instanceof TFile) this.rlc.openSummaryModalByFile(file);
    });

    const body = wrap.createDiv({ cls: "rlc-practice-body rlc-hidden" });
    let loaded = false;
    caret.addEventListener("click", (event) => {
      event.stopPropagation();
      const hidden = body.hasClass("rlc-hidden");
      if (hidden) body.removeClass("rlc-hidden");
      else body.addClass("rlc-hidden");
      caret.setText(hidden ? "▾" : "▸");
      if (hidden && !loaded) {
        loaded = true;
        const file = this.app.vault.getAbstractFileByPath(cardSummary.path);
        if (file instanceof TFile) void this.renderPracticeDetail(body, file);
      }
    });
  }

  private async renderPracticeDetail(container: HTMLElement, file: TFile): Promise<void> {
    container.empty();
    const parsed = await this.rlc.cards.readCard(file);
    if (!parsed.ok || parsed.card.schema !== "pc-card@1") {
      container.createDiv({ text: "无法读取实践卡", cls: "rlc-muted" });
      return;
    }
    const card = parsed.card;

    const plan = container.createDiv({ cls: "rlc-practice-plan" });
    plan.createDiv({ text: card.plan.goal, cls: "rlc-practice-goal" });
    if (card.plan.scheduledFor) {
      plan.createDiv({ text: `计划：${card.plan.scheduledFor}`, cls: "rlc-muted" });
    }

    card.plan.steps.forEach((step, index) => {
      const line = container.createDiv({ cls: "rlc-step" });
      const box = line.createEl("input", { type: "checkbox" });
      box.checked = step.done;
      box.addEventListener("change", () => {
        void this.rlc.practice.toggleStep(file, index, box.checked).then(() => this.render());
      });
      line.createSpan({ text: step.text, cls: step.done ? "rlc-step-done" : "" });
    });

    const timeline = container.createDiv({ cls: "rlc-timeline" });
    if (card.process.length === 0) {
      timeline.createDiv({ text: "还没有过程记录。点「记录」写第一条。", cls: "rlc-muted" });
    } else {
      for (const entry of [...card.process].reverse()) {
        const item = timeline.createDiv({ cls: "rlc-timeline-item" });
        item.createSpan({ text: entry.date.slice(5, 10), cls: "rlc-timeline-date" });
        item.createSpan({ text: entry.what, cls: "rlc-timeline-what" });
        if (entry.evidence) item.createDiv({ text: `证据：${entry.evidence}`, cls: "rlc-muted" });
        if (entry.obstacle) item.createDiv({ text: `阻碍：${entry.obstacle}`, cls: "rlc-muted" });
        if (entry.adjust) item.createDiv({ text: `调整：${entry.adjust}`, cls: "rlc-muted" });
      }
    }

    if (card.summary) {
      container.createDiv({ text: `总结：${card.summary.outcome}`, cls: "rlc-practice-summary" });
    }
  }

  private allPracticeCards(overview: ReturnType<typeof buildOverview>): CardSummary[] {
    const map = new Map<string, CardSummary>();
    for (const domain of overview.domains) {
      for (const literature of domain.literatures) {
        for (const card of literature.cards) {
          if (card.kind === "practice") map.set(card.path, card);
        }
      }
    }
    return [...map.values()];
  }

  private ymd(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  private renderPracticeTop(root: HTMLElement, overview: ReturnType<typeof buildOverview>): void {
    const practices = this.allPracticeCards(overview);
    if (practices.length === 0) return;

    const wrap = root.createDiv({ cls: "rlc-practice-top" });
    // 日历卡片：日历与今日列表同框
    const card = wrap.createDiv({ cls: "rlc-calendar-card" });
    this.renderCalendar(card, practices);
    this.renderDayList(card, practices);
  }

  private renderCalendar(wrap: HTMLElement, practices: CardSummary[]): void {
    const today = this.rlc.today();
    const calendar = wrap.createDiv({ cls: "rlc-calendar" });
    const head = calendar.createDiv({ cls: "rlc-calendar-head" });
    const prev = head.createEl("button", { text: "‹", cls: "rlc-calendar-nav" });
    prev.addEventListener("click", () => {
      this.monthCursor = new Date(this.monthCursor.getFullYear(), this.monthCursor.getMonth() - 1, 1);
      void this.render();
    });
    head.createSpan({
      text: `${this.monthCursor.getFullYear()} 年 ${this.monthCursor.getMonth() + 1} 月`,
      cls: "rlc-calendar-title",
    });
    const next = head.createEl("button", { text: "›", cls: "rlc-calendar-nav" });
    next.addEventListener("click", () => {
      this.monthCursor = new Date(this.monthCursor.getFullYear(), this.monthCursor.getMonth() + 1, 1);
      void this.render();
    });

    const weekdays = calendar.createDiv({ cls: "rlc-calendar-weekdays" });
    for (const label of ["一", "二", "三", "四", "五", "六", "日"]) {
      weekdays.createDiv({ text: label, cls: "rlc-calendar-weekday" });
    }

    const grid = calendar.createDiv({ cls: "rlc-calendar-grid" });
    const first = new Date(this.monthCursor.getFullYear(), this.monthCursor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(this.monthCursor.getFullYear(), this.monthCursor.getMonth() + 1, 0).getDate();

    for (let i = 0; i < offset; i += 1) {
      grid.createDiv({ cls: "rlc-calendar-day rlc-calendar-blank" });
    }

    const planned = new Set(practices.map((card) => card.scheduledFor).filter(Boolean));
    const recorded = new Set<string>();
    for (const card of practices) {
      for (const date of card.processDates ?? []) recorded.add(date.slice(0, 10));
    }
    const overdue = new Set<string>();
    for (const card of practices) {
      if (
        card.scheduledFor &&
        card.scheduledFor < today &&
        !card.hasSummary &&
        (card.processCount ?? 0) === 0
      ) {
        overdue.add(card.scheduledFor);
      }
    }

    for (let day = 1; day <= days; day += 1) {
      const date = this.ymd(new Date(this.monthCursor.getFullYear(), this.monthCursor.getMonth(), day));
      const cell = grid.createDiv({ cls: "rlc-calendar-day" });
      if (date === today) cell.addClass("rlc-calendar-today");
      if (date === this.activeDay) cell.addClass("rlc-calendar-active");
      cell.createSpan({ text: String(day) });
      const dots = cell.createDiv({ cls: "rlc-calendar-dots" });
      if (planned.has(date)) dots.createSpan({ cls: "rlc-dot rlc-dot-plan" });
      if (recorded.has(date)) dots.createSpan({ cls: "rlc-dot rlc-dot-record" });
      if (overdue.has(date)) dots.createSpan({ cls: "rlc-dot rlc-dot-overdue" });
      cell.addEventListener("click", () => {
        this.activeDay = date;
        void this.render();
      });
    }
  }

  private renderDayList(wrap: HTMLElement, practices: CardSummary[]): void {
    const today = this.rlc.today();
    const day = this.activeDay || today;
    const heading = day === today ? "今天" : day.slice(5);

    const items = practices.filter(
      (card) =>
        card.scheduledFor === day ||
        (card.processDates ?? []).some((date) => date.slice(0, 10) === day),
    );

    const stuck = practices.filter(
      (card) =>
        card.scheduledFor !== undefined &&
        card.scheduledFor < today &&
        !card.hasSummary &&
        (card.processCount ?? 0) === 0 &&
        this.daysBetween(card.scheduledFor, today) >= 7,
    );
    if (day === today) {
      for (const card of stuck) if (!items.includes(card)) items.push(card);
    }

    if (items.length === 0) return;

    const box = wrap.createDiv({ cls: "rlc-today" });
    box.createDiv({ text: heading, cls: "rlc-today-title" });
    for (const card of items) {
      const row = box.createDiv({ cls: "rlc-today-row" });
      const status = this.practiceStatus(card);
      row.createSpan({ cls: `rlc-dot rlc-dot-${status.tone === "overdue" ? "overdue" : status.tone === "active" ? "record" : "plan"}` });
      row.createSpan({ text: card.title, cls: "rlc-today-name" });
      row.createSpan({ text: status.text, cls: `rlc-practice-status rlc-practice-${status.tone}` });
      row.addEventListener("click", () => void this.openPath(card.path));
    }
  }

  private literatureProgress(literature: LiteratureNode): boolean[] {
    const fullText = this.app.vault.getAbstractFileByPath(
      fullTextPath(literature.domain, literature.folder),
    );
    const skimmed = ["skimming", "reading", "deep_read", "done"].includes(literature.status);
    return [
      Boolean(literature.pdfPath),
      Boolean(fullText),
      skimmed,
      literature.cards.some((card) => card.path.includes("-dr-")),
      literature.cards.some((card) => card.path.includes("-pc-")),
    ];
  }

  private runLiteratureStep(literature: LiteratureNode, index: number): void {
    if (index === 0) {
      if (literature.pdfPath) void this.openPath(literature.pdfPath);
      else void this.rlc.downloadLiteraturePdf(literature);
      return;
    }
    if (index === 1) {
      void this.rlc.organizeLiterature(literature);
      return;
    }
    if (index === 2) {
      void this.rlc.openSkimModal(literature);
      return;
    }
    if (index === 3) {
      this.rlc.openCardModal(this.contextFor(literature));
      return;
    }
    this.rlc.openPracticeModal(this.contextFor(literature));
  }

  private showLiteratureMenu(event: MouseEvent, literature: LiteratureNode): void {
    const menu = new Menu();
    const progress = this.literatureProgress(literature);
    LIT_STEP_LABELS.forEach((label, index) => {
      const locked = progress[index] === true && index <= 2;
      menu.addItem((item) => {
        item
          .setTitle(`${index + 1} ${label}`)
          .setDisabled(locked)
          .onClick(() => {
            if (!locked) this.runLiteratureStep(literature, index);
          });
      });
    });
    menu.showAtMouseEvent(event);
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
