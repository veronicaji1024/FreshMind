import { Command } from 'commander';
import { ui } from '../ui.js';
import { loadConfig } from '../../config/index.js';
import { LLMClient } from '../../agents/llm-client.js';
import { TavilySearch } from '../../search/tavily.js';
import { PageReader } from '../../wiki/page-reader.js';
import { PageWriter } from '../../wiki/page-writer.js';
import { CalibrationEngine } from '../../freshness/calibration.js';
import { buildUpdatePrompt } from '../../agents/prompts/index.js';
import { FreshMindError } from '../../types.js';
import type { CalibrationEvent } from '../../types.js';

export const updateCommand = new Command('update')
  .description('更新 wiki 页面')
  .argument('<page_path>', 'wiki 页面路径 (如 models/gpt-4o)')
  .option('--action <action>', '操作类型: update | archive | ignore', 'update')
  .option('--vault <path>', 'vault 目录路径', './freshmind-wiki')
  .action(async (pagePath: string, options) => {
    try {
      const config = await loadConfig(options.vault);
      const action = options.action as 'update' | 'archive' | 'ignore';

      const pageReader = new PageReader(config.vaultPath);
      const pageWriter = new PageWriter(config.vaultPath);
      const calibration = new CalibrationEngine(config.vaultPath);

      // 确保路径有 .md 后缀
      const normalizedPath = pagePath.endsWith('.md') ? pagePath : `${pagePath}.md`;

      // 读取当前页面
      const spinner = ui.spin(`正在处理 ${normalizedPath}...`);
      const { meta, content } = await pageReader.readPage(normalizedPath);
      const today = new Date().toISOString().slice(0, 10);

      switch (action) {
        case 'update': {
          const llm = new LLMClient({
            model: config.llm.model,
            baseUrl: config.llm.baseUrl,
          });
          const tavilySearch = new TavilySearch();

          // 搜索每个 claim 的最新信息
          const claims = meta.verifiable_claims ?? [];
          const allSearchResults: string[] = [];

          for (const claim of claims) {
            try {
              const results = await tavilySearch.search(claim.search_query, 3);
              for (const r of results) {
                allSearchResults.push(`[${r.title}] ${r.content.slice(0, 300)}\n来源: ${r.url}`);
              }
            } catch {
              // 跳过搜索失败的 claim
            }
          }

          if (allSearchResults.length === 0) {
            spinner.succeed(`${normalizedPath} 无新信息，已刷新验证日期`);
            await pageWriter.updatePage(normalizedPath, {
              last_verified: today,
            });
            break;
          }

          // 用 LLM 智能分析更新
          spinner.text = '正在用 LLM 分析更新...';
          const messages = buildUpdatePrompt(
            meta.title ?? normalizedPath,
            content,
            allSearchResults.join('\n\n'),
          );
          const analysis = await llm.chatJSON<{
            needs_update: boolean;
            summary: string;
            updated_claims?: { original: string; updated: string; status: string }[];
          }>(messages);

          // 更新 frontmatter 和内容
          const updateMeta: Record<string, unknown> = {
            last_verified: today,
            freshness_status: 'fresh',
          };

          const appendContent = analysis.needs_update && analysis.summary
            ? `\n## 更新记录 (${today})\n${analysis.summary}`
            : undefined;

          await pageWriter.updatePage(normalizedPath, updateMeta, appendContent);

          // 记录校准事件
          await calibration.recordEvent({
            type: meta.type,
            action: 'update',
            page_path: normalizedPath,
            timestamp: new Date().toISOString(),
          });

          if (analysis.needs_update) {
            spinner.succeed(`已智能更新 ${normalizedPath}: ${analysis.summary}`);
          } else {
            spinner.succeed(`${normalizedPath} 信息仍然有效 (last_verified = ${today})`);
          }
          break;
        }

        case 'archive': {
          await pageWriter.updatePage(normalizedPath, {
            freshness_status: 'archived',
          });
          spinner.succeed(`已归档 ${normalizedPath}`);
          break;
        }

        case 'ignore': {
          // 重置验证日期 + 触发校准
          const event: CalibrationEvent = {
            type: meta.type,
            action: 'ignore',
            page_path: normalizedPath,
            timestamp: new Date().toISOString(),
          };
          await calibration.recordEvent(event);
          const newHalfLife = await calibration.getHalfLife(meta.type);

          await pageWriter.updatePage(normalizedPath, {
            last_verified: today,
            freshness_status: 'fresh',
            half_life_days: newHalfLife,
          });

          spinner.succeed(
            `已忽略 ${normalizedPath} (半衰期: ${meta.half_life_days} → ${newHalfLife} 天)`,
          );
          break;
        }

        default:
          spinner.fail(`未知操作: ${action}`);
      }
    } catch (err) {
      if (err instanceof FreshMindError) {
        ui.error(err.message);
      } else {
        throw err;
      }
    }
  });
