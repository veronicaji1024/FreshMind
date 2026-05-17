#!/usr/bin/env bun

import { Command } from 'commander';
import { registerInit } from './commands/init.js';
import { registerCrawl } from './commands/crawl.js';
import { registerIngest } from './commands/ingest.js';
import { registerSources } from './commands/sources.js';
import { registerDaemon } from './commands/daemon.js';
import { freshcheckCommand } from './commands/freshcheck.js';
import { queryCommand } from './commands/query.js';
import { updateCommand } from './commands/update.js';
import { FreshMindError } from '../types.js';
import { ui } from './ui.js';

const program = new Command();

program
  .name('fm')
  .version('0.1.0')
  .description('FreshMind — AI PM 知识保鲜系统');

// Person A 的命令
registerInit(program);
registerCrawl(program);
registerIngest(program);
registerSources(program);
registerDaemon(program);

// Person B 的命令
program.addCommand(freshcheckCommand);
program.addCommand(queryCommand);
program.addCommand(updateCommand);

// 统一错误处理
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof FreshMindError) {
    ui.error(err.message);
    process.exit(1);
  }
  if (err instanceof Error && 'exitCode' in err) {
    process.exit((err as any).exitCode);
  }
  throw err;
}
