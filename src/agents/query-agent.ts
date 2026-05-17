import { LLMClient } from './llm-client.js';
import { buildQueryPrompt } from './prompts/index.js';
import { PageReader } from '../wiki/page-reader.js';
import { calculateFreshness, getFreshnessStatus, daysBetween } from '../freshness/decay.js';

const MAX_CHARS_PER_PAGE = 500;
const MAX_TOTAL_CHARS = 8000;

export class QueryAgent {
  constructor(
    private llm: LLMClient,
    private pageReader: PageReader,
  ) {}

  async query(question: string): Promise<{
    answer: string;
    sources: { page: string; freshness: string }[];
  }> {
    // 1. 读取所有 wiki 页面
    const pages = await this.pageReader.readAllPages();

    // 2. 读取每个页面 + 计算新鲜度，按新鲜度降序排列
    const pageData: { path: string; score: number; status: string; content: string; lastVerified: string }[] = [];

    for (const page of pages) {
      try {
        const { meta, content } = await this.pageReader.readPage(page.path);
        const now = new Date();
        const days = daysBetween(new Date(meta.last_verified), now);
        const score = calculateFreshness(meta.half_life_days, days);
        const status = getFreshnessStatus(score);
        pageData.push({ path: page.path, score, status, content, lastVerified: meta.last_verified });
      } catch {
        // 跳过读取失败的页面
      }
    }

    // 按新鲜度降序排列，优先展示最新内容
    pageData.sort((a, b) => b.score - a.score);

    // 3. 截断内容防止超出上下文窗口
    const sources: { page: string; freshness: string }[] = [];
    const pagesContent: string[] = [];
    let totalChars = 0;

    for (const p of pageData) {
      sources.push({ page: p.path, freshness: p.status });

      const truncatedContent = p.content.length > MAX_CHARS_PER_PAGE
        ? p.content.slice(0, MAX_CHARS_PER_PAGE) + '...(内容已截断)'
        : p.content;

      if (totalChars + truncatedContent.length > MAX_TOTAL_CHARS) {
        pagesContent.push(
          `--- 页面: ${p.path} (freshness_status: ${p.status}, 上次验证: ${p.lastVerified}) ---\n(内容过多已省略)`,
        );
        continue;
      }

      pagesContent.push(
        `--- 页面: ${p.path} (freshness_status: ${p.status}, 上次验证: ${p.lastVerified}) ---\n${truncatedContent}`,
      );
      totalChars += truncatedContent.length;
    }

    // 4. LLM 综合回答
    const wikiContent = pagesContent.join('\n\n');
    const messages = buildQueryPrompt(question, wikiContent);
    const answer = await this.llm.chat(messages);

    return { answer, sources };
  }
}
