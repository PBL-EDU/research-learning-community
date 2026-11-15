import type { AnyCardV1 } from "@rlc/contract";

/** 卡片正文的人类可读渲染。frontmatter 才是契约，正文只是给人看的。 */
export function renderCardBody(card: AnyCardV1): string {
  switch (card.schema) {
    case "dr-card@1":
      return [
        "## 原文",
        "",
        quote(card.aha.quote),
        "",
        "## 我的体验",
        "",
        card.aha.experience,
        "",
        "## Aha",
        "",
        card.aha.insight,
        "",
        "## 新启发",
        "",
        card.aha.inspiration,
        "",
        "## 对生活的意义",
        "",
        card.aha.meaning,
        "",
        `## 观念价值（${card.conceptValue.level}）`,
        "",
        card.conceptValue.note,
        "",
        "## 行动指导",
        "",
        ...card.actionGuidance.map((item, index) => {
          const lines = [`${index + 1}. **${item.action}**`];
          if (item.trigger) lines.push(`   - 触发时机：${item.trigger}`);
          if (item.metric) lines.push(`   - 衡量标准：${item.metric}`);
          return lines.join("\n");
        }),
        "",
        sourceLine(card),
      ].join("\n");

    case "pc-card@1":
      return [
        "## 计划",
        "",
        `**目标**：${card.plan.goal}`,
        ...(card.plan.scheduledFor ? ["", `**计划日期**：${card.plan.scheduledFor}`] : []),
        ...(card.plan.dueBy ? [`**截止日期**：${card.plan.dueBy}`] : []),
        "",
        "### 步骤",
        "",
        ...card.plan.steps.map(
          (step, index) => `${index + 1}. ${step.done ? "☑" : "☐"} ${step.text}`,
        ),
        "",
        "### 成功标准",
        "",
        ...card.plan.successCriteria.map((item) => `- ${item}`),
        "",
        "## 过程",
        "",
        card.process.length === 0
          ? "（暂无记录）"
          : card.process
              .map(
                (entry) =>
                  `### ${entry.date}\n\n${entry.what}${entry.obstacle ? `\n\n**卡点**：${entry.obstacle}` : ""}${
                    entry.adjust ? `\n\n**调整**：${entry.adjust}` : ""
                  }`,
              )
              .join("\n\n"),
        "",
        "## 总结",
        "",
        card.summary ? card.summary.outcome : "（尚未总结）",
        "",
      ].join("\n");

    case "sum-article@1":
    case "sum-domain@1":
      return card.body;
  }
}

function quote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function sourceLine(card: AnyCardV1): string {
  if (card.schema !== "dr-card@1") return "";
  const source = card.source;
  const parts = [source.title];
  if (source.authors.length > 0) parts.push(source.authors.join("、"));
  if (source.year) parts.push(String(source.year));
  const line = `> 来源：${parts.join(" · ")}`;
  const doi = source.doi ? ` · https://doi.org/${source.doi}` : source.url ?? "";
  return `${line}${doi}`;
}
