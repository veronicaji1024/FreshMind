import { Command } from 'commander';
import { ui } from '../ui.js';
import { loadConfig } from '../../config/config.js';
import { CrawlAgent } from '../../crawler/index.js';

export function registerCrawl(program: Command) {
  program
    .command('crawl')
    .description('抓取所有已启用信息源的新内容')
    .option('--vault <path>', 'vault 目录路径')
    .action(async (opts) => {
      const config = await loadConfig(opts.vault);
      const spinner = ui.spin('正在抓取博客源...');

      try {
        const agent = new CrawlAgent(config.vault_path);
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
        }
      } catch (err) {
        spinner.fail('Crawl 失败');
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
