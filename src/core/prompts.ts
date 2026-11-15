import type { ChatMessage } from "./ai";

export const EDITOR_SYSTEM = [
  "你是一位研究性学习的写作教练，服务对象是正在读文献、做实践的中学生与大学生。",
  "你的任务不是替他们写感悟，而是把他们的零散笔记提炼成结构清晰、可被追问的想法。",
  "硬规则：",
  "1. 绝不编造原文。原文摘录只能由学生提供，你不得自行生成引文。",
  "2. 不写空话。每条判断都要落在具体的场景、动作或反例上。",
  "3. 如果学生给的信息不足以支撑某一段，就写「这里还需要你补充：…」，而不是填充套话。",
  "4. 用中文，语气平实，不用「赋能」「抓手」这类词。",
].join("\n");

export interface PaperBrief {
  title: string;
  authors?: string[];
  year?: number;
  doi?: string;
}

export interface DeepReadDraftInput {
  paper: PaperBrief;
  /** 学生自己粘贴的原文摘录——AI 只能围绕它工作，不得改写或延伸引用。 */
  quote: string;
  /** 学生的零散笔记，可以为空。 */
  notes?: string;
  domain: string;
  theme?: string;
}

export function deepReadDraftMessages(input: DeepReadDraftInput): ChatMessage[] {
  const meta = [
    `文献：${input.paper.title}`,
    input.paper.authors?.length ? `作者：${input.paper.authors.join("、")}` : "",
    input.paper.year ? `年份：${input.paper.year}` : "",
    input.paper.doi ? `DOI：${input.paper.doi}` : "",
    `领域：${input.domain}${input.theme ? ` / 主题：${input.theme}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    meta,
    "",
    "学生提供的原文摘录（唯一允许引用的原文，不得改写、不得再加引文）：",
    `「${input.quote}」`,
    "",
    input.notes?.trim() ? `学生的零散笔记：\n${input.notes.trim()}` : "学生暂时没有补充笔记。",
    "",
    "请据此起草精读卡片的思考部分。只输出 JSON，不要任何解释文字：",
    "{",
    '  "experience": "学生的生活/学习体验：一个具体的场景，不要泛泛而谈",',
    '  "insight": "Aha：这段话推翻了什么默认假设？说清「原来我以为…，现在发现…」",',
    '  "inspiration": "由此产生的新启发或新问题",',
    '  "meaning": "对生活的意义：它改变了什么观念，或让人能做什么",',
    '  "conceptLevel": "高 | 中 | 低",',
    '  "conceptNote": "一句话说清它改变了哪个认知",',
    '  "actions": [{"action": "一个下周就能做的具体动作", "trigger": "什么时候做", "metric": "怎么算做到了"}]',
    "}",
    "",
    "要求：每个字段 60–200 字；actions 给 1–2 条；信息不足的字段写「这里还需要你补充：…」。",
  ].join("\n");

  return [
    { role: "system", content: EDITOR_SYSTEM },
    { role: "user", content: user },
  ];
}

export interface DraftResult {
  experience: string;
  insight: string;
  inspiration: string;
  meaning: string;
  conceptLevel: "高" | "中" | "低";
  conceptNote: string;
  actions: Array<{ action: string; trigger?: string; metric?: string }>;
}

/** 校验模型返回的草稿；缺字段直接报错，不做「尽力补全」。 */
export function parseDraftResult(value: unknown): DraftResult {
  const record = value as Record<string, unknown>;
  const pick = (key: string): string => {
    const field = record?.[key];
    if (typeof field !== "string" || field.trim().length === 0) {
      throw new Error(`缺少字段 ${key}`);
    }
    return field.trim();
  };
  const level = record?.conceptLevel;
  const conceptLevel = level === "高" || level === "中" || level === "低" ? level : "中";
  const actions = Array.isArray(record?.actions) ? record.actions : [];
  const parsedActions = actions
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item?.action === "string" && item.action.trim().length > 0)
    .map((item) => ({
      action: String(item.action).trim(),
      trigger: typeof item.trigger === "string" ? item.trigger.trim() : undefined,
      metric: typeof item.metric === "string" ? item.metric.trim() : undefined,
    }));

  return {
    experience: pick("experience"),
    insight: pick("insight"),
    inspiration: pick("inspiration"),
    meaning: pick("meaning"),
    conceptLevel,
    conceptNote: pick("conceptNote"),
    actions: parsedActions.length > 0 ? parsedActions : [{ action: "这里还需要你补充：下周能做的一件小事" }],
  };
}

export function skimReportMessages(input: {
  paper: PaperBrief;
  abstract?: string;
}): ChatMessage[] {
  const user = [
    `文献：${input.paper.title}`,
    input.paper.doi ? `DOI：${input.paper.doi}` : "",
    input.abstract?.trim() ? `摘要/正文片段：\n${input.abstract.trim()}` : "没有摘要，只根据题目做初筛判断。",
    "",
    "输出一份略读报告，Markdown，包含四节：",
    "## 研究问题（一句话）",
    "## 方法（怎么做的）",
    "## 结论（作者主张什么）",
    "## 是否值得精读（给 3 条理由，并给出 精读/跳过 的判断）",
    "",
    "信息不足的节写「摘要未提供，需要看原文」，不要猜。",
    "",
    "最后附一段机器可读结论（HTML 注释，学生看不见）：",
    '<!-- rlc:verdict {"decision":"deep_read","confidence":"高","reasons":["理由一","理由二"]} rlc:verdict -->',
    "decision 只能是 deep_read 或 skip；只有摘要没有正文时，可以给 skip 并说明「需看原文再定」。",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: EDITOR_SYSTEM },
    { role: "user", content: user },
  ];
}

export interface LiteratureBrief {
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
}

/** 文献标题翻译：只翻标题，一次一句，结果存进 frontmatter。 */
export function translateTitleMessages(title: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是学术翻译。把英文文献标题译成简洁、准确的中文，保持学科术语的通行译法。只输出译文，不要引号、不要原文、不要解释。",
    },
    { role: "user", content: title },
  ];
}

/**
 * 领域文献综述。
 *
 * 硬约束：只能引用「已经录入本领域」的文献。
 * 综述是最容易长出假引文的地方，所以提示词里把可用文献穷举出来，
 * 并明确允许写「证据不足」——比让它自由发挥安全得多。
 */
export function literatureReviewMessages(input: {
  domain: string;
  literatures: LiteratureBrief[];
  focus?: string;
}): ChatMessage[] {
  const list = input.literatures
    .map((item, index) => {
      const meta = [
        item.authors.length > 0 ? item.authors.join("、") : "",
        item.year ? String(item.year) : "",
        item.doi ? `DOI:${item.doi}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `${index + 1}. ${item.title}${meta ? `（${meta}）` : ""}`;
    })
    .join("\n");

  const user = [
    `领域：${input.domain}`,
    input.focus?.trim() ? `关注问题：${input.focus.trim()}` : "",
    "",
    "本领域已录入的文献（只能引用这些，不得补充任何未列出的文献）：",
    list,
    "",
    "写一份**详尽版**文献综述，Markdown，3000–5000 字。结构如下：",
    "",
    "## 一、领域地图",
    "用 300 字说明这个领域在回答什么核心问题、大致有哪些研究传统。",
    "",
    "## 二、核心争论",
    "列出 2–4 个真正的争论点。每个争论写清楚：谁主张什么、依据是什么、反方是谁、目前证据偏向哪边。",
    "如果录入文献不足以支撑某个争论，明确写「目前录入的文献还不足以判断」，不要凑。",
    "",
    "## 三、方法与证据",
    "比较这些研究用的方法（实验/问卷/访谈/理论）、样本与可推广性，指出哪些结论受方法限制。",
    "",
    "## 四、逐篇点评",
    "对上面列出的**每一篇**文献各写 150–300 字：研究问题、方法、主要结论、局限、与其它文献的关系。",
    "标题用「作者（年份）」。",
    "",
    "## 五、共识与分歧",
    "分成「已被证据支持」「仍有争议」「仅有推测」三类，每类给出具体文献支持。",
    "",
    "## 六、研究空白",
    "2–3 个可做的研究方向，说明为什么是空白、需要什么设计才能回答。",
    "",
    "## 七、阅读路径",
    "给初学者一个顺序：先读哪篇、为什么、读到什么程度可以进入下一篇。",
    "",
    "## 八、术语表",
    "5–8 个术语，每个一句话解释，用本领域的通行译名。",
    "",
    "## 参考文献",
    "只列上面给出的文献，格式为「作者. (年份). 标题」，有 DOI 的附 DOI。",
    "",
    "硬规则：",
    "1. 绝不编造文献、作者、年份或 DOI；只能引用上面列出的。",
    "2. 每一条判断都要能对应到具体某篇；写不出出处的判断就删掉。",
    "3. 区分「文献说的」和「你的评价」：评价要明确标注为评述。",
    "4. 不用「赋能」「抓手」「范式革命」这类空词；每段 80–200 字。",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: EDITOR_SYSTEM },
    { role: "user", content: user },
  ];
}

/**
 * 从零生成领域综述（库里可能一篇文献都没有）。
 *
 * 与 literatureReviewMessages 的分工：
 * - 那个用于「已有文献 → 综述」，只许引用库内文献；
 * - 这个用于「空白领域 → 综述 + 候选文献」，允许提议文献，
 *   但必须带 DOI，且由插件调用 Crossref 核验后才允许入库。
 */
export function domainReviewMessages(input: {
  domain: string;
  focus?: string;
  retry?: boolean;
}): ChatMessage[] {
  const user = [
    `领域：${input.domain}`,
    input.focus?.trim() ? `关注问题：${input.focus.trim()}` : "",
    "",
    "为这个领域写一份**详尽版**文献综述，Markdown，3000–5000 字。结构如下：",
    "",
    "## 一、领域地图",
    "这个领域在回答什么核心问题？有哪些主要研究传统？彼此如何分野？",
    "",
    "## 二、核心争论",
    "2–4 个真正的争论点。每个写：谁主张什么、依据是什么、反方是谁、证据目前偏向哪边。",
    "",
    "## 三、方法与证据",
    "比较主要研究传统的方法、样本与可推广性；指出哪些结论受方法限制。",
    "",
    "## 四、关键文献点评",
    "挑 5–8 篇最关键的文献，每篇 150–300 字：问题、方法、结论、局限、在领域中的位置。",
    "",
    "## 五、共识与分歧",
    "分「已被证据支持」「仍有争议」「仅有推测」三类，各给文献依据。",
    "",
    "## 六、研究空白",
    "2–3 个可做的方向，说明为什么空白、需要什么设计。",
    "",
    "## 七、阅读路径",
    "给初学者一个阅读顺序，说明先读哪篇、为什么、读到什么程度。",
    "",
    "## 八、术语表",
    "5–8 个术语，一句话解释，用通行译名。",
    "",
    "## 参考文献",
    "",
    "然后在文末输出候选文献清单，必须严格使用下面的格式（HTML 注释，学生看不见，程序要解析）：",
    "",
    "<!-- rlc:candidates",
    '[{"title":"...","authors":["..."],"year":2015,"venue":"...","doi":"10.xxxx/xxxxx","why":"为什么值得读"}]',
    "rlc:candidates -->",
    "",
    "硬规则：",
    "1. 候选 8–12 篇，必须是你确信真实存在的经典或高被引文献；",
    "2. 每一篇都必须给出 DOI；对 DOI 没有把握的，就不要放进候选清单；",
    "3. 宁可少给，也不要编造标题、作者或 DOI —— 插件会逐条用 Crossref 核验，编造的会被当场标红；",
    "4. 综述正文里的每一条判断都要能对应到候选清单中的某篇，不写无出处的宏大论断；",
    "5. 区分「文献说的」和「你的评价」，评价明确标注为评述；",
    "6. 不用「赋能」「抓手」「范式革命」这类空词；每段 80–200 字。",
    input.retry
      ? "7. 重要：上一次输出没有解析到候选清单。这一次必须在文末严格输出 <!-- rlc:candidates ... rlc:candidates --> 块，块内必须是合法 JSON 数组，不能有注释、不能有尾逗号。"
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: EDITOR_SYSTEM },
    { role: "user", content: user },
  ];
}
