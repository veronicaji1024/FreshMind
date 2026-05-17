/**
 * 知识新鲜度衰减公式
 *
 * freshness_score = e^(-λ × t)
 * λ = ln(2) / half_life_days
 * t = 距上次验证的天数
 */

export function calculateFreshness(halfLifeDays: number, daysSinceVerified: number): number {
  if (halfLifeDays <= 0) {
    throw new Error('half_life_days must be positive');
  }
  const lambda = Math.LN2 / halfLifeDays;
  return Math.exp(-lambda * daysSinceVerified);
}

export function getFreshnessStatus(score: number): 'fresh' | 'stale' | 'outdated' | 'expired' {
  if (score >= 0.75) return 'fresh';
  if (score >= 0.50) return 'stale';
  if (score >= 0.25) return 'outdated';
  return 'expired';
}

export function daysBetween(date1: Date, date2: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.abs(date2.getTime() - date1.getTime()) / MS_PER_DAY;
}
