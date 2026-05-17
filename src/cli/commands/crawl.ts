import { Command } from 'commander';
import pLimit from 'p-limit';
import { ui } from '../ui.js';
import { loadAppConfig } from '../../config/config.js';
import { CrawlAgent } from '../../crawler/index.js';
import { rebuildIndex } from '../../wiki/index-manager.js';
import { appendLog } from '../../wiki/log-writer.js';

export function registerCrawl(program: Command) {
  program
    .command('crawl')
    .description('抓取所有已启用信息源的新内容（有 API Key 时自动 ingest）')
    .option('--vault <path>', 'vault 目录路径')
    .option('--max-ingest <n>', '最多自动 ingest 几篇', '100')
    .option('--concurrency <n>', 'ingest 并发数', '3')
    .action(async (opts) => {
      const config = await loadAppConfig(opts.vault);
      const vaultPath = config.vault_path;
      const maxIngest = parseInt(opts.maxIngest, 10);
      const concurrency = parseInt(opts.concurrency, 10);
      const spinner = ui.spin('正在抓取博客源...');

      try {
        const agent = new CrawlAgent(vaultPath);
        const result = await agent.crawl();

        spinner.succeed('Crawl 完成');
        console.log();
        ui.info(`抓取源数: ${result.stats.total}`);
        ui.info(`新内容: ${result.stats.new} 篇`);
        ui.info(`跳过(已见): ${result.stats.skipped} 篇`);

        if (result.new_items.length > 0) {
          console.log();
          ui.success('新发现的内容:');
          for (const item of result.new_items) {
            console.log(`  📄 ${item.title}`);
            console.log(`     ${item.url}`);
          }

          // 有 API Key 时自动 ingest（并行）
          if (process.env.SILICONFLOW_API_KEY) {
            console.log();
            const itemsToIngest = result.new_items.slice(0, maxIngest);
            ui.info(`开始并行 ingest（${itemsToIngest.length} 篇，并发 ${concurrency}）...`);

            const { LLMClient } = await import('../../agents/llm-client.js');
            const { PageWriter } = await import('../../wiki/page-writer.js');
            const { PageReader } = await import('../../wiki/page-reader.js');
            const { IngestAgent } = await import('../../agents/ingest-agent.js');

            const llm = new LLMClient();
            const pageWriter = new PageWriter(vaultPath);
            const pageReader = new PageReader(vaultPath);
            const ingestAgent = new IngestAgent(llm, pageWriter, vaultPath, pageReader);

            const limit = pLimit(concurrency);
            const results = await Promise.allSettled(
              itemsToIngest.map(item =>
                limit(async () => {
                  const ingestResult = await ingestAgent.ingest({ url: item.url });
                  await appendLog(vaultPath, 'ingest', ingestResult.page_path,
                    `${ingestResult.claims_count} 条声明，来源: ${item.url}`);
                  return { item, ingestResult };
                }),
              ),
            );

            let ingested = 0;
            let skipped = 0;
            for (const r of results) {
              if (r.status === 'fulfilled') {
                const { item, ingestResult } = r.value;
                if (ingestResult.action === 'skipped') {
                  ui.info(`  ⏭️ 已存在: ${ingestResult.page_path}`);
                  skipped++;
                  continue;
                }
                const depthTag = ingestResult.claims_count <= 3 ? '📋' : '📖';
                ui.success(`  ${depthTag} ${ingestResult.page_path} (${ingestResult.claims_count} 条声明)`);
                ingested++;
              } else {
                const errMsg = r.reason?.message ?? String(r.reason);
                const isSkip = r.reason?.code === 'TRIAGE_SKIP' || r.reason?.code === 'NO_CLAIMS' || r.reason?.code === 'CONTENT_TOO_SHORT';
                if (isSkip) {
                  ui.info(`  🚫 跳过: ${errMsg}`);
                  skipped++;
                } else {
                  ui.warn(`  ⚠️ ingest 失败: ${errMsg}`);
                }
              }
            }

            if (ingested > 0) {
              await rebuildIndex(vaultPath);
              ui.success(`已写入 ${ingested} 个 wiki 页面，索引已更新`);
            }

            ui.info(`完成: ${ingested} 成功, ${results.length - ingested} 失败`);
          } else {
            console.log();
            ui.warn('未设置 SILICONFLOW_API_KEY，跳过自动 ingest');
            ui.info('设置后可自动将抓取内容写入 wiki 页面');
          }
        }
      } catch (err) {
        spinner.fail('Crawl 失败');
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
