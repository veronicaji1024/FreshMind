import { Command } from 'commander';
import { ui } from '../ui.js';
import { loadAppConfig } from '../../config/config.js';
import { extractFromUrl } from '../../crawler/html.js';
import { IngestAgent } from '../../agents/ingest-agent.js';
import { LLMClient } from '../../agents/llm-client.js';
import { PageWriter } from '../../wiki/page-writer.js';
import { rebuildIndex } from '../../wiki/index-manager.js';

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

      const config = await loadAppConfig(opts.vault);
      const hasApiKey = !!process.env.SILICONFLOW_API_KEY;

      if (hasApiKey) {
        // 有 API Key → 完整 IngestAgent 流程
        const spinner = ui.spin('正在通过 LLM 提取并写入 wiki...');
        try {
          const llm = new LLMClient({
            model: config.llm.model,
            baseUrl: config.llm.base_url,
            apiKey: config.llm.api_key,
          });
          const pageWriter = new PageWriter(config.vault_path);
          const agent = new IngestAgent(llm, pageWriter, config.vault_path);

          const result = await agent.ingest({ url, text: opts.text });

          spinner.succeed(`已写入 wiki: ${result.page_path}`);
          ui.info(`动作: ${result.action}`);
          ui.info(`提取声明数: ${result.claims_count}`);

          // 自动更新索引
          await rebuildIndex(config.vault_path);
          ui.success('索引已更新');
        } catch (err) {
          spinner.fail('Ingest 失败');
          ui.error((err as Error).message);
          process.exit(1);
        }
      } else {
        // 无 API Key → 确定性降级：仅提取正文
        ui.warn('未设置 SILICONFLOW_API_KEY，降级为纯内容提取模式');
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
          console.log();
          console.log(content.slice(0, 500) + '...');
        } catch (err) {
          spinner.fail('提取失败');
          ui.error((err as Error).message);
          process.exit(1);
        }
      }
    });
}
