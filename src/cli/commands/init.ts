import { Command } from 'commander';
import { mkdir, copyFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ui } from '../ui.js';
import { VAULT_DIRS, DEFAULT_HALF_LIFE } from '../../config/defaults.js';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, '../../..', 'templates');

export function registerInit(program: Command) {
  program
    .command('init')
    .description('初始化 FreshMind wiki vault')
    .option('--vault <path>', 'vault 目录路径', './freshmind-wiki')
    .action(async (opts) => {
      const vaultPath = path.resolve(opts.vault);

      if (existsSync(vaultPath)) {
        ui.warn(`目录已存在: ${vaultPath}`);
        return;
      }

      const spinner = ui.spin('初始化 FreshMind vault...');

      // 创建子目录
      for (const dir of VAULT_DIRS) {
        await mkdir(path.join(vaultPath, dir), { recursive: true });
      }

      // 复制模板文件
      const templateFiles = [
        ['sources.yaml', 'sources.yaml'],
        ['index.md', 'index.md'],
        ['.freshmind.yaml', '.freshmind.yaml'],
      ];

      for (const [src, dest] of templateFiles) {
        const srcPath = path.join(TEMPLATES_DIR, src);
        if (existsSync(srcPath)) {
          await copyFile(srcPath, path.join(vaultPath, dest));
        }
      }

      // 初始化 _meta/state.json
      await writeFile(
        path.join(vaultPath, '_meta', 'state.json'),
        JSON.stringify({
          seenItems: {},
          lastCrawl: null,
          stats: { totalCrawls: 0, totalIngested: 0, totalSkipped: 0 },
        }, null, 2),
      );

      // 初始化 _meta/calibration.yaml
      const calibration = {
        last_updated: new Date().toISOString().split('T')[0],
        calibrated_half_life: { ...DEFAULT_HALF_LIFE },
        calibration_log: [],
      };
      await writeFile(
        path.join(vaultPath, '_meta', 'calibration.yaml'),
        YAML.stringify(calibration),
      );

      // 初始化 log.md
      await writeFile(
        path.join(vaultPath, 'log.md'),
        `# FreshMind 操作日志\n\n`,
      );

      spinner.succeed(`FreshMind vault 已创建: ${vaultPath}`);
      ui.info(`在 Obsidian 中打开此目录即可浏览 wiki`);
    });
}
