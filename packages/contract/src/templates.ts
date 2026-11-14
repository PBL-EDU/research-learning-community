import { z } from "zod";
import { CardSchemaTag } from "./schema-tag";

/**
 * 服务端提供的报告模板注册表。
 *
 * 需求里的六种模板，对应四类文档的六种渲染视图：
 * 精读卡片 / 实践卡片 / 实践计划 / 实践总结 / 文章阅读总结 / 领域总结。
 *
 * 实践卡片的三视图共用同一份 `pc-card@1` 文档——因为计划、过程、总结
 * 本来就是同一张卡片在不同阶段的样子，拆成三份文档会导致数据对不上。
 */
export const TemplateId = z.enum([
  "tpl.deep-read",
  "tpl.practice-card",
  "tpl.practice-plan",
  "tpl.practice-summary",
  "tpl.article-summary",
  "tpl.domain-summary",
]);
export type TemplateId = z.infer<typeof TemplateId>;

export type TemplateView = "card" | "plan" | "summary";

export interface TemplateDescriptor {
  id: TemplateId;
  title: string;
  schema: CardSchemaTag;
  view: TemplateView;
  description: string;
}

export const TEMPLATES: readonly TemplateDescriptor[] = [
  {
    id: "tpl.deep-read",
    title: "精读卡片",
    schema: "dr-card@1",
    view: "card",
    description: "Aha 五点 + 观念价值 + 行动指导，针对单篇文献的深加工",
  },
  {
    id: "tpl.practice-card",
    title: "实践卡片",
    schema: "pc-card@1",
    view: "card",
    description: "完整实践卡片：计划、过程、总结三段的合并视图",
  },
  {
    id: "tpl.practice-plan",
    title: "实践计划",
    schema: "pc-card@1",
    view: "plan",
    description: "目标、步骤、资源、成功标准——立项时发布",
  },
  {
    id: "tpl.practice-summary",
    title: "实践总结",
    schema: "pc-card@1",
    view: "summary",
    description: "结果、变化、下次改进——收尾时发布",
  },
  {
    id: "tpl.article-summary",
    title: "文章阅读总结",
    schema: "sum-article@1",
    view: "summary",
    description: "整篇文章的阅读感悟，并索引它产出的精读卡片",
  },
  {
    id: "tpl.domain-summary",
    title: "领域总结",
    schema: "sum-domain@1",
    view: "summary",
    description: "多篇文章的阅读总结或多次实践的实践总结",
  },
];

export function templatesForSchema(schema: CardSchemaTag): readonly TemplateDescriptor[] {
  return TEMPLATES.filter((template) => template.schema === schema);
}

export function getTemplate(id: TemplateId): TemplateDescriptor {
  const found = TEMPLATES.find((template) => template.id === id);
  if (!found) {
    throw new Error(`未知模板 ${id}`);
  }
  return found;
}
