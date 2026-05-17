import Parser from 'rss-parser';
import type { RawItem } from '../types.js';
import { CRAWL_DEFAULTS } from '../config/defaults.js';

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'FreshMind/0.1 (Knowledge Freshness Bot)',
  },
});

export async function fetchRss(
  sourceId: string,
  feedUrl: string,
  lookbackHours = CRAWL_DEFAULTS.lookbackHours,
  maxItems = CRAWL_DEFAULTS.maxArticlesPerSource,
): Promise<RawItem[]> {
  const feed = await parser.parseURL(feedUrl);
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;

  const items: RawItem[] = [];

  for (const entry of feed.items) {
    if (items.length >= maxItems) break;

    const pubDate = entry.pubDate ?? entry.isoDate;
    if (pubDate && new Date(pubDate).getTime() < cutoff) continue;

    const content = entry['content:encoded']
      ?? entry.content
      ?? entry.contentSnippet
      ?? entry.summary
      ?? '';

    if (!content || content.length < 50) continue;

    items.push({
      source_id: sourceId,
      title: entry.title ?? '无标题',
      content: stripHtml(content),
      url: entry.link ?? '',
      published_at: pubDate ?? new Date().toISOString(),
      source_type: 'blog',
    });
  }

  return items;
}

/** 简单去除 HTML 标签 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
