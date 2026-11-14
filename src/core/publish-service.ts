import { App, TFile, requestUrl } from "obsidian";
import { checkPublishable, type AnyCardV1, type PromoVariant } from "@rlc/contract";
import { OUTBOX_PATH } from "@rlc/vault-core";
import type { RlcSettings } from "../settings";
import { CardService } from "./card-service";
import { appendOutboxEntry, dropOutboxEntry, parseOutbox } from "./outbox";
import {
  buildMultipart,
  buildPublishPayload,
  guessMime,
  sha256Hex,
  type LocalAsset,
} from "./payload";
import { parsePromoVariants, promoPathForCard } from "./promo";

export interface PublishResult {
  ok: boolean;
  queued: boolean;
  message: string;
}

export class PublishService {
  constructor(
    private readonly app: App,
    private readonly cards: CardService,
    private readonly settings: () => RlcSettings,
  ) {}

  async publish(
    file: TFile,
    card: AnyCardV1,
    markdown: string,
    variants: PromoVariant[] = [],
  ): Promise<PublishResult> {
    const readiness = checkPublishable(card);
    if (!readiness.ok) {
      return {
        ok: false,
        queued: false,
        message: `不能发布：${readiness.blockers.map((item) => item.message).join("；")}`,
      };
    }

    const settings = this.settings();
    if (!settings.serverUrl || !settings.deviceToken) {
      const missing = [
        settings.serverUrl ? "" : "服务端地址",
        settings.deviceToken ? "" : "设备令牌",
      ]
        .filter((item) => item.length > 0)
        .join("、");
      await this.queue(file, card, `未配置${missing}`);
      return {
        ok: false,
        queued: true,
        message: `未配置${missing}：请到「设置 → 研究性学习社区」填写；卡片已进入本地待发布队列。`,
      };
    }

    let assets: LocalAsset[];
    try {
      assets = await this.collectAssets(card);
    } catch (error) {
      return { ok: false, queued: false, message: `读取图片失败：${(error as Error).message}` };
    }

    // 科普版存在卡片旁的侧车 JSON 里；重试队列时也能自动带上。
    const sidecar = await this.cards.readTextPath(promoPathForCard(file.path));
    const variantsToSend = variants.length > 0 ? variants : parsePromoVariants(sidecar);

    // 科普版配图：作为 cover 资源一起上传，门户用大图展示。
    const promoAssets: LocalAsset[] = [];
    for (const variant of variantsToSend) {
      if (!variant.figureImagePath) continue;
      const mime = guessMime(variant.figureImagePath);
      if (!mime) continue;
      const imageFile = this.app.vault.getAbstractFileByPath(variant.figureImagePath);
      if (!(imageFile instanceof TFile)) continue;
      const data = await this.app.vault.readBinary(imageFile);
      promoAssets.push({
        path: variant.figureImagePath,
        role: "cover",
        mime,
        bytes: data.byteLength,
        sha256: await sha256Hex(data),
        data,
      });
      break; // 目前只支持一张配图
    }

    const allAssets = [...assets, ...promoAssets];

    const payload = buildPublishPayload({
      card,
      bodyMd: markdown,
      visibility: card.publish?.visibility ?? "public",
      assets: allAssets,
      variants: variantsToSend,
    });

    const multipart = buildMultipart(
      payload,
      allAssets.map((asset) => ({
        filename: asset.path.split("/").pop() ?? "asset",
        mime: asset.mime,
        data: asset.data,
      })),
    );

    const endpoint = `${settings.serverUrl.replace(/\/+$/, "")}/api/v1/publications`;

    try {
      const response = await requestUrl({
        url: endpoint,
        method: "POST",
        contentType: multipart.contentType,
        headers: { Authorization: `Bearer ${settings.deviceToken}` },
        body: multipart.body,
        throw: false,
      });

      if (response.status >= 200 && response.status < 300) {
        const body = response.json as { id?: string; url?: string; revision?: number };
        await this.cards.patchFile(file, {
          publish: {
            id: body.id,
            url: body.url,
            revision: body.revision ?? 1,
            at: new Date().toISOString(),
            visibility: payload.visibility,
          },
        });
        await this.dropFromOutbox(card.cardId);
        return {
          ok: true,
          queued: false,
          message: `已发布：${body.url ?? body.id ?? "服务器未返回地址"}`,
        };
      }

      const error = this.describeError(response.status, response.json);
      await this.queue(file, card, error);
      return { ok: false, queued: true, message: `发布失败，已进入队列：${error}` };
    } catch (error) {
      const message = `网络错误：${(error as Error).message}`;
      await this.queue(file, card, message);
      return { ok: false, queued: true, message };
    }
  }

  private async collectAssets(card: AnyCardV1): Promise<LocalAsset[]> {
    if (card.schema !== "dr-card@1") return [];
    const assets: LocalAsset[] = [];

    for (const visual of card.visuals) {
      if (visual.kind !== "image") continue;
      const mime = guessMime(visual.path);
      if (!mime) continue;
      const data = await this.cards.readBinaryPath(visual.path);
      if (!data) continue;
      assets.push({
        path: visual.path,
        role: "visual",
        mime,
        bytes: data.byteLength,
        sha256: await sha256Hex(data),
        data,
      });
    }

    return assets;
  }

  private describeError(status: number, body: unknown): string {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    if (error?.code) return `HTTP ${status} ${error.code}：${error.message ?? ""}`.trim();
    return `HTTP ${status}`;
  }

  private async queue(file: TFile, card: AnyCardV1, error: string): Promise<void> {
    const existing = (await this.cards.readTextPath(OUTBOX_PATH)) ?? "";
    const next = appendOutboxEntry(existing, {
      cardId: card.cardId,
      cardPath: file.path,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      lastError: error,
    });
    await this.cards.writeText(OUTBOX_PATH, next);
  }

  private async dropFromOutbox(cardId: string): Promise<void> {
    const existing = (await this.cards.readTextPath(OUTBOX_PATH)) ?? "";
    if (existing.length === 0) return;
    await this.cards.writeText(OUTBOX_PATH, dropOutboxEntry(existing, cardId));
  }

  async retryAll(): Promise<{ succeeded: number; failed: number; errors: string[] }> {
    const content = (await this.cards.readTextPath(OUTBOX_PATH)) ?? "";
    const entries = parseOutbox(content);
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const entry of entries) {
      const file = this.app.vault.getAbstractFileByPath(entry.cardPath);
      if (!(file instanceof TFile)) {
        failed += 1;
        errors.push(`${entry.cardPath}：文件不存在或已移动`);
        continue;
      }
      const parsed = await this.cards.readCard(file);
      if (!parsed.ok) {
        failed += 1;
        errors.push(`${entry.cardPath}：${parsed.message}`);
        continue;
      }
      const markdown = await this.cards.readText(file);
      const result = await this.publish(file, parsed.card, markdown);
      if (result.ok) {
        succeeded += 1;
      } else {
        failed += 1;
        errors.push(`${entry.cardPath}：${result.message}`);
      }
    }

    return { succeeded, failed, errors };
  }

  async outboxCount(): Promise<number> {
    const content = (await this.cards.readTextPath(OUTBOX_PATH)) ?? "";
    return parseOutbox(content).length;
  }

  /** 待发布条目的路径列表，侧栏用来在折叠的文献行上显示「待发布 N」。 */
  async outboxCardPaths(): Promise<string[]> {
    const content = (await this.cards.readTextPath(OUTBOX_PATH)) ?? "";
    return parseOutbox(content).map((entry) => entry.cardPath);
  }
}
