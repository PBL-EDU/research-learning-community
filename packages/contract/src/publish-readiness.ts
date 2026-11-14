import type { AnyCardV1 } from "./cards";

/**
 * 发布就绪校验——与 schema 校验分开。
 *
 * 分工：
 * - schema（cards/*）回答「这个卡片格式合法吗」；
 * - 本函数回答「这个卡片现在可以公开吗」。
 *
 * 分开的理由：格式合法的卡片可能语义上还不完整（例如实践卡只写了计划），
 * 这类问题不该拦保存，只该拦发布。
 */

export type IssueSeverity = "blocker" | "warning";

export interface ReadinessIssue {
  code: string;
  path: string;
  message: string;
  severity: IssueSeverity;
}

export interface ReadinessResult {
  ok: boolean;
  blockers: ReadinessIssue[];
  warnings: ReadinessIssue[];
}

export const READINESS_CODES = {
  TIME_INCONSISTENT: "TIME_INCONSISTENT",
  PRACTICE_SUMMARY_WITHOUT_PROCESS: "PRACTICE_SUMMARY_WITHOUT_PROCESS",
  PRACTICE_NO_LINKED_CARD: "PRACTICE_NO_LINKED_CARD",
  SUMMARY_NO_LINKED_CARDS: "SUMMARY_NO_LINKED_CARDS",
  LICENSE_UNKNOWN: "LICENSE_UNKNOWN",
} as const;

function issue(
  code: string,
  path: string,
  message: string,
  severity: IssueSeverity,
): ReadinessIssue {
  return { code, path, message, severity };
}

export function checkPublishable(card: AnyCardV1): ReadinessResult {
  const issues: ReadinessIssue[] = [];

  if (Date.parse(card.updatedAt) < Date.parse(card.createdAt)) {
    issues.push(
      issue(
        READINESS_CODES.TIME_INCONSISTENT,
        "updatedAt",
        "更新时间早于创建时间，可能是时钟错误或从别处导入的卡片",
        "blocker",
      ),
    );
  }

  switch (card.schema) {
    case "dr-card@1": {
      if (card.source.license === "unknown" && card.publish?.visibility === "public") {
        issues.push(
          issue(
            READINESS_CODES.LICENSE_UNKNOWN,
            "source.license",
            "文献授权状态未知，公开发布前请人工确认引用边界",
            "warning",
          ),
        );
      }
      break;
    }
    case "pc-card@1": {
      if (card.summary && card.process.length === 0) {
        issues.push(
          issue(
            READINESS_CODES.PRACTICE_SUMMARY_WITHOUT_PROCESS,
            "summary",
            "有实践总结但没有任何过程记录——这样的总结无法复盘",
            "blocker",
          ),
        );
      }
      if (card.linkedCards.length === 0) {
        issues.push(
          issue(
            READINESS_CODES.PRACTICE_NO_LINKED_CARD,
            "linkedCards",
            "实践卡片没有关联任何精读卡片，读者看不出它来自哪个 Aha",
            "warning",
          ),
        );
      }
      break;
    }
    case "sum-article@1": {
      if (card.cardIds.length === 0) {
        issues.push(
          issue(
            READINESS_CODES.SUMMARY_NO_LINKED_CARDS,
            "cardIds",
            "文章总结还没有关联精读卡片",
            "warning",
          ),
        );
      }
      break;
    }
    case "sum-domain@1": {
      // index 非空由 schema 保证，这里无需重复
      break;
    }
  }

  const blockers = issues.filter((i) => i.severity === "blocker");
  const warnings = issues.filter((i) => i.severity === "warning");
  return { ok: blockers.length === 0, blockers, warnings };
}
