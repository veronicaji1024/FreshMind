import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import type { WikiPageMeta } from '../types.js';

const EXCLUDED_FILES = new Set([
  'index.md',
  'log.md',
  'freshness-report-latest.md',
]);

const EXCLUDED_DIRS = new Set([
  '_meta',
  'raw',
]);

export async function readPage(filePath: string): Promise<{
  meta: WikiPageMeta;
  content: string;
}> {
  const raw = await readFile(filePath, 'utf-8');
  const { data, content } = matter(raw);
  return {
    meta: data as WikiPageMeta,
    content: content.trim(),
  };
}

export async function readAllPages(vaultPath: string): Promise<{
  path: string;
  meta: WikiPageMeta;
}[]> {
  const results: { path: string; meta: WikiPageMeta }[] = [];

  async function scanDir(dirPath: string) {
    if (!existsSync(dirPath)) return;
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(vaultPath, fullPath);

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          await scanDir(fullPath);
        }
      } else if (
        entry.name.endsWith('.md') &&
        !EXCLUDED_FILES.has(entry.name)
      ) {
        try {
          const { meta } = await readPage(fullPath);
          if (meta.title && meta.type) {
            results.push({ path: relativePath, meta });
          }
        } catch {
          // 跳过无法解析的文件
        }
      }
    }
  }

  await scanDir(vaultPath);
  return results;
}
