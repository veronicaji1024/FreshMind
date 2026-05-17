import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import type { DedupState } from '../types.js';
import { CRAWL_DEFAULTS } from '../config/defaults.js';

export class DedupManager {
  private state: DedupState;
  private filePath: string;

  constructor(vaultPath: string) {
    this.filePath = path.join(vaultPath, '_meta', 'state.json');
    this.state = {
      seenItems: {},
      lastCrawl: new Date().toISOString(),
      stats: { totalCrawls: 0, totalIngested: 0, totalSkipped: 0 },
    };
  }

  async load(): Promise<void> {
    if (!existsSync(this.filePath)) return;
    const raw = await readFile(this.filePath, 'utf-8');
    this.state = JSON.parse(raw);
  }

  isDuplicate(url: string): boolean {
    return url in this.state.seenItems;
  }

  markSeen(url: string): void {
    this.state.seenItems[url] = Date.now();
  }

  prune(daysToKeep = CRAWL_DEFAULTS.statePruneDays): void {
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    for (const [url, ts] of Object.entries(this.state.seenItems)) {
      if (ts < cutoff) {
        delete this.state.seenItems[url];
      }
    }
  }

  updateStats(newCount: number, skippedCount: number): void {
    this.state.stats.totalCrawls++;
    this.state.stats.totalIngested += newCount;
    this.state.stats.totalSkipped += skippedCount;
    this.state.lastCrawl = new Date().toISOString();
  }

  async save(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2));
  }
}
