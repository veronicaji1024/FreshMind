#!/usr/bin/env node

import { Command } from 'commander';
import { registerInit } from './commands/init.js';
import { registerCrawl } from './commands/crawl.js';
import { registerIngest } from './commands/ingest.js';
import { registerSources } from './commands/sources.js';

const program = new Command();

program
  .name('fm')
  .description('FreshMind — AI PM 知识保鲜系统')
  .version('0.1.0');

registerInit(program);
registerCrawl(program);
registerIngest(program);
registerSources(program);

program.parse();
