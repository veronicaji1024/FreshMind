import { LLMClient } from './llm-client.js';
import { buildIngestPrompt } from './prompts/index.js';
import { PageWriter } from '../wiki/page-writer.js';
import { PageReader } from '../wiki/page-reader.js';
import { DEFAULT_HALF_LIFE, TYPE_DIR_MAP } from '../config/defaults.js';
import type { IngestResult, WikiPageMeta } from '../types.js';
import { FreshMindError } from '../types.js';
import { readFile, writeFile, appendFile } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { fetchWithTimeout } from '../fetch-with-timeout.js';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export class IngestAgent {
  private pageReader: PageReader | null;

  constructor(
    private llm: LLMClient,
    private pageWriter: PageWriter,
    private vaultPath: string,
    pageReader?: PageReader,
  ) {
    this.pageReader = pageReader ?? null;
  }

  async ingest(input: { url?: string; text?: string }): Promise<{
    page_path: string;
    action: 'created' | 'updated' | 'skipped';
    claims_count: number;
    conflicts: string[];
  }> {
    // 0. URL 去重：检查 vault 中是否已有同源 URL 的页面
    if (input.url && this.pageReader) {
      const existing = await this.pageReader.findBySourceUrl(input.url);
      if (existing) {
        return {
          page_path: existing,
          action: 'skipped',
          claims_count: 0,
          conflicts: [],
        };
      }
    }

    // 1. 获取内容
    let content: string;
    if (input.text) {
      content = input.text;
    } else if (input.url) {
      const res = await fetchWithTimeout(input.url, { timeoutMs: 30_000 });
      if (!res.ok) {
        throw new FreshMindError(`无法获取 URL 内容: ${input.url}`, 'FETCH_ERROR');
      }
      const html = await res.text();
      // 用 Readability 提取正文，保留文档结构
      const dom = new JSDOM(html, { url: input.url });
      const article = new Readability(dom.window.document).parse();
      content = article?.textContent?.trim()
        ?? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } else {
      throw new FreshMindError('必须提供 url 或 text', 'INVALID_INPUT');
    }

    // 2. 内容质量门槛：太短的内容直接跳过
    if (content.length < 200) {
      throw new FreshMindError(
        `内容过短（${content.length} 字），跳过 ingest`,
        'CONTENT_TOO_SHORT',
      );
    }

    // 3. 截断过长内容，防止 LLM 超时（保留前 8000 字）
    const MAX_CONTENT_LENGTH = 8000;
    const truncatedContent = content.length > MAX_CONTENT_LENGTH
      ? content.slice(0, MAX_CONTENT_LENGTH) + '\n\n[内容已截断，仅分析前 8000 字]'
      : content;

    // 4. LLM 结构化提取
    const messages = buildIngestPrompt(truncatedContent);
    const result = await this.llm.chatJSON<IngestResult>(messages);

    // 5. 校验必要字段
    if (!result.title || !result.type || !Array.isArray(result.verifiable_claims)) {
      throw new FreshMindError('LLM 返回格式不符合预期', 'LLM_FORMAT_ERROR');
    }

    // 6. Claims 质量门槛：0 条可验证声明则跳过
    if (result.verifiable_claims.length === 0) {
      throw new FreshMindError(
        `"${result.title}" 未提取到可验证声明，跳过 ingest`,
        'NO_CLAIMS',
      );
    }

    // 7. 获取半衰期（优先用校准值）
    const halfLife = await this.getCalibratedHalfLife(result.type);

    // 8. 确定目录和 slug
    const dir = TYPE_DIR_MAP[result.type] ?? 'concepts';
    const slug = this.titleToSlug(result.title);

    // 9. 构建 frontmatter
    const today = new Date().toISOString().slice(0, 10);
    const meta: WikiPageMeta = {
      title: result.title,
      type: result.type,
      created: today,
      last_verified: today,
      half_life_days: halfLife,
      freshness_status: 'fresh',
      confidence: 0.9,
      sources: input.url ? [{ url: input.url, date: today }] : [],
      related: result.related_concepts.map(c => `[[concepts/${this.titleToSlug(c)}]]`),
      tags: result.entities,
      verifiable_claims: result.verifiable_claims.map(c => ({
        ...c,
        last_checked: today,
        status: 'confirmed' as const,
      })),
    };

    // 10. 构建页面正文
    const pageContent = `# ${result.title}

## 概述
${result.summary}

## 关键信息
${result.verifiable_claims.map(c => `- ${c.claim}`).join('\n')}

## 相关链接
${result.related_concepts.map(c => `- [[concepts/${this.titleToSlug(c)}]]`).join('\n')}
`;

    // 11. 写入 wiki 页面
    const pagePath = await this.pageWriter.createPage(dir, slug, meta, pageContent);

    // 12. 存储原始内容到 raw/
    const rawFileName = `${today}-${slug}.md`;
    await writeFile(
      join(this.vaultPath, 'raw', rawFileName),
      `# ${result.title}\n\n来源: ${input.url ?? '手动输入'}\n日期: ${today}\n\n---\n\n${content.slice(0, 5000)}`,
    ).catch(() => {});

    // 13. 追加 log.md
    await appendFile(
      join(this.vaultPath, 'log.md'),
      `- ${new Date().toISOString()} | ingest | ${dir}/${slug}.md | ${result.verifiable_claims.length} 条声明\n`,
    ).catch(() => {});

    return {
      page_path: `${dir}/${slug}.md`,
      action: 'created',
      claims_count: result.verifiable_claims.length,
      conflicts: [],
    };
  }

  private async getCalibratedHalfLife(type: string): Promise<number> {
    try {
      const calibPath = join(this.vaultPath, '_meta/calibration.yaml');
      const content = await readFile(calibPath, 'utf-8');
      const calib = parseYaml(content);
      if (calib?.calibrated_half_life?.[type]) {
        return calib.calibrated_half_life[type];
      }
    } catch {
      // 无校准数据
    }
    return DEFAULT_HALF_LIFE[type as keyof typeof DEFAULT_HALF_LIFE] ?? 180;
  }

  private titleToSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-|-$/g, '')
      || 'untitled';
  }
}
