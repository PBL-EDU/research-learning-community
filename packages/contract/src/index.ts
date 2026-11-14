/**
 * @rlc/contract —— 三端唯一契约源。
 *
 * 依赖方向硬规则（CI 机械检查，不靠自觉）：
 *   任何代码都不许从这里反向依赖 obsidian / @nestjs/* / next。
 *
 * 谁在用：
 *   - apps/obsidian-plugin：写卡片前校验、发布前 checkPublishable
 *   - apps/api：入参校验、出参校验、错误码
 *   - apps/portal：服务端渲染的 DTO 类型
 */
export * from "./api";
export * from "./assets";
export * from "./cards";
export * from "./common";
export * from "./domain";
export * from "./envelope";
export * from "./errors";
export * from "./issues";
export * from "./literature";
export * from "./publish";
export * from "./publish-readiness";
export * from "./schema-tag";
export * from "./skim";
export * from "./source";
export * from "./templates";
