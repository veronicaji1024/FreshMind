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

  const origin = new URL(listPageUrl).origin;

  // 排除的路径模式（导航、分类、标签、作者等）
  const excludePatterns = [
    /\/(category|tag|author|page|search|login|signup|about|contact|privacy|terms|faq|help|newsletter|presentations|columnists|consulting|archive)\b/i,
    /\/(cdn-cgi|assets|static|images|img|css|js)\//i,
    /\.(png|jpg|jpeg|gif|svg|css|js|pdf|xml|json)$/i,
    /[?#]/i, // 排除带锚点或查询参数的 URL
    /^mailto:/i,
  ];

  // 文章链接的正向匹配模式
  const articlePatterns = [
    /\/blog\//i, /\/engineering\//i, /\/post\//i, /\/article\//i,
    /\/newsletter\//i, /\/p\//i, /\/news\//i, /\/story\//i,
    /\/\d{4}\//, // 年份路径 /2026/
    /\/[a-z0-9][\w-]{8,}$/i, // slug 风格路径
  ];

  const anchors = doc.querySelectorAll('a[href]');
  for (const a of anchors) {
    if (links.length >= maxLinks) break;
    const href = (a as Element).getAttribute('href');
    if (!href || href === '#' || href === '/') continue;

    let fullUrl: string;
    try {
      fullUrl = new URL(href, listPageUrl).href;
    } catch {
      continue;
    }

    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);

    // 必须同源
    if (!fullUrl.startsWith(origin)) continue;
    // 排除非文章链接
    if (excludePatterns.some(p => p.test(fullUrl))) continue;
    // 排除首页自身
    if (fullUrl === origin || fullUrl === origin + '/') continue;

    // 链接文本长度 > 10 通常是文章标题
    const linkText = (a as Element).textContent?.trim() ?? '';
    const hasArticleTitle = linkText.length > 10;

    // 路径匹配文章模式 或 链接文本像标题
    if (articlePatterns.some(p => p.test(fullUrl)) || hasArticleTitle) {
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
