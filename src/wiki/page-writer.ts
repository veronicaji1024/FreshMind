import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import type { WikiPageMeta } from '../types.js';
import { readPage } from './page-reader.js';

/** 创建新页面（函数式，Person A 使用） */
export async function createPage(
  vaultPath: string,
  dir: string,
  slug: string,
  meta: WikiPageMeta,
  content: string,
): Promise<string> {
  const dirPath = path.join(vaultPath, dir);
  await mkdir(dirPath, { recursive: true });

  const filePath = path.join(dirPath, `${slug}.md`);

  const fileContent = matter.stringify(content, meta as unknown as Record<string, unknown>);
  await writeFile(filePath, fileContent);

  return filePath;
}

/** 更新已有页面（函数式，Person A 使用） */
export async function updatePage(
  filePath: string,
  updates: Partial<WikiPageMeta>,
  contentAppend?: string,
): Promise<void> {
  if (!existsSync(filePath)) {
    throw new Error(`页面不存在: ${filePath}`);
  }

  const { meta, content } = await readPage(filePath);

  const newMeta = { ...meta, ...updates };
  const newContent = contentAppend
    ? content + '\n\n' + contentAppend
    : content;

  const fileContent = matter.stringify(newContent, newMeta as unknown as Record<string, unknown>);
  await writeFile(filePath, fileContent);
}

/** Person B 的 PageWriter 类封装 */
export class PageWriter {
  constructor(private vaultPath: string) {}

  async createPage(
    dir: string,
    slug: string,
    meta: WikiPageMeta,
    content: string,
  ): Promise<string> {
    return createPage(this.vaultPath, dir, slug, meta, content);
  }

  async updatePage(
    pagePath: string,
    updates: Partial<WikiPageMeta>,
    contentAppend?: string,
  ): Promise<void> {
    const fullPath = path.join(this.vaultPath, pagePath);
    const raw = await readFile(fullPath, 'utf-8');
    const { data, content } = matter(raw);

    const mergedMeta = { ...data, ...updates };
    const newContent = contentAppend
      ? `${content.trim()}\n\n${contentAppend}\n`
      : content;

    const fileContent = matter.stringify(newContent, mergedMeta);
    await writeFile(fullPath, fileContent);
  }
}
