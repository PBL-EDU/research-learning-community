import type { z } from "zod";

/** 三端共用的校验问题结构。 */
export interface ContractIssue {
  path: (string | number)[];
  message: string;
  code: string;
}

export function toIssues(error: z.ZodError): ContractIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment))),
    message: issue.message,
    code: issue.code,
  }));
}
