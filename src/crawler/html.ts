import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { RawItem } from '../types.js';

const USER_AGENT = 'FreshMind/0.1 (Knowledge Freshness Bot)';

export interface ExtractedContent {
  title: string;
  content: string;
}

/** 从 URL 提取正文 */
export async function extractFromUrl(url: string): Promise<ExtractedContent> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  const html = await response.text();
  return extractFromHtml(html, url);
}

/** 从 HTML 字符串提取正文 */
export function extractFromHtml(html: string, url: string): ExtractedContent {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (article && article.textContent && article.textContent.length >= 200) {
    return {
      title: article.title ?? '无标题',
      content: article.textContent.trim(),
    };
  }

  // Readability 失败时 fallback：用常见选择器提取
  const fallbackSelectors = [
    'article',
    'main',
    '.post-content',
    '.entry-content',
    '.article-content',
    '.content',
    '[role="main"]',
  ];

  const doc = dom.window.document;
  for (const selector of fallbackSelectors) {
    const el = doc.querySelector(selector);
    if (el && el.textContent && el.textContent.length >= 200) {
      return {
        title: doc.title ?? '无标题',
        content: el.textContent.trim(),
      };
    }
  }

  // 最终 fallback：body 文本
  const bodyText = doc.body?.textContent?.trim() ?? '';
  return {
    title: doc.title ?? '无标题',
    content: bodyText,
  };
}

/** 从列表页提取文章链接 */
export async function extractArticleLinks(
  listPageUrl: string,
  maxLinks = 5,
): Promise<string[]> {
  const response = await fetch(listPageUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  const html = await response.text();
  const dom = new JSDOM(html, { url: listPageUrl });
  const doc = dom.window.document;

  const links: string[] = [];
  const seen = new Set<string>();

  // 找 <a> 中 href 包含常见文章路径模式的链接
  const anchors = doc.querySelectorAll('a[href]');
  for (const a of anchors) {
    if (links.length >= maxLinks) break;
    const href = (a as Element).getAttribute('href');
    if (!href) continue;

    const fullUrl = new URL(href, listPageUrl).href;
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);

    // 过滤掉导航/分类链接，保留可能是文章的链接
    if (
      fullUrl.startsWith(new URL(listPageUrl).origin) &&
      !fullUrl.endsWith('/') &&
      (href.includes('/blog/') || href.includes('/engineering/') ||
       href.includes('/post/') || href.includes('/article/') ||
       href.match(/\/\d{4}\//) || href.match(/\/[a-z0-9-]{10,}/))
    ) {
      links.push(fullUrl);
    }
  }

  return links;
}

/** 从 URL 提取为 RawItem（供 CrawlAgent 使用） */
export async function fetchHtmlAsRawItem(
  sourceId: string,
  url: string,
): Promise<RawItem | null> {
  try {
    const { title, content } = await extractFromUrl(url);
    if (content.length < 200) return null;

    return {
      source_id: sourceId,
      title,
      content,
      url,
      published_at: new Date().toISOString(),
      source_type: 'blog',
    };
  } catch {
    return null;
  }
}
