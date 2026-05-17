import { PageReader } from '../wiki/page-reader.js';
import { calculateFreshness, getFreshnessStatus, daysBetween } from './decay.js';
import { FRESHCHECK_DEFAULTS } from '../config/defaults.js';
import type { FreshnessEntry } from '../types.js';

export class FreshnessScanner {
  constructor(
    private pageReader: PageReader,
    private vaultPath: string,
  ) {}

  async scanVault(now?: Date): Promise<FreshnessEntry[]> {
    const currentDate = now ?? new Date();
    const pages = await this.pageReader.readAllPages();
    const entries: FreshnessEntry[] = [];

    for (const page of pages) {
      const lastVerified = new Date(page.meta.last_verified);
      const days = daysBetween(lastVerified, currentDate);
      const score = calculateFreshness(page.meta.half_life_days, days);
      const status = getFreshnessStatus(score);

      entries.push({
        page_path: page.path,
        meta: page.meta,
        freshness_score: score,
        freshness_status: status,
        days_since_verified: Math.round(days),
      });
    }

    return entries;
  }

  async getCheckPriority(
    threshold?: number,
    maxItems?: number,
    now?: Date,
  ): Promise<FreshnessEntry[]> {
    const entries = await this.scanVault(now);
    const cutoff = threshold ?? FRESHCHECK_DEFAULTS.threshold;
    const limit = maxItems ?? FRESHCHECK_DEFAULTS.maxItems;

    return entries
      .filter(e => e.freshness_score < cutoff)
      .sort((a, b) => a.freshness_score - b.freshness_score)
      .slice(0, limit);
  }
}
