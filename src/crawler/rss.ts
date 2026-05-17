import Parser from 'rss-parser';
import type { RawItem } from '../types.js';
import { CRAWL_DEFAULTS } from '../config/defaults.js';

const parser = new Parser();

/** 用 fetch 下载 XML，再用 rss-parser 解析，解决大文件超时问题 */
async function fetchAndParse(feedUrl: string) {
  const response = await fetch(feedUrl, {
    headers: { 'User-Agent': 'FreshMind/0.1 (Knowledge Freshness Bot)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${feedUrl}`);
  }
  const xml = await response.text();
  return parser.parseString(xml);
}

export async function fetchRss(
  sourceId: string,
  feedUrl: string,
  lookbackHours = CRAWL_DEFAULTS.lookbackHours,
  maxItems = CRAWL_DEFAULTS.maxArticlesPerSource,
): Promise<RawItem[]> {
  const feed = await fetchAndParse(feedUrl);
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
