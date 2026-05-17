import path from 'path';
import { readAllPages } from './page-reader.js';
import { updatePage } from './page-writer.js';
import type { WikiPageMeta } from '../types.js';

/** 根据 entities 和 concepts 查找已有的相关页面 */
export async function findRelatedPages(
  vaultPath: string,
  entities: string[],
  concepts: string[],
): Promise<string[]> {
  const allPages = await readAllPages(vaultPath);
  const related: string[] = [];

  const searchTerms = [...entities, ...concepts].map(t => t.toLowerCase());

  for (const page of allPages) {
    const pageTitle = (page.meta.title ?? '').toLowerCase();
    const pageTags = (page.meta.tags ?? []).map(t => t.toLowerCase());

    for (const term of searchTerms) {
      if (
        pageTitle.includes(term) ||
        pageTags.some(tag => tag.includes(term))
      ) {
        const wikilink = `[[${page.path.replace('.md', '')}]]`;
        if (!related.includes(wikilink)) {
          related.push(wikilink);
        }
        break;
      }
    }
  }

  return related;
}

/** 给目标页面添加反向链接 */
export async function addBacklinks(
  vaultPath: string,
  pagePath: string,
  relatedPaths: string[],
): Promise<void> {
  const fullPath = path.join(vaultPath, pagePath);

  // 只更新 related 字段
  await updatePage(fullPath, {
    related: relatedPaths,
  } as Partial<WikiPageMeta>);
}
