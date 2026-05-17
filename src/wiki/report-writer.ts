import { writeFile } from 'fs/promises';
import { join } from 'path';
import type { FreshnessEntry, VerificationResult } from '../types.js';

type VerifiedEntry = FreshnessEntry & { verification: VerificationResult[] };

export class ReportWriter {
  constructor(private vaultPath: string) {}

  async writeReport(results: VerifiedEntry[]): Promise<string> {
    const today = new Date().toISOString().slice(0, 10);

    // 收集所有验证结果并按状态分组
    const groups: Record<string, { entry: VerifiedEntry; vr: VerificationResult }[]> = {
      contradicted: [],
      updated: [],
      confirmed: [],
      uncertain: [],
    };

    for (const entry of results) {
      for (const vr of entry.verification) {
        const status = vr.status in groups ? vr.status : 'uncertain';
        groups[status].push({ entry, vr });
      }
    }

    const totalClaims = results.reduce((sum, e) => sum + e.verification.length, 0);

    // 生成 Markdown
    let md = `# Freshness Report\n`;
    md += `> Generated: ${today} | Checked: ${totalClaims} claims across ${results.length} pages\n\n`;

    // 摘要
    md += `## 摘要\n`;
    md += `- 🔴 已过时 (contradicted): ${groups.contradicted.length}\n`;
    md += `- 🟡 需关注 (updated): ${groups.updated.length}\n`;
    md += `- 🟢 仍然有效 (confirmed): ${groups.confirmed.length}\n`;
    md += `- ⚪ 无法确认 (uncertain): ${groups.uncertain.length}\n\n`;

    // 各分组详情
    if (groups.contradicted.length > 0) {
      md += `## 🔴 已过时 (${groups.contradicted.length})\n\n`;
      md += `| 页面 | 声明 | 证据 | 新信息 |\n`;
      md += `|------|------|------|--------|\n`;
      for (const { entry, vr } of groups.contradicted) {
        md += `| ${entry.page_path} | ${vr.claim} | ${vr.evidence} | ${vr.new_info ?? '-'} |\n`;
      }
      md += '\n';
    }

    if (groups.updated.length > 0) {
      md += `## 🟡 需关注 (${groups.updated.length})\n\n`;
      md += `| 页面 | 声明 | 证据 | 新信息 |\n`;
      md += `|------|------|------|--------|\n`;
      for (const { entry, vr } of groups.updated) {
        md += `| ${entry.page_path} | ${vr.claim} | ${vr.evidence} | ${vr.new_info ?? '-'} |\n`;
      }
      md += '\n';
    }

    if (groups.confirmed.length > 0) {
      md += `## 🟢 仍然有效 (${groups.confirmed.length})\n\n`;
      md += `| 页面 | 声明 | 证据 |\n`;
      md += `|------|------|------|\n`;
      for (const { entry, vr } of groups.confirmed) {
        md += `| ${entry.page_path} | ${vr.claim} | ${vr.evidence} |\n`;
      }
      md += '\n';
    }

    if (groups.uncertain.length > 0) {
      md += `## ⚪ 无法确认 (${groups.uncertain.length})\n\n`;
      md += `| 页面 | 声明 | 原因 |\n`;
      md += `|------|------|------|\n`;
      for (const { entry, vr } of groups.uncertain) {
        md += `| ${entry.page_path} | ${vr.claim} | ${vr.evidence} |\n`;
      }
      md += '\n';
    }

    const reportPath = join(this.vaultPath, 'freshness-report-latest.md');
    await writeFile(reportPath, md);
    return reportPath;
  }
}
