import { App, TFile, normalizePath } from "obsidian";
import type { PracticeCardV1, PracticeProcessEntry } from "@rlc/contract";
import type { CardService } from "./card-service";

export interface DailyNoteConfig {
  folder: string;
  format: string;
  template: string;
}

const DEFAULT_CONFIG: DailyNoteConfig = { folder: "", format: "YYYY-MM-DD", template: "" };
const SECTION = "## 实践";

/**
 * 实践卡与每日笔记的桥。
 *
 * 设计约定（见 docs/实践卡设计.md）：
 * - 过程记录以每日笔记为源，卡片里的 process 只是缓存；
 * - 每日笔记只在 `## 实践` 区块内追加；
 * - 标记注释是解析锚点，阅读视图不可见。
 */
export class PracticeService {
  constructor(
    private readonly app: App,
    private readonly cards: CardService,
  ) {}

  /** 读核心「日记」插件配置；读不到时用兜底值。 */
  async config(): Promise<DailyNoteConfig> {
    try {
      const raw = await this.app.vault.adapter.read(".obsidian/daily-notes.json");
      const parsed = JSON.parse(raw) as { folder?: string; format?: string; template?: string };
      return {
        folder: typeof parsed.folder === "string" ? parsed.folder : DEFAULT_CONFIG.folder,
        format: typeof parsed.format === "string" ? parsed.format : DEFAULT_CONFIG.format,
        template: typeof parsed.template === "string" ? parsed.template : DEFAULT_CONFIG.template,
      };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  formatDate(date: Date, format: string): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return format
      .replace(/YYYY/g, String(date.getFullYear()))
      .replace(/YY/g, String(date.getFullYear()).slice(-2))
      .replace(/MMMM/g, String(date.getMonth() + 1))
      .replace(/MM/g, pad(date.getMonth() + 1))
      .replace(/M/g, String(date.getMonth() + 1))
      .replace(/DD/g, pad(date.getDate()))
      .replace(/D/g, String(date.getDate()));
  }

  async dailyNotePath(date = new Date()): Promise<string> {
    const config = await this.config();
    const name = `${this.formatDate(date, config.format)}.md`;
    return normalizePath(config.folder ? `${config.folder}/${name}` : name);
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!folder) return;
    let current = "";
    for (const part of folder.split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private async ensureFile(path: string): Promise<TFile> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;

    const slash = path.lastIndexOf("/");
    if (slash > 0) await this.ensureFolder(path.slice(0, slash));

    const config = await this.config();
    let base = `${SECTION}\n`;
    if (config.template) {
      const template = this.app.vault.getAbstractFileByPath(config.template);
      if (template instanceof TFile) {
        const content = await this.app.vault.read(template);
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, "0");
        const filled = content
          .replace(/\{\{date\}\}/g, this.formatDate(now, config.format))
          .replace(/\{\{time\}\}/g, `${pad(now.getHours())}:${pad(now.getMinutes())}`)
          .replace(/\{\{title\}\}/g, path.split("/").pop()?.replace(/\.md$/, "") ?? "");
        base = filled.includes(SECTION) ? filled : `${filled.replace(/\s*$/, "")}\n\n${SECTION}\n`;
      }
    }
    return this.app.vault.create(path, base);
  }

  /** 只追加到 `## 实践` 区块；没有该标题就建在文末。 */
  async appendBlock(date: Date, block: string): Promise<TFile> {
    const path = await this.dailyNotePath(date);
    const file = await this.ensureFile(path);
    const content = await this.app.vault.read(file);
    const marker = `${SECTION}\n`;
    let next: string;

    if (content.includes(SECTION)) {
      const start = content.indexOf(SECTION) + SECTION.length;
      const rest = content.slice(start);
      const nextHeading = rest.search(/\n## /);
      if (nextHeading < 0) {
        next = `${content.replace(/\s*$/, "")}\n\n${block}\n`;
      } else {
        const insertAt = start + nextHeading;
        next = `${content.slice(0, insertAt).replace(/\s*$/, "")}\n\n${block}\n${content.slice(insertAt)}`;
      }
    } else {
      next = `${content.replace(/\s*$/, "")}\n\n${SECTION}\n\n${block}\n`;
    }

    await this.app.vault.modify(file, next);
    return file;
  }

  planMarker(cardId: string): string {
    return `<!-- rlc-plan: card=${cardId} -->`;
  }

  processMarker(cardId: string, entryId: string): string {
    return `<!-- rlc-process: card=${cardId} entry=${entryId} -->`;
  }

  /** 当天计划行（幂等）。 */
  async writePlanLine(card: PracticeCardV1): Promise<void> {
    if (!card.plan.scheduledFor) return;
    const today = this.formatDate(new Date(), "YYYY-MM-DD");
    if (card.plan.scheduledFor !== today) return;

    const path = await this.dailyNotePath(new Date());
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      const content = await this.app.vault.read(existing);
      if (content.includes(this.planMarker(card.cardId))) return;
    }

    const block = [
      `- [ ] ${card.title} · 计划今天`,
      `  ${this.planMarker(card.cardId)}`,
    ].join("\n");
    await this.appendBlock(new Date(), block);
  }

  /** 写一条过程记录：先写日记，再更新卡片缓存。 */
  async writeProcessEntry(card: PracticeCardV1, cardFile: TFile, entry: PracticeProcessEntry): Promise<void> {
    const date = new Date(entry.date);
    const block = [
      `- **${entry.what}** · ${this.formatDate(date, "MM-DD")}`,
      `  ${this.processMarker(card.cardId, entry.entryId)}`,
      ...(entry.evidence ? [`  - 证据：${entry.evidence}`] : []),
      ...(entry.obstacle ? [`  - 阻碍：${entry.obstacle}`] : []),
      ...(entry.adjust ? [`  - 调整：${entry.adjust}`] : []),
    ].join("\n");
    const note = await this.appendBlock(date, block);

    const parsed = await this.cards.readCard(cardFile);
    if (parsed.ok && parsed.card.schema === "pc-card@1") {
      if (!parsed.card.process.some((item) => item.entryId === entry.entryId)) {
        parsed.card.process.push({ ...entry, sourcePath: note.path });
        parsed.card.updatedAt = new Date().toISOString();
        await this.cards.writeCard(cardFile.path, parsed.card);
      }
    }
  }

  /** 更新步骤勾选。 */
  async toggleStep(cardFile: TFile, index: number, done: boolean): Promise<void> {
    const parsed = await this.cards.readCard(cardFile);
    if (!parsed.ok || parsed.card.schema !== "pc-card@1") return;
    const step = parsed.card.plan.steps[index];
    if (!step) return;
    step.done = done;
    if (done) step.doneAt = new Date().toISOString();
    else delete step.doneAt;
    parsed.card.updatedAt = new Date().toISOString();
    await this.cards.writeCard(cardFile.path, parsed.card);
  }

  async saveSummary(
    cardFile: TFile,
    summary: { outcome: string; delta?: string; nextTime?: string },
  ): Promise<void> {
    const parsed = await this.cards.readCard(cardFile);
    if (!parsed.ok || parsed.card.schema !== "pc-card@1") return;
    parsed.card.summary = summary;
    parsed.card.updatedAt = new Date().toISOString();
    await this.cards.writeCard(cardFile.path, parsed.card);
  }

  /** 读取某篇日记里的计划勾选状态。 */
  async readPlanChecks(file: TFile): Promise<Map<string, boolean>> {
    const content = await this.app.vault.read(file);
    const result = new Map<string, boolean>();
    const pattern = /- \[( |x|X)\] .*<!-- rlc-plan: card=([^\s]+) -->/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      result.set(match[2] ?? "", (match[1] ?? " ").toLowerCase() === "x");
    }
    return result;
  }

  /** 把计划行改回未勾选（用户取消记录时）。 */
  async uncheckPlan(file: TFile, cardId: string): Promise<void> {
    const content = await this.app.vault.read(file);
    const pattern = new RegExp(
      `- \\[x\\] ([^\\n]*)\\n(\\s*)<!-- rlc-plan: card=${cardId} -->`,
      "i",
    );
    const next = content.replace(pattern, "- [ ] $1\n$2<!-- rlc-plan: card=" + cardId + " -->");
    if (next !== content) await this.app.vault.modify(file, next);
  }
}
