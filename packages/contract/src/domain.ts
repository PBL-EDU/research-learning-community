import { z } from "zod";
import { Slug } from "./common";

/**
 * 领域引用。v1 决策：领域是服务端维护的共享词表，但允许发布时新建；
 * 新建走「相似名合并」提示，避免分裂成 课程论 / 课程与教学论 / Curriculum Theory 三套。
 */
export const DomainRef = z.object({
  name: z.string().min(1).max(64),
  slug: Slug,
});
export type DomainRef = z.infer<typeof DomainRef>;
