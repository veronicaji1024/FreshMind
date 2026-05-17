import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import type { WikiPageMeta } from '../types.js';
import { readPage } from './page-reader.js';

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

export async function updatePage(
  filePath: string,
  updates: Partial<WikiPageMeta>,
  contentAppend?: string,
): Promise<void> {
  if (!existsSync(filePath)) {
    throw new Error(`页面不存在: ${filePath}`);
  }

  const { meta, content } = await readPage(filePath);

  // 合并 frontmatter 更新
  const newMeta = { ...meta, ...updates };

  // 合并正文
  const newContent = contentAppend
    ? content + '\n\n' + contentAppend
    : content;

  const fileContent = matter.stringify(newContent, newMeta as unknown as Record<string, unknown>);
  await writeFile(filePath, fileContent);
}
