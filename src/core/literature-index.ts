import type { App } from "obsidian";
import { parseLiterature } from "@rlc/contract";
import { parseCardPath } from "@rlc/vault-core";
import type { CardSummary, LiteratureSummary } from "./overview";

/**
 * Vault 索引：一次扫描，产出「卡片清单」与「文献清单」。
 *
 * 走 metadataCache 的 frontmatter，不读文件正文——几百篇文献时差别是秒级。
 */
export class VaultIndex {
  constructor(private readonly app: App) {}

  listCards(): CardSummary[] {
    const cards: CardSummary[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      const location = parseCardPath(file.path);
      if (!location || location.kind === "unknown") continue;

      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) continue;

      const schema = typeof frontmatter.schema === "string" ? frontmatter.schema : "";
      if (!/^(dr-card|pc-card|sum-article|sum-domain)@/.test(schema)) continue;

      const publish = frontmatter.publish as { id?: unknown; url?: unknown } | undefined;

      cards.push({
        path: file.path,
        kind: typeof frontmatter.kind === "string" ? frontmatter.kind : location.kind,
        title: typeof frontmatter.title === "string" ? frontmatter.title : file.basename,
        domain: location.domain,
        citekey: location.citekey,
        updatedAt: typeof frontmatter.updatedAt === "string" ? frontmatter.updatedAt : undefined,
        publishId: typeof publish?.id === "string" ? publish.id : undefined,
        publishUrl: typeof publish?.url === "string" ? publish.url : undefined,
      });
    }

    return cards;
  }

  listLiteratures(): LiteratureSummary[] {
    const cards = this.listCards();
    const counts = new Map<string, number>();
    for (const card of cards) {
      if (!card.citekey) continue;
      const key = `${card.domain}/${card.citekey}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // 文献文件夹里可能有一个手动放入、名字任意的 PDF；按目录建索引一次。
    const pdfByFolder = new Map<string, string>();
    for (const file of this.app.vault.getFiles()) {
      if (file.extension.toLowerCase() !== "pdf") continue;
      const parent = file.parent?.path ?? "";
      if (!pdfByFolder.has(parent)) pdfByFolder.set(parent, file.path);
    }

    const literatures: LiteratureSummary[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const parts = file.path.split("/");
      // 新布局：领域/<领域>/文献/<文件夹>/<文件夹>.md（文件夹是可读标题，截断）
      if (parts.length !== 5 || parts[0] !== "领域" || parts[2] !== "文献") continue;
      const folder = parts[3] ?? "";
      if (folder.length === 0 || file.basename !== folder) continue;

      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const parsed = parseLiterature(frontmatter);
      if (!parsed.ok) continue;

      const note = parsed.note;

      // PDF 直接放在文献文件夹里，文件名可以任意（手动下载的常常带长标题）。
      // 优先级：frontmatter 里的 pdfPath → 原文.pdf → 目录里任意一个 PDF。
      const folderPath = file.parent?.path ?? "";
      const defaultPdf = `${folderPath}/原文.pdf`;
      let resolvedPdf: string | undefined;
      if (note.pdfPath && this.app.vault.getAbstractFileByPath(note.pdfPath)) {
        resolvedPdf = note.pdfPath;
      } else if (this.app.vault.getAbstractFileByPath(defaultPdf)) {
        resolvedPdf = defaultPdf;
      } else {
        resolvedPdf = pdfByFolder.get(folderPath);
      }

      literatures.push({
        domain: note.domain.name,
        citekey: note.citekey,
        folder,
        title: note.title,
        ...(note.titleZh ? { titleZh: note.titleZh } : {}),
        authors: note.authors,
        year: note.year,
        doi: note.doi,
        url: note.url,
        pdfPath: resolvedPdf,
        status: note.status,
        notePath: file.path,
        cardCount: counts.get(`${note.domain.name}/${folder}`) ?? 0,
        updatedAt: note.updatedAt,
      });
    }

    return literatures;
  }

  async listDomains(): Promise<string[]> {
    const root = "领域";
    if (!(await this.app.vault.adapter.exists(root))) return [];
    const listing = await this.app.vault.adapter.list(root);
    return listing.folders
      .map((folder) => folder.split("/").pop() ?? "")
      .filter((name) => name.length > 0)
      .sort((a, b) => a.localeCompare(b, "zh-CN"));
  }
}
