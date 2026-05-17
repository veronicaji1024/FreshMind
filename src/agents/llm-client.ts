import { FreshMindError } from '../types.js';
import type { Message } from '../types.js';
import { LLM_DEFAULTS } from '../config/defaults.js';
import { fetchWithTimeout } from '../fetch-with-timeout.js';

export interface LLMClientOptions {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30_000;

export class LLMClient {
  private model: string;
  private baseUrl: string;
  private apiKey: string;
  private maxRetries: number;
  private timeoutMs: number;

  constructor(options?: LLMClientOptions) {
    this.model = options?.model ?? LLM_DEFAULTS.model;
    this.baseUrl = options?.baseUrl ?? LLM_DEFAULTS.baseUrl;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => response.statusText);
          // 4xx 错误不重试（客户端问题）
          if (response.status >= 400 && response.status < 500) {
            throw new FreshMindError(
              `SiliconFlow API 调用失败 (${response.status}): ${errorText}`,
              'LLM_API_ERROR',
            );
          }
          // 5xx / 429 可重试
          lastError = new FreshMindError(
            `SiliconFlow API 调用失败 (${response.status}): ${errorText}`,
            'LLM_API_ERROR',
          );
          if (attempt < this.maxRetries) {
            await sleep(1000 * (attempt + 1)); // 退避: 1s, 2s
            continue;
          }
          throw lastError;
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
      } catch (err) {
        if (err instanceof FreshMindError && err.code === 'LLM_API_ERROR' && (err.message.includes('(4') && !err.message.includes('(429'))) {
          throw err; // 4xx（非 429）不重试
        }
        lastError = err as Error;
        if (attempt < this.maxRetries) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
      }
    }

    throw lastError ?? new FreshMindError('LLM 调用失败（已重试）', 'LLM_API_ERROR');
  }

  async chatJSON<T>(messages: Message[]): Promise<T> {
    const raw = await this.chat(messages, {
      response_format: { type: 'json_object' },
    });

    return parseJSONResponse<T>(raw);
  }
}

/** 从 LLM 返回中提取 JSON，支持直接 JSON、markdown 代码块、前后有垃圾文本 */
function parseJSONResponse<T>(raw: string): T {
  // 1. 直接解析
  try {
    return JSON.parse(raw) as T;
  } catch { /* continue */ }

  // 2. 从 markdown 代码块提取
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]) as T;
    } catch { /* continue */ }
  }

  // 3. 找到第一个 { 或 [ 开始的有效 JSON
  const jsonStart = raw.search(/[{\[]/);
  if (jsonStart >= 0) {
    const candidate = raw.slice(jsonStart);
    // 从后往前找匹配的 } 或 ]
    const closer = candidate[0] === '{' ? '}' : ']';
    const lastClose = candidate.lastIndexOf(closer);
    if (lastClose > 0) {
      try {
        return JSON.parse(candidate.slice(0, lastClose + 1)) as T;
      } catch { /* continue */ }
    }
  }

  throw new FreshMindError(
    `LLM 返回格式不符合预期，无法解析为 JSON:\n${raw.slice(0, 200)}`,
    'LLM_FORMAT_ERROR',
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
