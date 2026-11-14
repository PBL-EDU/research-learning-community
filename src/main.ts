import { MarkdownView, Notice, Plugin, TFile, requestUrl } from "obsidian";
import { checkPublishable } from "@rlc/contract";
import {
  domainSlug,
  extractSection,
  fullTextPath,
  literatureNotePath,
  literatureReviewDocument,
  literatureReviewPath,
  pdfPath,
  safeSegment,
  systemFile,
} from "@rlc/vault-core";
import { DEFAULT_SETTINGS, RlcSettingTab, type RlcSettings } from "./settings";
import { AiClient } from "./core/ai";
import { CardService } from "./core/card-service";
import { LiteratureService } from "./core/literature-service";
import { lookupOpenAccess } from "./core/openalex";
import { PublishService } from "./core/publish-service";
import { OrganizeService } from "./core/organize";
import { VaultIndex } from "./core/literature-index";
import type { LiteratureSummary } from "./core/overview";
import { domainReviewMessages, translateTitleMessages } from "./core/prompts";
import { parseCandidates, stripCandidates, type ReviewCandidate } from "./core/review";
import { CandidateModal } from "./ui/candidate-modal";
import { DeepReadCardModal, type CardContext } from "./ui/card-modal";
import { DomainModal } from "./ui/domain-modal";
import { LiteratureModal } from "./ui/literature-modal";
import { OrganizeConsentModal } from "./ui/organize-consent-modal";
import { PosterModal } from "./ui/poster-modal";
import { FulltextHelpModal } from "./ui/fulltext-modal";
import { LiteraturePickerModal } from "./ui/literature-picker";
import { SkimModal } from "./ui/skim-modal";
import { ResearchOverviewView, VIEW_TYPE_RLC_OVERVIEW } from "./ui/overview-view";

export default class RlcPlugin extends Plugin {
  /** Obsidian 1.13 起 Plugin 自带 settings 字段，这里收窄成具体类型。 */
  override settings: RlcSettings = { ...DEFAULT_SETTINGS };
  ai!: AiClient;
  cards!: CardService;
  literatures!: LiteratureService;
  publisher!: PublishService;
  organize!: OrganizeService;
  index!: VaultIndex;

  private statusEl: HTMLElement | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.ai = new AiClient(() => this.settings);
    this.cards = new CardService(this.app);
    this.literatures = new LiteratureService(this.cards);
    this.publisher = new PublishService(this.app, this.cards, () => this.settings);
    this.organize = new OrganizeService(this.ai, () => this.settings);
    this.index = new VaultIndex(this.app);

    this.addSettingTab(new RlcSettingTab(this.app, this));

    this.registerView(VIEW_TYPE_RLC_OVERVIEW, (leaf) => new ResearchOverviewView(leaf, this));
    this.addRibbonIcon("notebook-pen", "研究性学习：打开总览", () => void this.activateOverview());

    this.addCommand({
      id: "open-overview",
      name: "打开研究性学习总览",
      callback: () => void this.activateOverview(),
    });
    this.addCommand({
      id: "new-domain",
      name: "新建领域",
      callback: () => this.openDomainModal(),
    });
    this.addCommand({
      id: "add-literature",
      name: "添加文献",
      callback: () => void this.openLiteratureModal(),
    });
    this.addCommand({
      id: "new-deep-read-card",
      name: "新建精读卡片",
      callback: () => this.openCardPicker(),
    });
    this.addCommand({
      id: "validate-current-card",
      name: "校验当前卡片",
      callback: () => void this.validateCurrent(),
    });
    this.addCommand({
      id: "publish-current-card",
      name: "发布当前卡片",
      callback: () => void this.publishCurrent(),
    });
    this.addCommand({
      id: "retry-outbox",
      name: "重试待发布队列",
      callback: () => void this.retryOutbox(),
    });
    this.addCommand({
      id: "generate-poster",
      name: "生成海报（当前卡片）",
      callback: () => void this.openPosterModal(),
    });
    this.addCommand({
      id: "translate-literature-titles",
      name: "补全文献中文标题",
      callback: () => void this.backfillTitles(),
    });

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("rlc-status");
    this.statusEl.addEventListener("click", () => void this.retryOutbox());
    await this.refreshStatus();

    // 右键文件 → 发布；比记命令面板更容易发现。
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (!file.path.startsWith("领域/")) return;
        menu.addItem((item) =>
          item
            .setTitle("发布到研究性学习社区")
            .setIcon("upload")
            .onClick(() => void this.publishFile(file)),
        );
      }),
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  notice(message: string): void {
    new Notice(message, 6000);
  }

  /** 打卡右栏总览；已打开则直接聚焦，不重复创建视图。 */
  async activateOverview(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_RLC_OVERVIEW)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        this.notice("无法打开右侧栏");
        return;
      }
      await leaf.setViewState({ type: VIEW_TYPE_RLC_OVERVIEW, active: true });
    }

    await workspace.revealLeaf(leaf);
  }

  async refreshOverview(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_RLC_OVERVIEW)) {
      const view = leaf.view;
      if (view instanceof ResearchOverviewView) await view.refresh();
    }
  }

  openDomainModal(): void {
    new DomainModal(this.app, this, (domain) => {
      void this.generateDomainReview(domain);
    }).open();
  }

  async openLiteratureModal(domain?: string): Promise<void> {
    const domains = await this.index.listDomains();
    new LiteratureModal(
      this.app,
      this,
      domains,
      domain ?? (this.settings.lastDomain || undefined),
      (createdDomain) => {
        this.settings.lastDomain = createdDomain;
        void this.saveSettings();
        void this.refreshOverview();
      },
    ).open();
  }

  openCardPicker(): void {
    const literatures = this.index.listLiteratures();
    new LiteraturePickerModal(this.app, this, literatures, (item) => {
      this.openCardModal(this.contextFrom(item));
    }).open();
  }

  /** 生成海报：文案（科普版）→ 插画 → 本地排版，一个入口走完。 */
  async openPosterModal(file?: TFile): Promise<void> {
    const target = file ?? this.activeFile();
    if (!target) {
      this.notice("先打开一张卡片文件，或在总览里点卡片行的「海报」");
      return;
    }

    const parsed = await this.cards.readCard(target);
    if (!parsed.ok) {
      this.notice(`不能生成海报：${parsed.message}`);
      return;
    }

    if (this.settings.audienceProfiles.filter((item) => item.name.trim()).length === 0) {
      this.notice("先在设置里添加读者画像：设置 → 研究性学习社区 → 我的读者");
      return;
    }

    const markdown = await this.cards.readText(target);
    new PosterModal(
      this.app,
      this,
      target,
      parsed.card,
      markdown,
      () => void this.refreshOverview(),
    ).open();
  }

  async openPosterByPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.openPosterModal(file);
  }

  openCardModal(context: CardContext): void {
    const notePath = `领域/${context.domain}/文献/${context.folder}/${context.folder}.md`;
    new DeepReadCardModal(this.app, this, context, () => {
      // 新建卡片后展开它所在的文献与领域，否则学生以为没保存成功。
      this.settings.literatureOpen[notePath] = "open";
      this.settings.collapsedDomains = this.settings.collapsedDomains.filter(
        (name) => name !== context.domain,
      );
      void this.saveSettings().then(() => this.refreshOverview());
    }).open();
  }

  /** 略读：自动带出文献笔记里的「## 摘要」作为输入。 */
  async openSkimModal(item: LiteratureSummary): Promise<void> {
    const notePath = literatureNotePath(item.domain, item.folder);
    const content = (await this.cards.readTextPath(notePath)) ?? "";
    const excerpt = extractSection(content, "摘要");
    new SkimModal(this.app, this, item, excerpt, () => void this.refreshOverview()).open();
  }

  /**
   * 下载开放获取原文。
   *
   * 三条边界写死在代码里：
   * 1. 只下 OA——OpenAlex 判定非开放获取就停，不绕付费墙；
   * 2. 内容类型不是 PDF 就拒绝——很多 OA 链接会重定向到登录页；
   * 3. 文件只落本地 文献/<citekey>/原文.pdf，发布链路永远不带二进制。
   */
  /** 为单篇文献翻译中文标题并写回 frontmatter。 */
  async translateTitleFor(notePath: string, title: string, force = false): Promise<void> {
    if (!this.ai.ready) return;
    if (!force && !this.settings.autoTranslateTitle) return;

    try {
      const raw = await this.ai.chat(translateTitleMessages(title), {
        maxTokens: 200,
        temperature: 0.2,
      });
      const zh = raw
        .split("\n")[0]
        ?.trim()
        .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
        .trim();
      if (!zh) return;

      const file = this.app.vault.getAbstractFileByPath(notePath);
      if (file instanceof TFile) {
        await this.cards.patchFile(file, { titleZh: zh, updatedAt: new Date().toISOString() });
      }
    } catch (error) {
      console.warn("[rlc] 标题翻译失败", error);
    }
  }

  /** 批量补全：给所有缺 titleZh 的文献翻一遍。 */
  async backfillTitles(): Promise<void> {
    const missing = this.index.listLiteratures().filter((item) => !item.titleZh);
    if (missing.length === 0) {
      this.notice("所有文献都已有中文标题");
      return;
    }
    if (!this.ai.ready) {
      this.notice("先配置 AI：设置 → 研究性学习社区 → AI");
      return;
    }

    const progress = new Notice(`正在翻译 ${missing.length} 篇文献标题…`, 0);
    let done = 0;
    try {
      for (const item of missing) {
        progress.setMessage(`翻译 ${done + 1}/${missing.length}：${item.title.slice(0, 24)}…`);
        await this.translateTitleFor(item.notePath, item.title, true);
        done += 1;
      }
      progress.hide();
      this.notice(`已补全 ${done} 篇中文标题`);
      await this.refreshOverview();
    } catch (error) {
      progress.hide();
      this.notice(`翻译失败：${(error as Error).message}`);
    }
  }

  async downloadLiteraturePdf(item: LiteratureSummary): Promise<void> {
    if (item.pdfPath) {
      this.notice("这篇文献的原文已经下载过了");
      return;
    }
    if (!item.doi) {
      this.notice("这篇文献没有 DOI，试试从其他入口找全文");
      new FulltextHelpModal(this.app, item).open();
      return;
    }

    this.notice("正在查找开放获取版本…");
    const access = await lookupOpenAccess(item.doi);

    if (access.status !== "pdf" || !access.pdfUrl) {
      const reason =
        access.status === "oa-no-pdf"
          ? `开放获取，但没有直接 PDF 链接${access.landingUrl ? `：${access.landingUrl}` : ""}`
          : access.message ?? "未找到可下载的开放获取 PDF";
      this.notice(reason);
      new FulltextHelpModal(this.app, item).open();
      return;
    }

    this.notice("找到 PDF，开始下载…");
    try {
      const response = await requestUrl({ url: access.pdfUrl, method: "GET", throw: false });
      if (response.status !== 200) {
        this.notice(`下载失败：HTTP ${response.status}`);
        return;
      }

      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      if (!contentType.includes("pdf")) {
        this.notice(`返回的不是 PDF（${contentType || "未知类型"}），可能被重定向到登录页`);
        return;
      }

      const buffer = response.arrayBuffer;
      if (buffer.byteLength > 40 * 1024 * 1024) {
        this.notice("PDF 超过 40MB，已跳过");
        return;
      }

      const path = await this.literatures.attachPdf(item.domain, item.folder, buffer);
      const noteFile = this.app.vault.getAbstractFileByPath(
        literatureNotePath(item.domain, item.folder),
      );
      if (noteFile instanceof TFile) {
        await this.cards.patchFile(noteFile, {
          pdfPath: path,
          updatedAt: new Date().toISOString(),
        });
      }

      this.notice(`已保存原文：${path}`);
      await this.refreshOverview();
    } catch (error) {
      this.notice(`下载失败：${(error as Error).message}`);
    }
  }

  /**
   * 点击领域：调用 AI 生成该领域的文献综述，写到领域根目录。
   *
   * 生成的是「综述 + 候选文献清单」。候选只是候选——入库前会用 Crossref 逐条核验，
   * 因为模型可以编标题和 DOI，但编不出 Crossref 里真实存在的记录。
   */
  async generateDomainReview(domain: string): Promise<void> {
    if (!this.ai.ready) {
      this.notice("先配置 AI：设置 → 研究性学习社区 → AI");
      return;
    }

    const path = literatureReviewPath(domain);
    const existing = (await this.cards.exists(path)) ? await this.cards.readTextPath(path) : null;
    if (existing) {
      const backup = `00-系统/backup/文献综述-${safeSegment(domain, "domain")}-${Date.now()}.md`;
      await this.cards.writeText(backup, existing);
    }

    const progress = new Notice(`正在生成「${domain}」的文献综述（约 20–40 秒）…`, 0);
    try {
      let body = await this.ai.chat(domainReviewMessages({ domain }), { maxTokens: 4000 });
      let candidates = parseCandidates(body);

      // 候选清单解析失败时重试一次：模型偶尔会漏掉注释块，
      // 但再给一次带明确强调的指令通常就能出来。
      if (candidates.length === 0) {
        progress.setMessage("没解析到候选清单，重试一次…");
        body = await this.ai.chat(domainReviewMessages({ domain, retry: true }), {
          maxTokens: 4000,
        });
        candidates = parseCandidates(body);
      }

      // 候选清单只留在系统目录，正文里不再带 JSON 注释块。
      const cleanBody = stripCandidates(body);
      const content = literatureReviewDocument({
        domainName: domain,
        domainSlug: domainSlug(domain),
        createdAt: new Date().toISOString(),
        body: `# ${domain} · 文献综述\n\n${cleanBody}`,
      });
      await this.cards.writeText(path, content);

      if (candidates.length > 0) {
        await this.cards.writeText(
          this.candidateStorePath(domain),
          JSON.stringify(candidates, null, 2),
        );
      }

      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.cards.openFile(file);

      progress.hide();
      this.notice(
        candidates.length > 0
          ? `综述已生成，解析到 ${candidates.length} 篇候选文献。点领域行的「选文献」挑要读的。`
          : "综述已生成，但两次都没解析到候选清单。可以重试，或手动添加文献。",
      );
      await this.refreshOverview();
    } catch (error) {
      progress.hide();
      this.notice(`生成失败：${(error as Error).message}`);
    }
  }

  /** 候选清单的落盘位置：只留在系统目录，正文里不带。 */
  private candidateStorePath(domain: string): string {
    return systemFile(`候选文献-${domainSlug(domain)}.json`);
  }

  private async readStoredCandidates(domain: string): Promise<ReviewCandidate[]> {
    const text = await this.cards.readTextPath(this.candidateStorePath(domain));
    if (!text) return [];

    try {
      const data: unknown = JSON.parse(text);
      if (!Array.isArray(data)) return [];

      const list: ReviewCandidate[] = [];
      for (const item of data) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        if (typeof record.title !== "string" || record.title.trim().length === 0) continue;
        list.push(item as ReviewCandidate);
      }
      return list;
    } catch {
      return [];
    }
  }

  async openCandidatePicker(domain: string): Promise<void> {
    const path = literatureReviewPath(domain);
    const markdown = await this.cards.readTextPath(path);
    if (!markdown) {
      this.notice("还没有综述。先点领域名生成综述。");
      return;
    }

    let candidates = await this.readStoredCandidates(domain);

    // 兼容旧版本：清单直接留在综述正文里。读到就顺手迁移并清理正文。
    if (candidates.length === 0) {
      candidates = parseCandidates(markdown);
      if (candidates.length > 0) {
        await this.cards.writeText(
          this.candidateStorePath(domain),
          JSON.stringify(candidates, null, 2),
        );
        await this.cards.writeText(path, stripCandidates(markdown));
      }
    }

    if (candidates.length === 0) {
      this.notice("综述里没有候选文献清单。可以重新生成综述，或手动添加文献。");
      return;
    }

    new CandidateModal(this.app, this, domain, candidates, () => void this.refreshOverview()).open();
  }

  private contextFrom(item: LiteratureSummary): CardContext {
    return {
      domain: item.domain,
      domainSlug: domainSlug(item.domain),
      citekey: item.citekey,
      folder: item.folder,
      literatureTitle: item.title,
      authors: item.authors,
      year: item.year,
      doi: item.doi,
      url: item.url,
    };
  }

  private activeFile(): TFile | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file ?? null;
  }

  private async validateCurrent(): Promise<void> {
    const file = this.activeFile();
    if (!file) {
      this.notice("先打开一张卡片文件");
      return;
    }

    const parsed = await this.cards.readCard(file);
    if (!parsed.ok) {
      const detail = parsed.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join(".") || "(根)"}：${issue.message}`)
        .join("\n");
      this.notice(`${parsed.code}：${parsed.message}${detail ? `\n${detail}` : ""}`);
      return;
    }

    const readiness = checkPublishable(parsed.card);
    const lines = [
      `✅ ${parsed.card.schema} 格式合法`,
      readiness.blockers.length > 0
        ? `⛔ 阻断项：\n${readiness.blockers.map((item) => `· ${item.message}`).join("\n")}`
        : "✅ 无阻断项",
      readiness.warnings.length > 0
        ? `⚠️ 提醒：\n${readiness.warnings.map((item) => `· ${item.message}`).join("\n")}`
        : "",
    ].filter(Boolean);
    this.notice(lines.join("\n"));
  }

  /**
   * 文献整理：PDF → OCR → 分节 → 英文逐段译文。
   *
   * 边界：
   * - 只上传「原文.pdf」这一个文件，卡片与笔记永不上传；
   * - 首次使用要用户明确同意（PDF 会发给 AI 服务商做 OCR）；
   * - 结果写 <文件夹>-全文.md，已存在则先备份；
   * - 图表本版只留占位符，不裁图。
   */
  async organizeLiterature(item: LiteratureSummary): Promise<void> {
    if (!this.ai.ready) {
      this.notice("先配置 AI：设置 → 研究性学习社区 → AI（OCR 也走这个 Key）");
      return;
    }

    if (!this.settings.organizeConsent) {
      new OrganizeConsentModal(this.app, () => {
        this.settings.organizeConsent = true;
        void this.saveSettings().then(() => this.organizeLiterature(item));
      }).open();
      return;
    }

    const folder = item.folder;
    const pdfRel = item.pdfPath ?? pdfPath(item.domain, folder);
    const pdfFile = this.app.vault.getAbstractFileByPath(pdfRel);
    if (!(pdfFile instanceof TFile)) {
      this.notice(
        `没有找到原文 PDF：请先「下载原文」，或把文件放到 ${pdfRel}`,
      );
      return;
    }

    const target = fullTextPath(item.domain, folder);
    if (await this.cards.exists(target)) {
      const old = await this.cards.readTextPath(target);
      if (old) {
        await this.cards.writeText(
          `00-系统/backup/${safeSegment(folder, "lit")}-全文-${Date.now()}.md`,
          old,
        );
      }
    }

    const progress = new Notice(`正在整理《${item.title}》…`, 0);
    try {
      const data = await this.app.vault.readBinary(pdfFile);
      const result = await this.organize.organize({
        title: item.title,
        citekey: item.citekey,
        authors: item.authors,
        year: item.year,
        doi: item.doi,
        pdf: data,
        onProgress: (message) => progress.setMessage(message),
        onOcrRaw: async (pages) => {
          // 留一份最近一次的原始 OCR 输出，出问题时有据可查。
          await this.cards.writeText(
            "00-系统/ocr-最近一次.json",
            JSON.stringify(pages, null, 2),
          );
        },
      });

      await this.cards.writeText(target, result.content);
      progress.hide();

      const file = this.app.vault.getAbstractFileByPath(target);
      if (file instanceof TFile) await this.cards.openFile(file);

      this.notice(
        `已整理：${result.pages} 页 · ${result.figures} 个图表占位 · ${
          result.bilingual ? "双语对照" : "原文"
        }`,
      );
      await this.refreshOverview();
    } catch (error) {
      progress.hide();
      this.notice(`整理失败：${(error as Error).message}`);
    }
  }

  private async publishCurrent(): Promise<void> {
    const file = this.activeFile();
    if (!file) {
      this.notice("先打开要发布的卡片文件，或在总览里点卡片右侧的「发布」");
      return;
    }
    await this.publishFile(file);
  }

  /** 发布入口的统一实现：命令、右键菜单、总览按钮都走这里。 */
  async publishFile(file: TFile): Promise<void> {
    const parsed = await this.cards.readCard(file);
    if (!parsed.ok) {
      this.notice(`不能发布：${parsed.message}`);
      return;
    }

    const markdown = await this.cards.readText(file);
    const result = await this.publisher.publish(file, parsed.card, markdown);
    this.notice(result.message);

    if (result.ok) {
      // 发布成功后展开它所在的文献与领域。
      const parts = file.path.split("/");
      if (parts.length >= 5 && parts[0] === "领域" && parts[2] === "文献") {
        const domain = parts[1] ?? "";
        const folder = parts[3] ?? "";
        this.settings.literatureOpen[`领域/${domain}/文献/${folder}/${folder}.md`] = "open";
        this.settings.collapsedDomains = this.settings.collapsedDomains.filter(
          (name) => name !== domain,
        );
        await this.saveSettings();
      }
    }

    await this.refreshStatus();
    await this.refreshOverview();
  }

  async publishCardByPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.notice("找不到卡片文件，可能已被移动或删除");
      return;
    }
    await this.publishFile(file);
  }

  async retryOutbox(): Promise<void> {
    const count = await this.publisher.outboxCount();
    if (count === 0) {
      this.notice("待发布队列是空的");
      return;
    }

    const result = await this.publisher.retryAll();
    const firstError = result.errors[0];
    this.notice(
      `重试完成：成功 ${result.succeeded}，失败 ${result.failed}${firstError ? `\n${firstError}` : ""}`,
    );
    await this.refreshStatus();
    await this.refreshOverview();
  }

  private async refreshStatus(): Promise<void> {
    if (!this.statusEl) return;
    try {
      const count = await this.publisher.outboxCount();
      this.statusEl.setText(count > 0 ? `研究性学习 · 待发布 ${count}` : "研究性学习");
      this.statusEl.setAttribute("aria-label", count > 0 ? "点击重试待发布队列" : "研究性学习社区");
    } catch {
      this.statusEl.setText("研究性学习");
    }
  }
}
