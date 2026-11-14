import type { AiClient } from "./ai";
import type { RlcSettings } from "../settings";
import { chunkText, cleanOcrPages, looksChinese } from "./ocr-parse";
import { ocrPdf } from "./ocr";
import { organizeChunkMessages } from "./organize-prompt";
import { buildFullTextDocument, renderFigurePlaceholders, stripLeadingTitle } from "./organize-doc";

export interface OrganizeInput {
  title: string;
  citekey: string;
  authors: string[];
  year?: number;
  doi?: string;
  pdf: ArrayBuffer;
  onProgress?: (message: string) => void;
  /** 保存原始 OCR 输出，便于排查分栏/漏页问题。 */
  onOcrRaw?: (pages: unknown) => Promise<void> | void;
}

export interface OrganizeResult {
  content: string;
  pages: number;
  figures: number;
  bilingual: boolean;
}

export class OrganizeService {
  constructor(
    private readonly ai: AiClient,
    private readonly getSettings: () => RlcSettings,
  ) {}

  async organize(input: OrganizeInput): Promise<OrganizeResult> {
    const settings = this.getSettings();
    if (!settings.aiApiKey || !settings.aiBaseUrl) {
      throw new Error("尚未配置 AI：设置 → 研究性学习社区 → AI");
    }

    input.onProgress?.("正在识别 PDF 文字（扫描件可能要一两分钟）…");
    const pages = await ocrPdf({
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      filename: `${input.citekey}.pdf`,
      data: input.pdf,
    });

    const cleaned = cleanOcrPages(pages);
    if (cleaned.text.trim().length < 20) {
      throw new Error("OCR 识别出的文字太少：可能是扫描质量差、加密文件，或 PDF 只有图片");
    }

    await input.onOcrRaw?.({ citekey: input.citekey, pages });

    // 文档标题已经在 frontmatter 与正文 H1 里出现，送去翻译前先去掉重复的开头。
    const bodyText = stripLeadingTitle(cleaned.text, input.title);

    const bilingual = settings.organizeBilingual && !looksChinese(bodyText);
    const chunks = chunkText(bodyText, 4000);
    const parts: string[] = [];

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index] ?? "";
      input.onProgress?.(
        `正在整理${bilingual ? "并翻译" : ""}第 ${index + 1}/${chunks.length} 段…`,
      );

      let accepted = false;
      let lastLength = 0;

      // 模型偶尔会只输出一小段（曾经导致开头整段丢失）。低于 30% 就重试一次，
      // 两次都异常就中止——宁可失败，也不写出残缺的全文。
      for (let attempt = 0; attempt < 2 && !accepted; attempt += 1) {
        const markdown = await this.ai.chat(
          organizeChunkMessages({
            title: input.title,
            bilingual,
            chunkIndex: index + 1,
            chunkTotal: chunks.length,
            text: chunk,
            retry: attempt > 0,
          }),
          { maxTokens: 4096, temperature: attempt > 0 ? 0.1 : 0.2 },
        );

        const rendered = renderFigurePlaceholders(markdown);
        lastLength = rendered.length;
        if (rendered.length >= Math.min(400, Math.floor(chunk.length * 0.3))) {
          parts.push(rendered);
          accepted = true;
        }
      }

      if (!accepted) {
        throw new Error(
          `第 ${index + 1}/${chunks.length} 段整理结果异常（${lastLength} 字），已中止，未写出残缺全文`,
        );
      }
    }

    const content = buildFullTextDocument({
      title: input.title,
      citekey: input.citekey,
      authors: input.authors,
      year: input.year,
      doi: input.doi,
      pages: cleaned.pageCount,
      figures: cleaned.figures,
      bilingual,
      body: parts.join("\n\n"),
    });

    return {
      content,
      pages: cleaned.pageCount,
      figures: cleaned.figures,
      bilingual,
    };
  }
}
