import { parseLiterature } from "@rlc/contract";
import {
  citekeyFor,
  domainSlug,
  literatureDir,
  literatureFolder,
  literatureNotePath,
  literatureTemplate,
} from "@rlc/vault-core";
import type { CardService } from "./card-service";

export interface NewLiteratureInput {
  domain: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  url?: string;
}

export type CreateLiteratureResult =
  | { ok: true; citekey: string; folder: string; path: string }
  | { ok: false; code: "EXISTS" | "INVALID"; message: string };

/** 文献入库的唯一入口：手工添加与候选清单勾选都走这里。 */
export class LiteratureService {
  constructor(private readonly cards: CardService) {}

  async create(input: NewLiteratureInput): Promise<CreateLiteratureResult> {
    const now = new Date().toISOString();
    const citekey = citekeyFor({
      title: input.title,
      authors: input.authors,
      year: input.year,
      doi: input.doi,
    });

    const parsed = parseLiterature({
      schema: "lit@1",
      citekey,
      domain: { name: input.domain, slug: domainSlug(input.domain) },
      title: input.title,
      authors: input.authors,
      ...(input.year ? { year: input.year } : {}),
      ...(input.doi ? { doi: input.doi } : {}),
      ...(input.url ? { url: input.url } : {}),
      status: "to_read",
      addedAt: now,
      updatedAt: now,
    });

    if (!parsed.ok) {
      return {
        ok: false,
        code: "INVALID",
        message: parsed.issues[0]?.message ?? parsed.message,
      };
    }

    // 文件夹用可读标题（截断），citekey 仍写进 frontmatter。
    // 同名文献加序号，避免两篇标题相同的文献抢同一个目录。
    const baseFolder = literatureFolder(input.title, citekey);
    let folder = baseFolder;
    let path = literatureNotePath(input.domain, folder);
    let attempt = 2;
    while (await this.cards.exists(path)) {
      folder = `${baseFolder} (${attempt})`;
      path = literatureNotePath(input.domain, folder);
      attempt += 1;
      if (attempt > 50) {
        return { ok: false, code: "EXISTS", message: `同名文献过多：${baseFolder}` };
      }
    }

    await this.cards.writeText(path, literatureTemplate(parsed.note));
    return { ok: true, citekey, folder, path };
  }

  /** 把开放获取的 PDF 写进文献目录，返回 Vault 相对路径。 */
  async attachPdf(domain: string, folder: string, data: ArrayBuffer): Promise<string> {
    return this.cards.writeAsset(literatureDir(domain, folder), "原文.pdf", data);
  }
}
