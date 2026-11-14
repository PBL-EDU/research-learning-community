/**
 * 命名工具统一从 vault-core 取，插件侧不重复实现。
 * 保留这个文件是为了插件内部的稳定 import 路径。
 */
export { citekeyFor, domainSlug, slugifyAscii, stableHash } from "@rlc/vault-core";
export type { CitekeyInput } from "@rlc/vault-core";
