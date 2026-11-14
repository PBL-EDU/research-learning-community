import { requestUrl } from "obsidian";
import type { RlcSettings } from "../settings";
import { extractJson } from "./json";

export class AiError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * OpenAI 兼容的对话客户端。
 *
 * 用 Obsidian 的 requestUrl 而不是 fetch：requestUrl 绕过 CORS，
 * 且插件商店审核对裸 fetch 敏感（架构文档 §2.3）。
 */
export class AiClient {
  constructor(private readonly getSettings: () => RlcSettings) {}

  get ready(): boolean {
    const settings = this.getSettings();
    return Boolean(settings.aiBaseUrl && settings.aiApiKey && settings.aiModel);
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const settings = this.getSettings();
    if (!this.ready) {
      throw new AiError("尚未配置 AI：设置 → 研究性学习社区 → AI");
    }

    const url = `${settings.aiBaseUrl.replace(/\/+$/, "")}/chat/completions`;
    let response;
    try {
      response = await requestUrl({
        url,
        method: "POST",
        contentType: "application/json",
        headers: {
          Authorization: `Bearer ${settings.aiApiKey}`,
        },
        body: JSON.stringify({
          model: settings.aiModel,
          temperature: options.temperature ?? settings.aiTemperature,
          max_tokens: options.maxTokens ?? 2000,
          messages,
        }),
        throw: false,
      });
    } catch (error) {
      throw new AiError("网络请求失败，检查接口地址与网络", (error as Error).message);
    }

    if (response.status >= 400) {
      const detail = response.text.slice(0, 300);
      throw new AiError(`模型返回 ${response.status}`, detail);
    }

    const content = response.json?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new AiError("模型没有返回内容");
    }
    return content;
  }

  /** 让模型返回 JSON，并在本地做一次结构校验（不信任模型的自述）。 */
  async chatJson<T>(messages: ChatMessage[], validate: (value: unknown) => T): Promise<T> {
    const raw = await this.chat(messages, { temperature: 0.2 });
    const json = extractJson(raw);
    if (json === null) {
      throw new AiError("模型没有返回可解析的 JSON", raw.slice(0, 300));
    }
    try {
      return validate(json);
    } catch (error) {
      throw new AiError("模型返回的 JSON 结构不符合要求", (error as Error).message);
    }
  }
}
