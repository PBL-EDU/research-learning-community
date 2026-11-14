/**
 * 从模型输出里提取 JSON。
 *
 * 不引入 JSON5 之类的宽松解析器：宁可报错让用户重试，
 * 也不要悄悄接受一个结构不对的对象写进卡片。
 */
export function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}
