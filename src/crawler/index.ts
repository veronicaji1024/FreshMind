import { readFile } from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { fetchRss } from './rss.js';
import { fetchHtmlAsRawItem, extractArticleLinks } from './html.js';
import { DedupManager } from './dedup.js';
import type { RawItem, CrawlResult, SourcesConfig, BlogSource } from '../types.js';
import { CRAWL_DEFAULTS } from '../config/defaults.js';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class CrawlAgent {
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  async crawl(): Promise<CrawlResult> {
    // 加载信息源配置
    const sourcesRaw = await readFile(
      path.join(this.vaultPath, 'sources.yaml'),
      'utf-8',
    );
    const sources: SourcesConfig = YAML.parse(sourcesRaw);

    // 只处理 blogs 分组中 enabled 的源
    const enabledBlogs = sources.blogs.filter(b => b.enabled);

    // 加载去重状态
    const dedup = new DedupManager(this.vaultPath);
    await dedup.load();
    dedup.prune();

    const allRawItems: RawItem[] = [];
    const newItems: RawItem[] = [];
    let skipped = 0;

    for (const source of enabledBlogs) {
      try {
        const items = await this.fetchSource(source);
        allRawItems.push(...items);

        for (const item of items) {
          if (dedup.isDuplicate(item.url)) {
            skipped++;
          } else {
            dedup.markSeen(item.url);
            newItems.push(item);
          }
        }
      } catch (err) {
        // 单源失败不影响其他源
        console.error(`  ⚠️ ${source.id} 抓取失败: ${(err as Error).message}`);
      }

      // 源间延迟
      await sleep(CRAWL_DEFAULTS.delayMs);
    }

    // 更新统计并保存
    dedup.updateStats(newItems.length, skipped);
    await dedup.save();

    return {
      raw_items: allRawItems,
      new_items: newItems,
      stats: {
        total: enabledBlogs.length,
        new: newItems.length,
        skipped,
      },
    };
  }

  private async fetchSource(source: BlogSource): Promise<RawItem[]> {
    // 有 RSS → 优先用 RSS
    if (source.rss) {
      return fetchRss(source.id, source.rss);
    }

    // 无 RSS → HTML 抓取
    // 先尝试从列表页提取文章链接，再逐篇提取正文
    const links = await extractArticleLinks(
      source.url,
      CRAWL_DEFAULTS.maxArticlesPerSource,
    );

    const items: RawItem[] = [];
    for (const link of links) {
      const item = await fetchHtmlAsRawItem(source.id, link);
      if (item) items.push(item);
      await sleep(CRAWL_DEFAULTS.delayMs);
    }

    return items;
  }
}
