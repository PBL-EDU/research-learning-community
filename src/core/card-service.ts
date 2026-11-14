import { App, TFile, normalizePath } from "obsidian";
import {
  cardFromMarkdown,
  cardToMarkdown,
  patchFrontmatter,
  type AnyCardV1,
  type CardParseResult,
} from "@rlc/vault-core";

/** Vault 读写。所有路径都来自 vault-core，插件里不手拼路径。 */
export class CardService {
  constructor(private readonly app: App) {}

  async ensureFolder(folder: string): Promise<void> {
    const normalized = normalizePath(folder);
    if (normalized === "/" || normalized.length === 0) return;
    let current = "";
    for (const part of normalized.split("/")) {
      current = current.length === 0 ? part : `${current}/${part}`;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(normalizePath(path));
  }

  async writeCard(path: string, card: AnyCardV1): Promise<TFile> {
    const normalized = normalizePath(path);
    const folder = normalized.split("/").slice(0, -1).join("/");
    await this.ensureFolder(folder);

    const content = cardToMarkdown(card);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      return existing;
    }
    return this.app.vault.create(normalized, content);
  }

  async readCard(file: TFile): Promise<CardParseResult> {
    return cardFromMarkdown(await this.app.vault.read(file));
  }

  async readText(file: TFile): Promise<string> {
    return this.app.vault.read(file);
  }

  /** 只改 frontmatter，正文一字不动。 */
  async patchFile(file: TFile, patch: Record<string, unknown>): Promise<void> {
    const content = await this.app.vault.read(file);
    await this.app.vault.modify(file, patchFrontmatter(content, patch));
  }

  async listDomains(): Promise<string[]> {
    if (!(await this.app.vault.adapter.exists("领域"))) return [];
    const listing = await this.app.vault.adapter.list("领域");
    return listing.folders
      .map((folder) => folder.split("/").pop() ?? "")
      .filter((name) => name.length > 0)
      .sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  async writeAsset(folder: string, filename: string, data: ArrayBuffer): Promise<string> {
    await this.ensureFolder(folder);
    const path = normalizePath(`${folder}/${filename}`);
    await this.app.vault.adapter.writeBinary(path, data);
    return path;
  }

  async writeText(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    await this.ensureFolder(normalized.split("/").slice(0, -1).join("/"));
    await this.app.vault.adapter.write(normalized, content);
  }

  async readTextPath(path: string): Promise<string | null> {
    const normalized = normalizePath(path);
    if (!(await this.app.vault.adapter.exists(normalized))) return null;
    return this.app.vault.adapter.read(normalized);
  }

  async readBinaryPath(path: string): Promise<ArrayBuffer | null> {
    const normalized = normalizePath(path);
    if (!(await this.app.vault.adapter.exists(normalized))) return null;
    return this.app.vault.adapter.readBinary(normalized);
  }

  async openFile(file: TFile): Promise<void> {
    await this.app.workspace.getLeaf(true).openFile(file);
  }
}
