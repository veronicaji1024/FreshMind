import { FreshMindError } from '../types.js';
import type { Message } from '../types.js';
import { LLM_DEFAULTS } from '../config/defaults.js';
import { fetchWithTimeout } from '../fetch-with-timeout.js';

export interface LLMClientOptions {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export class LLMClient {
  private model: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(options?: LLMClientOptions) {
    this.model = options?.model ?? LLM_DEFAULTS.model;
    this.baseUrl = options?.baseUrl ?? LLM_DEFAULTS.baseUrl;

    const apiKey = options?.apiKey ?? process.env.SILICONFLOW_API_KEY;
    if (!apiKey) {
      throw new FreshMindError(
        '请设置环境变量 SILICONFLOW_API_KEY\n  export SILICONFLOW_API_KEY=sk-xxx',
        'MISSING_API_KEY',
      );
    }
    this.apiKey = apiKey;
  }

  async chat(
    messages: Message[],
    options?: {
      temperature?: number;
      max_tokens?: number;
      response_format?: { type: 'json_object' };
    },
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options?.temperature ?? LLM_DEFAULTS.temperature,
      max_tokens: options?.max_tokens ?? LLM_DEFAULTS.maxTokens,
    };

    if (options?.response_format) {
      body.response_format = options.response_format;
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      timeoutMs: 60_000, // LLM 调用给 60 秒
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new FreshMindError(
        `SiliconFlow API 调用失败 (${response.status}): ${errorText}`,
        'LLM_API_ERROR',
      );
    }

    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      throw new FreshMindError(
        'LLM 返回内容为空',
        'LLM_FORMAT_ERROR',
      );
    }

    return content;
  }

  async chatJSON<T>(messages: Message[]): Promise<T> {
    const raw = await this.chat(messages, {
      response_format: { type: 'json_object' },
    });

    try {
      return JSON.parse(raw) as T;
    } catch {
      // 尝试从 markdown 代码块提取 JSON
      const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (match) {
        return JSON.parse(match[1]) as T;
      }
      throw new FreshMindError(
        `LLM 返回格式不符合预期，无法解析为 JSON:\n${raw.slice(0, 200)}`,
        'LLM_FORMAT_ERROR',
      );
    }
  }
}
