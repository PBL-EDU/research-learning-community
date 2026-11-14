import { requestUrl } from "obsidian";
import type { PromoVariant } from "@rlc/contract";
import type { RlcSettings } from "../settings";

/**
 * 海报生成：先用 seedream 画插画，再在本地 Canvas 排版成 1080×1440。
 *
 * 为什么文字不用 AI 画：中文生图容易糊、容易错字；排版交给 Canvas 才稳定。
 */

export interface PosterText {
  label: string;
  title: string;
  body: string;
  footerLeft: string;
  footerRight: string;
}

const W = 1080;
const H = 1440;
const IMG_H = 820;
const MARGIN = 72;
const CREAM = "#F7F3EA";
const INK = "#1F1B16";
const BODY = "#3A342C";
const MUTED = "#8A8275";
const ACCENT = "#C46A2D";
const FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

export function posterPrompt(variant: PromoVariant): string {
  const firstLine = variant.bodyMd.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return [
    "Bold flat vector editorial illustration for a teenage psychology poster.",
    `Theme: ${variant.title}.`,
    variant.hook ? `Metaphor: ${variant.hook}.` : "",
    firstLine ? `Scene hint: ${firstLine}` : "",
    "Strong visual metaphor, geometric paper-cut shapes, subtle grain texture, warm versus cool color contrast, off-white background.",
    "Absolutely no text, no letters, no numbers, no watermark. Square composition, dramatic scale, magazine cover energy.",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function generateIllustration(
  settings: RlcSettings,
  prompt: string,
): Promise<ArrayBuffer> {
  if (!settings.imageApiKey) {
    throw new Error("还没配置生图 Key：设置 → 研究性学习社区 → 海报配图（seedream）");
  }

  const base = settings.imageBaseUrl.trim().replace(/\/+$/, "");
  const response = await requestUrl({
    url: `${base}/images/generations`,
    method: "POST",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${settings.imageApiKey}` },
    body: JSON.stringify({
      model: settings.imageModel,
      prompt,
      size: "1024x1024",
      watermark: false,
    }),
    throw: false,
  });

  if (response.status >= 400) {
    throw new Error(`生图失败（${response.status}）：${response.text.slice(0, 160)}`);
  }

  const url = response.json?.data?.[0]?.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("生图接口没有返回图片地址");
  }

  const image = await requestUrl({ url, method: "GET", throw: false });
  if (image.status >= 400) {
    throw new Error(`下载图片失败（${image.status}）`);
  }
  return image.arrayBuffer;
}

async function loadImage(buffer: ArrayBuffer): Promise<HTMLImageElement> {
  const blob = new Blob([buffer], { type: "image/jpeg" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("插画解码失败"));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const char of paragraph) {
      const next = current + char;
      if (ctx.measureText(next).width > maxWidth && current.length > 0) {
        lines.push(current);
        current = char;
        if (lines.length >= maxLines) break;
      } else {
        current = next;
      }
    }
    if (lines.length >= maxLines) break;
    if (current.length > 0) lines.push(current);
  }

  if (lines.length > maxLines) lines.length = maxLines;
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1] ?? "";
    const overflow = text.replace(/\s/g, "").length > lines.join("").replace(/\s/g, "").length;
    if (overflow && !last.endsWith("…")) {
      lines[maxLines - 1] = last.slice(0, Math.max(0, last.length - 1)) + "…";
    }
  }
  return lines;
}

export async function composePoster(
  illustration: ArrayBuffer | null,
  text: PosterText,
): Promise<ArrayBuffer> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");

  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);

  if (illustration) {
    const image = await loadImage(illustration);
    const ratio = Math.max(W / image.width, IMG_H / image.height);
    const drawW = image.width * ratio;
    const drawH = image.height * ratio;
    ctx.drawImage(image, (W - drawW) / 2, (IMG_H - drawH) / 2, drawW, drawH);

    const fade = ctx.createLinearGradient(0, IMG_H - 150, 0, IMG_H);
    fade.addColorStop(0, "rgba(247,243,234,0)");
    fade.addColorStop(1, "rgba(247,243,234,1)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, IMG_H - 150, W, 150);
  }

  const maxWidth = W - MARGIN * 2;

  ctx.fillStyle = ACCENT;
  ctx.font = `26px ${FONT_STACK}`;
  ctx.fillText(text.label, MARGIN, 892);

  ctx.fillStyle = INK;
  ctx.font = `bold 66px ${FONT_STACK}`;
  const titleLines = wrapText(ctx, text.title, maxWidth, 2);
  let y = 980;
  for (const line of titleLines) {
    ctx.fillText(line, MARGIN, y);
    y += 92;
  }

  y += 6;
  ctx.fillStyle = ACCENT;
  ctx.fillRect(MARGIN, y - 8, 96, 5);
  y += 56;

  ctx.fillStyle = BODY;
  ctx.font = `30px ${FONT_STACK}`;
  const bodyLines = wrapText(ctx, text.body, maxWidth, 5);
  for (const line of bodyLines) {
    ctx.fillText(line, MARGIN, y);
    y += 54;
  }

  ctx.fillStyle = MUTED;
  ctx.font = `23px ${FONT_STACK}`;
  ctx.fillText(text.footerLeft, MARGIN, 1396);
  const rightWidth = ctx.measureText(text.footerRight).width;
  ctx.fillText(text.footerRight, W - MARGIN - rightWidth, 1396);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92),
  );
  if (!blob) throw new Error("导出海报失败");
  return blob.arrayBuffer();
}

export function posterTextFrom(
  variant: PromoVariant,
  options: { label: string; footerLeft: string },
): PosterText {
  const body = variant.bodyMd
    .replace(/[#>*`]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  return {
    label: options.label,
    title: variant.title,
    body,
    footerLeft: options.footerLeft,
    footerRight: "AI 辅助 · 学习笔记",
  };
}
