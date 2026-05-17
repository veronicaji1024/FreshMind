import { LLMClient } from './llm-client.js';
import { buildIngestPrompt, buildTriagePrompt } from './prompts/index.js';
import type { IngestDepth } from './prompts/ingest.js';
import { PageWriter } from '../wiki/page-writer.js';
import { PageReader } from '../wiki/page-reader.js';
import { DEFAULT_HALF_LIFE, TYPE_DIR_MAP } from '../config/defaults.js';
import type { IngestResult, WikiPageMeta, TriageResult } from '../types.js';
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

  /** 对内容进行分类，决定提取深度 */
  async triage(content: string): Promise<IngestDepth> {
    try {
      const messages = buildTriagePrompt(content);
      const result = await this.llm.chatJSON<TriageResult>(messages);
      if (result.depth === 'skip') return 'skip';
      if (result.depth === 'brief') return 'brief';
      return 'deep';
    } catch {
      return 'deep'; // 分类失败默认深度提取
    }
  }

  async ingest(input: { url?: string; text?: string; depth?: IngestDepth }): Promise<{
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

    // 4. Triage 分类（如果未指定 depth）
    const depth = input.depth ?? await this.triage(truncatedContent);

    // 4.5 skip 类型直接丢弃
    if (depth === 'skip') {
      throw new FreshMindError(
        '内容被 Triage 判定为无价值，跳过',
        'TRIAGE_SKIP',
      );
    }

    // 5. LLM 结构化提取（根据 depth 选择 prompt）
    const messages = buildIngestPrompt(truncatedContent, depth);
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
      related: [],
      tags: result.entities,
      verifiable_claims: result.verifiable_claims.map(c => ({
        ...c,
        last_checked: today,
        status: 'confirmed' as const,
      })),
    };

    // 10. 构建页面正文
    const pageContent = this.buildPageContent(result, depth);

    // 11. 写入 wiki 页面
    const pagePath = await this.pageWriter.createPage(dir, slug, meta, pageContent);

    // 11.5 注册 URL 到内存索引（防止并行写入竞态）
    if (input.url && this.pageReader) {
      this.pageReader.registerUrl(input.url, `${dir}/${slug}.md`);
    }

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

  private buildPageContent(result: IngestResult, depth: IngestDepth): string {
    const lines: string[] = [`# ${result.title}`, ''];

    // 一句话结论
    if (result.one_liner) {
      lines.push(`> **${depth === 'brief' ? '要点' : '一句话'}：** ${result.one_liner}`, '');
    }

    if (depth === 'brief' || !result.sections?.length) {
      // Brief 模式：一段完整的话
      lines.push(result.summary ?? result.verifiable_claims.map(c => c.claim).join('。') + '。');
      lines.push('');
    } else {
      // Deep 模式：目录 + 分节
      lines.push('## 目录', '');
      for (const sec of result.sections) {
        lines.push(`- ${sec.heading}`);
      }
      lines.push('', '---', '');

      for (const sec of result.sections) {
        lines.push(`## ${sec.heading}`, '');
        // key_points 展开为列表
        for (const point of sec.key_points ?? []) {
          lines.push(`- ${point}`);
        }
        lines.push('');
        lines.push(`**为什么重要：** ${sec.why}`, '');
        lines.push(`**So What：** ${sec.so_what}`, '');
      }
    }

    return lines.join('\n');
  }

  private titleToSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-|-$/g, '')
      || 'untitled';
  }
}
