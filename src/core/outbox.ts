/**
 * 发布 outbox：失败的上传进本地队列，网络恢复后重试。
 *
 * 用 JSONL 而不是 JSON 数组：追加方便、半行写坏也只丢一条。
 * 文件位置 00-系统/publish-outbox.jsonl，学生可以直接打开看。
 */
export interface OutboxEntry {
  cardId: string;
  cardPath: string;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

export function parseOutbox(content: string): OutboxEntry[] {
  const entries: OutboxEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const value = JSON.parse(trimmed) as Partial<OutboxEntry>;
      if (typeof value.cardId === "string" && typeof value.cardPath === "string") {
        entries.push({
          cardId: value.cardId,
          cardPath: value.cardPath,
          queuedAt: typeof value.queuedAt === "string" ? value.queuedAt : new Date().toISOString(),
          attempts: typeof value.attempts === "number" ? value.attempts : 0,
          lastError: typeof value.lastError === "string" ? value.lastError : undefined,
        });
      }
    } catch {
      // 半行写坏就丢掉，不影响其他条目
    }
  }
  return entries;
}

/** 同一个 cardId 只保留一条：重试多次不应该把队列撑爆。 */
export function appendOutboxEntry(content: string, entry: OutboxEntry): string {
  const existing = parseOutbox(content).filter((item) => item.cardId !== entry.cardId);
  existing.push(entry);
  return `${existing.map((item) => JSON.stringify(item)).join("\n")}\n`;
}

export function dropOutboxEntry(content: string, cardId: string): string {
  const remaining = parseOutbox(content).filter((item) => item.cardId !== cardId);
  return remaining.length === 0 ? "" : `${remaining.map((item) => JSON.stringify(item)).join("\n")}\n`;
}

export function bumpAttempt(content: string, cardId: string, error: string): string {
  const entries = parseOutbox(content);
  const target = entries.find((item) => item.cardId === cardId);
  if (!target) return content;
  target.attempts += 1;
  target.lastError = error;
  return `${entries.map((item) => JSON.stringify(item)).join("\n")}\n`;
}
