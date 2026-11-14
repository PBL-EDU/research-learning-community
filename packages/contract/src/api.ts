import { z } from "zod";
import { AssetDecl } from "./assets";
import { Handle, HttpUrl, IsoDateTime, Uuid } from "./common";
import { CardKind } from "./envelope";
import { DomainRef } from "./domain";
import { Visibility } from "./publish";
import { CardSchemaTag } from "./schema-tag";
import { LiteratureSource } from "./source";

/** 读者/同学的公开身份。displayName 只在班内可见，公开页一律用 handle。 */
export const AuthorRef = z.object({
  handle: Handle,
  displayName: z.string().min(1).max(64),
});
export type AuthorRef = z.infer<typeof AuthorRef>;

/**
 * 发布前的双重确认。两个字段都是字面量 true——
 * 这确保「学生确实看到并确认过这两条」被记录下来，而不是靠前端默认勾选。
 */
export const PublishAcknowledge = z.object({
  noPdfUploaded: z.literal(true),
  citeLengthUnder300: z.literal(true),
});
export type PublishAcknowledge = z.infer<typeof PublishAcknowledge>;

/**
 * 科普版：面向某个读者画像的转译稿。
 *
 * 学生自己定义画像（如「初中生」），AI 按画像把精读卡片改写成
 * 一条能读进去、能带走一个行动的内容。长度与语气由模型按画像判断。
 */
export const PromoVariant = z.object({
  /** 画像名称，如「初中生」。 */
  audienceName: z.string().min(1).max(40),
  /** 学生填写的画像描述，原样存下来，便于复现。 */
  audienceDescription: z.string().max(600).optional(),
  title: z.string().min(1).max(60),
  hook: z.string().max(160).optional(),
  bodyMd: z.string().min(1).max(4000),
  /** 服务端渲染后的正文，门户直接用。 */
  bodyHtml: z.string().optional(),
  /** 金句卡：短引文，≤100 字。 */
  quote: z.string().max(120).optional(),
  action: z.string().max(300).optional(),
  tags: z.array(z.string().max(24)).max(8).default([]),
  figureMermaid: z.string().max(4000).optional(),
  /** Vault 内的配图路径；发布时作为 cover 资源上传。 */
  figureImagePath: z.string().max(300).optional(),
});
export type PromoVariant = z.infer<typeof PromoVariant>;

/** POST /publications 的 `payload` 部分（multipart 的一个字段）。 */
export const PublishPayload = z.object({
  schema: CardSchemaTag,
  clientCardId: Uuid,
  kind: CardKind,
  domain: DomainRef,
  title: z.string().min(1).max(120),
  bodyMd: z.string().min(1).max(200_000),
  frontmatter: z.record(z.string(), z.unknown()),
  assets: z.array(AssetDecl).max(10).default([]),
  source: LiteratureSource.optional(),
  visibility: Visibility,
  acknowledge: PublishAcknowledge,
  /** 科普版（按读者画像各一版）；留空则门户只展示原始卡片。 */
  variants: z.array(PromoVariant).max(3).default([]),
});
export type PublishPayload = z.infer<typeof PublishPayload>;

export const PublicationCounts = z.object({
  comments: z.number().int().min(0),
  likes: z.number().int().min(0),
  reposts: z.number().int().min(0),
});
export type PublicationCounts = z.infer<typeof PublicationCounts>;

export const OrganizationRef = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
});
export type OrganizationRef = z.infer<typeof OrganizationRef>;

export const PublicationListItem = z.object({
  id: z.string().min(1),
  kind: CardKind,
  title: z.string().min(1),
  slug: z.string().min(1),
  domain: DomainRef,
  author: AuthorRef,
  /** 所属组织；旧数据可能没有。 */
  org: OrganizationRef.optional(),
  excerpt: z.string().max(300),
  coverUrl: HttpUrl.optional(),
  revision: z.number().int().min(1),
  publishedAt: IsoDateTime,
  counts: PublicationCounts,
});
export type PublicationListItem = z.infer<typeof PublicationListItem>;

export const PublicationAsset = z.object({
  url: HttpUrl,
  role: z.enum(["visual", "cover", "inline"]),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type PublicationAsset = z.infer<typeof PublicationAsset>;

export const PublicationDetail = PublicationListItem.extend({
  bodyHtml: z.string(),
  bodyMd: z.string(),
  source: LiteratureSource.optional(),
  assets: z.array(PublicationAsset).max(20).default([]),
  /** 科普版；为空时门户直接展示原始卡片。 */
  variants: z.array(PromoVariant).max(3).default([]),
  /** AI 生成内容标注（《人工智能生成合成内容标识办法》2025-09-01 起为法定义务）。 */
  aiAssisted: z.boolean(),
});
export type PublicationDetail = z.infer<typeof PublicationDetail>;

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });

/** 讨论树最大深度。写进契约，服务端与前端都不许超过。 */
export const MAX_COMMENT_DEPTH = 4;

export interface CommentNode {
  id: string;
  publicationId: string;
  parentId: string | null;
  depth: number;
  author: AuthorRef;
  body: string;
  createdAt: string;
  editedAt?: string | undefined;
  status: "visible" | "hidden" | "deleted";
  children: CommentNode[];
}

/**
 * 递归的评论节点。用 z.lazy 表达，并在这里卡死 depth ≤ 4 ——
 * 讨论树的所有遍历、缩进、权限判断都依赖这个上限。
 */
export const CommentNodeSchema: z.ZodType<CommentNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    publicationId: z.string().min(1),
    parentId: z.string().nullable(),
    depth: z.number().int().min(0).max(MAX_COMMENT_DEPTH),
    author: AuthorRef,
    body: z.string().min(1).max(5000),
    createdAt: IsoDateTime,
    editedAt: IsoDateTime.optional(),
    status: z.enum(["visible", "hidden", "deleted"]),
    children: z.array(CommentNodeSchema).max(100),
  }),
) as unknown as z.ZodType<CommentNode>;

export const CommentTreeResponse = z.object({
  publicationId: z.string().min(1),
  total: z.number().int().min(0),
  roots: z.array(CommentNodeSchema).max(100),
});
export type CommentTreeResponse = z.infer<typeof CommentTreeResponse>;
