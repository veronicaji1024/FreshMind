import { LLMClient } from './llm-client.js';
import { buildQueryPrompt } from './prompts/index.js';
import { PageReader } from '../wiki/page-reader.js';
import { calculateFreshness, getFreshnessStatus, daysBetween } from '../freshness/decay.js';

export class QueryAgent {
  constructor(
    private llm: LLMClient,
    private pageReader: PageReader,
  ) {}

  async query(question: string): Promise<{
    answer: string;
    sources: { page: string; freshness: string }[];
  }> {
    // 1. 读取所有 wiki 页面（MVP 简化：全读）
    const pages = await this.pageReader.readAllPages();

    // 2. 读取每个页面的完整内容 + 计算新鲜度
    const sources: { page: string; freshness: string }[] = [];
    const pagesContent: string[] = [];

    for (const page of pages) {
      const { meta, content } = await this.pageReader.readPage(page.path);
      const now = new Date();
      const days = daysBetween(new Date(meta.last_verified), now);
      const score = calculateFreshness(meta.half_life_days, days);
      const status = getFreshnessStatus(score);

      sources.push({ page: page.path, freshness: status });

      pagesContent.push(
        `--- 页面: ${page.path} (freshness_status: ${status}, 上次验证: ${meta.last_verified}) ---\n${content}`,
      );
    }

    // 3. LLM 综合回答
    const wikiContent = pagesContent.join('\n\n');
    const messages = buildQueryPrompt(question, wikiContent);
    const answer = await this.llm.chat(messages);

    return { answer, sources };
  }
}
