import { writeFile } from 'fs/promises';
import path from 'path';
import { readAllPages } from './page-reader.js';
import type { WikiPageMeta, FreshnessStatus } from '../types.js';

const STATUS_EMOJI: Record<string, string> = {
  fresh: '🟢',
  stale: '🟡',
  outdated: '🟠',
  expired: '🔴',
  archived: '📦',
};

export async function rebuildIndex(vaultPath: string): Promise<void> {
  const pages = await readAllPages(vaultPath);

  // 按目录分组
  const groups = new Map<string, { path: string; meta: WikiPageMeta }[]>();
  for (const page of pages) {
    const dir = path.dirname(page.path);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(page);
  }

  // 统计
  const total = pages.length;
  const statusCounts: Record<string, number> = { fresh: 0, stale: 0, outdated: 0, expired: 0 };
  for (const p of pages) {
    const s = p.meta.freshness_status ?? 'fresh';
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }

  const today = new Date().toISOString().split('T')[0];

  let md = `# FreshMind Wiki Index\n\n`;
  md += `> 最后更新: ${today} | 总页面: ${total}`;
  md += ` | 🔴 过时: ${statusCounts.expired ?? 0}`;
  md += ` | 🟠 待确认: ${statusCounts.outdated ?? 0}`;
  md += ` | 🟡 需关注: ${statusCounts.stale ?? 0}`;
  md += ` | 🟢 有效: ${statusCounts.fresh ?? 0}`;
  md += `\n\n`;

  // 按分类输出表格
  const dirLabels: Record<string, string> = {
    entities: '实体 (Entities)',
    concepts: '概念 (Concepts)',
    models: '模型 (Models)',
    comparisons: '对比 (Comparisons)',
    trends: '趋势 (Trends)',
  };

  for (const [dir, label] of Object.entries(dirLabels)) {
    const groupPages = groups.get(dir);
    if (!groupPages || groupPages.length === 0) continue;

    md += `## ${label}\n\n`;
    md += `| 页面 | 类型 | 保鲜状态 | 上次验证 |\n`;
    md += `|------|------|---------|----------|\n`;

    for (const p of groupPages) {
      const status = p.meta.freshness_status ?? 'fresh';
      const emoji = STATUS_EMOJI[status];
      const pageName = p.path.replace('.md', '');
      md += `| [[${pageName}]] | ${p.meta.type} | ${emoji} ${status} | ${p.meta.last_verified ?? '-'} |\n`;
    }
    md += `\n`;
  }

  // 按保鲜状态分组
  const expiredPages = pages.filter(p => p.meta.freshness_status === 'expired' || p.meta.freshness_status === 'outdated');
  if (expiredPages.length > 0) {
    md += `## 🔴 需要关注\n\n`;
    for (const p of expiredPages) {
      const pageName = p.path.replace('.md', '');
      md += `- [[${pageName}]] — ${p.meta.freshness_status} | 上次验证 ${p.meta.last_verified ?? '未知'}\n`;
    }
    md += `\n`;
  }

  await writeFile(path.join(vaultPath, 'index.md'), md);
}
