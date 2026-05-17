import { Command } from 'commander';
import { ui } from '../ui.js';
import { loadConfig } from '../../config/index.js';
import { LLMClient } from '../../agents/llm-client.js';
import { QueryAgent } from '../../agents/query-agent.js';
import { PageReader } from '../../wiki/page-reader.js';
import { FreshMindError } from '../../types.js';

export const queryCommand = new Command('query')
  .description('基于知识库回答问题')
  .argument('<question>', '要查询的问题')
  .option('--vault <path>', 'vault 目录路径', './freshmind-wiki')
  .action(async (question: string, options) => {
    try {
      const config = await loadConfig(options.vault);

      const spinner = ui.spin('正在搜索知识库...');

      const llm = new LLMClient({
        model: config.llm.model,
        baseUrl: config.llm.baseUrl,
      });
      const pageReader = new PageReader(config.vaultPath);
      const queryAgent = new QueryAgent(llm, pageReader);

      const { answer, sources } = await queryAgent.query(question);
      spinner.succeed('查询完成');

      // 输出回答
      console.log('');
      console.log(answer);

      // 输出来源
      console.log('');
      ui.info('--- 引用来源 ---');
      for (const s of sources) {
        const icon = s.freshness === 'fresh' ? '🟢'
          : s.freshness === 'stale' ? '🟡'
          : s.freshness === 'outdated' ? '🟠'
          : '🔴';
        ui.info(`${icon} ${s.page} (${s.freshness})`);
      }
    } catch (err) {
      if (err instanceof FreshMindError) {
        ui.error(err.message);
      } else {
        throw err;
      }
    }
  });
