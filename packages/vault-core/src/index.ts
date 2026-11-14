export {
  DOMAINS_DIR,
  EXTRACT_DIR,
  LITERATURE_DIR,
  OUTBOX_PATH,
  STATUS_LABEL,
  SYSTEM_DIR,
  assetsDir,
  cardFilePath,
  domainDir,
  domainSummaryPath,
  extractPath,
  fullTextPath,
  literatureDir,
  literatureNotePath,
  literatureReviewPath,
  parseCardPath,
  pdfPath,
  safeSegment,
  shortId,
  skimReportPath,
  systemFile,
} from "./paths";
export type { CardLocation } from "./paths";

export {
  cardFromMarkdown,
  cardToMarkdown,
  patchFrontmatter,
  readFrontmatter,
  splitFrontmatter,
} from "./frontmatter";
export type { SplitFrontmatter } from "./frontmatter";

export { renderCardBody } from "./render";

export {
  literatureFromMarkdown,
  literatureReviewDocument,
  literatureReviewTemplate,
  literatureTemplate,
  literatureToMarkdown,
} from "./literature";

export { citekeyFor, domainSlug, literatureFolder, slugifyAscii, stableHash } from "./slug";
export type { CitekeyInput } from "./slug";

export { extractSection, skimReportDocument } from "./skim";
export type { SkimReportDocumentInput } from "./skim";

/** 由契约包生成的卡片类型，插件侧统一从这里取。 */
export type { AnyCardV1, CardParseResult, ContractIssue } from "@rlc/contract";
