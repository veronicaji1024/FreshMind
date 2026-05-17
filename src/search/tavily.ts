import { FreshMindError } from '../types.js';
import type { SearchResult } from '../types.js';

export class TavilySearch {
  private apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.TAVILY_API_KEY;
    if (!key) {
      throw new FreshMindError(
        '请设置环境变量 TAVILY_API_KEY\n  export TAVILY_API_KEY=tvly-xxx',
        'MISSING_API_KEY',
      );
    }
    this.apiKey = key;
  }

  async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: maxResults,
        search_depth: 'basic',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new FreshMindError(
        `Tavily API 调用失败 (${response.status}): ${errorText}`,
        'SEARCH_API_ERROR',
      );
    }

    const data = await response.json() as any;
    return (data.results ?? []).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      content: r.content ?? '',
      score: r.score ?? 0,
    }));
  }
}
