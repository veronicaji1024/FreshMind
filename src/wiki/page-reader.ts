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

/** 读取单个页面（接受完整路径） */
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

/** 扫描 vault 下所有 wiki 页面 */
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

/** Person B 的 PageReader 类封装 */
export class PageReader {
  private sourceUrlIndex: Map<string, string> | null = null;

  constructor(private vaultPath: string) {}

  async readPage(pagePath: string): Promise<{ meta: WikiPageMeta; content: string }> {
    const fullPath = pagePath.endsWith('.md')
      ? path.join(this.vaultPath, pagePath)
      : path.join(this.vaultPath, `${pagePath}.md`);

    return readPage(fullPath);
  }

  async readAllPages(): Promise<{ path: string; meta: WikiPageMeta }[]> {
    return readAllPages(this.vaultPath);
  }

  /** 按 source URL 查找已有页面，返回页面路径或 null */
  async findBySourceUrl(url: string): Promise<string | null> {
    if (!this.sourceUrlIndex) {
      this.sourceUrlIndex = new Map();
      const pages = await this.readAllPages();
      for (const page of pages) {
        for (const src of page.meta.sources ?? []) {
          this.sourceUrlIndex.set(src.url, page.path);
        }
      }
    }
    return this.sourceUrlIndex.get(url) ?? null;
  }

  /** 写入成功后注册 URL 到内存索引，解决并行竞态 */
  registerUrl(url: string, pagePath: string): void {
    if (!this.sourceUrlIndex) {
      this.sourceUrlIndex = new Map();
    }
    this.sourceUrlIndex.set(url, pagePath);
  }
}
