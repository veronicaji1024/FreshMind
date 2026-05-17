import { Command } from 'commander';
import { ui } from '../ui.js';
import { loadConfig } from '../../config/index.js';
import { LLMClient } from '../../agents/llm-client.js';
import { TavilySearch } from '../../search/tavily.js';
import { FreshnessAgent } from '../../agents/freshness-agent.js';
import { FreshnessScanner } from '../../freshness/scanner.js';
import { ReportWriter } from '../../wiki/report-writer.js';
import { PageReader } from '../../wiki/page-reader.js';
import { FreshMindError } from '../../types.js';
import type { InfoType } from '../../types.js';

export const freshcheckCommand = new Command('freshcheck')
  .description('检查知识库中过时的内容')
  .option('--vault <path>', 'vault 目录路径', './freshmind-wiki')
  .option('--max <number>', '最多检查条数', '10')
  .option('--type <type>', '只检查指定类型')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.vault);
      const maxItems = parseInt(options.max, 10);

      // 初始化组件
      const pageReader = new PageReader(config.vaultPath);
      const scanner = new FreshnessScanner(pageReader, config.vaultPath);

      // 1. 扫描
      const spinner = ui.spin('正在扫描知识库...');
      let entries = await scanner.getCheckPriority(undefined, maxItems);

      // 按类型过滤
      if (options.type) {
        entries = entries.filter(e => e.meta.type === (options.type as InfoType));
      }

      if (entries.length === 0) {
        spinner.succeed('所有知识都是新鲜的！');
        return;
      }

      spinner.succeed(`发现 ${entries.length} 条需要验证的知识`);

      // 打印待检列表
      for (const entry of entries) {
        const icon = entry.freshness_status === 'expired' ? '🔴'
          : entry.freshness_status === 'outdated' ? '🟠'
          : '🟡';
        ui.info(`${icon} ${entry.page_path} (${entry.freshness_status}, 得分 ${(entry.freshness_score * 100).toFixed(0)}%, ${entry.days_since_verified} 天前验证)`);
      }

      // 2. 验证
      const verifySpinner = ui.spin('正在通过 Web 搜索 + LLM 验证声明...');
      const llm = new LLMClient({
        model: config.llm.model,
        baseUrl: config.llm.baseUrl,
      });
      const tavilySearch = new TavilySearch();
      const freshnessAgent = new FreshnessAgent(llm, tavilySearch);

      const results = await freshnessAgent.check(entries);
      verifySpinner.succeed('验证完成');

      // 3. 生成报告
      const reportSpinner = ui.spin('正在生成保鲜报告...');
      const reportWriter = new ReportWriter(config.vaultPath);
      const reportPath = await reportWriter.writeReport(results);
      reportSpinner.succeed(`报告已保存: ${reportPath}`);

      // 4. 终端摘要
      const stats = { contradicted: 0, updated: 0, confirmed: 0, uncertain: 0 };
      for (const r of results) {
        for (const v of r.verification) {
          stats[v.status]++;
        }
      }

      console.log('');
      ui.info('=== 检查结果 ===');
      if (stats.contradicted > 0) ui.error(`🔴 已过时: ${stats.contradicted}`);
      if (stats.updated > 0) ui.warn(`🟡 需关注: ${stats.updated}`);
      if (stats.confirmed > 0) ui.success(`🟢 仍有效: ${stats.confirmed}`);
      if (stats.uncertain > 0) ui.info(`⚪ 无法确认: ${stats.uncertain}`);
    } catch (err) {
      if (err instanceof FreshMindError) {
        ui.error(err.message);
      } else {
        throw err;
      }
    }
  });
