import { Command } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { ui } from '../ui.js';
import { loadConfig } from '../../config/config.js';
import type { SourcesConfig, BlogSource } from '../../types.js';

async function loadSources(vaultPath: string): Promise<SourcesConfig> {
  const raw = await readFile(path.join(vaultPath, 'sources.yaml'), 'utf-8');
  return YAML.parse(raw);
}

async function saveSources(vaultPath: string, sources: SourcesConfig) {
  await writeFile(
    path.join(vaultPath, 'sources.yaml'),
    YAML.stringify(sources),
  );
}

export function registerSources(program: Command) {
  const cmd = program
    .command('sources')
    .description('管理信息源');

  cmd
    .command('list')
    .description('列出所有信息源')
    .option('--vault <path>', 'vault 目录路径')
    .action(async (opts) => {
      const config = await loadConfig(opts.vault);
      const sources = await loadSources(config.vault_path);

      console.log('\n📰 博客/Newsletter（已启用）:');
      const enabledBlogs = sources.blogs.filter(b => b.enabled);
      if (enabledBlogs.length === 0) {
        console.log('  (无)');
      } else {
        for (const b of enabledBlogs) {
          console.log(`  ${b.id} — ${b.name} (${b.url})`);
        }
      }

      const disabledBlogs = sources.blogs.filter(b => !b.enabled);
      if (disabledBlogs.length > 0) {
        console.log(`\n  + ${disabledBlogs.length} 个已禁用`);
      }

      console.log(`\n🐦 X/Twitter: ${sources.x_accounts?.length ?? 0} 个（v0.2 启用）`);
      console.log(`🎙️ 播客/YouTube: ${sources.podcasts?.length ?? 0} 个（v0.4 启用）`);
    });

  cmd
    .command('add')
    .description('添加新信息源')
    .requiredOption('--url <url>', '信息源 URL')
    .option('--name <name>', '名称')
    .option('--rss <rss>', 'RSS feed URL')
    .option('--category <cat>', '类别', 'general')
    .option('--vault <path>', 'vault 目录路径')
    .action(async (opts) => {
      const config = await loadConfig(opts.vault);
      const sources = await loadSources(config.vault_path);

      const id = opts.name?.toLowerCase().replace(/\s+/g, '-')
        ?? new URL(opts.url).hostname.replace(/^www\./, '').replace(/\./g, '-');

      const newSource: BlogSource = {
        id,
        name: opts.name ?? id,
        url: opts.url,
        rss: opts.rss ?? null,
        category: opts.category,
        enabled: true,
      };

      sources.blogs.push(newSource);
      await saveSources(config.vault_path, sources);
      ui.success(`已添加: ${newSource.id} (${newSource.url})`);
    });

  cmd
    .command('remove <id>')
    .description('删除信息源')
    .option('--vault <path>', 'vault 目录路径')
    .action(async (id, opts) => {
      const config = await loadConfig(opts.vault);
      const sources = await loadSources(config.vault_path);

      const idx = sources.blogs.findIndex(b => b.id === id);
      if (idx === -1) {
        ui.error(`未找到信息源: ${id}`);
        return;
      }

      sources.blogs.splice(idx, 1);
      await saveSources(config.vault_path, sources);
      ui.success(`已删除: ${id}`);
    });

  cmd
    .command('enable <id>')
    .description('启用信息源')
    .option('--vault <path>', 'vault 目录路径')
    .action(async (id, opts) => {
      const config = await loadConfig(opts.vault);
      const sources = await loadSources(config.vault_path);
      const source = sources.blogs.find(b => b.id === id);
      if (!source) { ui.error(`未找到: ${id}`); return; }
      source.enabled = true;
      await saveSources(config.vault_path, sources);
      ui.success(`已启用: ${id}`);
    });

  cmd
    .command('disable <id>')
    .description('禁用信息源')
    .option('--vault <path>', 'vault 目录路径')
    .action(async (id, opts) => {
      const config = await loadConfig(opts.vault);
      const sources = await loadSources(config.vault_path);
      const source = sources.blogs.find(b => b.id === id);
      if (!source) { ui.error(`未找到: ${id}`); return; }
      source.enabled = false;
      await saveSources(config.vault_path, sources);
      ui.success(`已禁用: ${id}`);
    });
}
