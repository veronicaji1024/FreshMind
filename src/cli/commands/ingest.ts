import { Command } from 'commander';
import { ui } from '../ui.js';
import { loadConfig } from '../../config/config.js';
import { extractFromUrl } from '../../crawler/html.js';

export function registerIngest(program: Command) {
  program
    .command('ingest [url]')
    .description('摄入新知识到 wiki')
    .option('--text <text>', '直接粘贴文本内容')
    .option('--vault <path>', 'vault 目录路径')
    .action(async (url, opts) => {
      if (!url && !opts.text) {
        ui.error('请提供 URL 或 --text 参数');
        process.exit(1);
      }

      const config = await loadConfig(opts.vault);
      const spinner = ui.spin('正在提取内容...');

      try {
        let content: string;
        let title: string;

        if (url) {
          const extracted = await extractFromUrl(url);
          content = extracted.content;
          title = extracted.title;
        } else {
          content = opts.text;
          title = content.slice(0, 50) + '...';
        }

        spinner.succeed(`提取完成: ${title}`);
        ui.info(`内容长度: ${content.length} 字符`);

        // TODO: Day 2 集成时替换为调用 IngestAgent + PageWriter
        ui.warn('Ingest Agent 尚未集成，仅展示提取结果');
        console.log();
        console.log(content.slice(0, 500) + '...');
      } catch (err) {
        spinner.fail('提取失败');
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
