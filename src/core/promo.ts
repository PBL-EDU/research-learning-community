import { PromoVariant } from "@rlc/contract";
import type { AiClient, ChatMessage } from "./ai";
import type { AudienceProfile } from "../settings";

/**
 * 科普版：把精读卡片改写成面向某个读者画像的短内容。
 *
 * 边界：
 * - 只使用卡片里的材料，不新增研究结论；
 * - 长度与语气交给模型按画像判断；
 * - 金句必须是卡片引文或 Aha 的凝练，不能凭空造；
 * - 图可选：画不清就不给。
 */
export function promoMessages(input: {
  cardTitle: string;
  cardBody: string;
  sourceLine: string;
  profile: AudienceProfile;
}): ChatMessage[] {
  const rules = [
    "你把学生的学术精读笔记改写成一条面向特定读者的短内容。",
    "",
    `读者画像：${input.profile.name || "未命名读者"}`,
    input.profile.description ? `画像描述：${input.profile.description}` : "",
    "",
    `文献：${input.cardTitle}`,
    input.sourceLine ? `出处：${input.sourceLine}` : "",
    "",
    "学生卡片原文（含原文摘录、体验、Aha、行动指导）：",
    "---",
    input.cardBody,
    "---",
    "",
    "请只输出一个 JSON 对象，字段如下：",
    "{",
    '  "title": "标题，≤20 字，有钩子",',
    '  "hook": "一句话钩子，≤40 字",',
    '  "bodyMd": "正文 Markdown，长度由读者画像决定，信息少就写短，不注水",',
    '  "quote": "金句，≤100 字，必须来自卡片引文或 Aha 的凝练",',
    '  "action": "这周可以做的一件具体事，≤120 字",',
    '  "tags": ["3-5 个标签"],',
    '  "figureMermaid": "可选：关系/分类/流程能画清时给 flowchart TD 或 mindmap；否则空字符串"',
    "}",
    "",
    "硬规则：",
    "1. 只能用卡片里已有的判断，不得新增研究结论或数据。",
    "2. 语气、人称、是否用 emoji 由读者画像决定；不要对青少年说教，也不要用超出他们经验的术语。",
    "3. 涉及情绪、心理主题时，不写诊断、不写医疗建议；行动要安全、具体。",
    "4. 正文分段短，每段不超过 80 字；允许用列表。",
    "5. 只输出 JSON，不要代码块标记，不要前后说明。",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    {
      role: "system",
      content:
        "你是严谨但会讲人话的科普编辑。你只做改写与压缩，不创造事实；读者看不懂的术语要换成日常说法。",
    },
    { role: "user", content: rules },
  ];
}

export async function generatePromo(
  ai: AiClient,
  input: {
    cardTitle: string;
    cardBody: string;
    sourceLine: string;
    profile: AudienceProfile;
  },
): Promise<PromoVariant> {
  return ai.chatJson(promoMessages(input), (value) =>
    PromoVariant.parse({
      ...(value as Record<string, unknown>),
      audienceName: input.profile.name || "读者",
      audienceDescription: input.profile.description || undefined,
    }),
  );
}

/** 读取卡片旁的科普版侧车文件（JSON 数组）。 */
export function parsePromoVariants(text: string | null | undefined): PromoVariant[] {
  if (!text) return [];

  try {
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) return [];

    const variants: PromoVariant[] = [];
    for (const item of data) {
      const parsed = PromoVariant.safeParse(item);
      if (parsed.success) variants.push(parsed.data);
      if (variants.length >= 3) break;
    }
    return variants;
  } catch {
    return [];
  }
}

export function serializePromoVariants(variants: PromoVariant[]): string {
  return JSON.stringify(variants.slice(0, 3), null, 2);
}

/** 卡片路径 → 科普版侧车路径。 */
export function promoPathForCard(cardPath: string): string {
  return cardPath.replace(/\.md$/i, "-promo.json");
}
