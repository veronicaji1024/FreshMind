import { describe, it, expect } from 'vitest';
import { calculateFreshness, getFreshnessStatus, daysBetween } from './decay.js';

describe('calculateFreshness', () => {
  it('t=0 时新鲜度为 1', () => {
    expect(calculateFreshness(45, 0)).toBe(1);
  });

  it('t=半衰期 时新鲜度为 0.5', () => {
    expect(calculateFreshness(45, 45)).toBeCloseTo(0.5, 5);
  });

  it('benchmark_data 90天后约 25%', () => {
    expect(calculateFreshness(45, 90)).toBeCloseTo(0.25, 2);
  });

  it('tech_concept 90天后约 89%', () => {
    expect(calculateFreshness(540, 90)).toBeCloseTo(0.89, 2);
  });

  it('company_strategy 180天后为 0.5', () => {
    expect(calculateFreshness(180, 180)).toBeCloseTo(0.5, 5);
  });

  it('model_capability 60天后为 0.5', () => {
    expect(calculateFreshness(60, 60)).toBeCloseTo(0.5, 5);
  });

  it('非常大的 t 值趋近于 0', () => {
    expect(calculateFreshness(45, 10000)).toBeCloseTo(0, 5);
  });

  it('halfLifeDays <= 0 应抛出错误', () => {
    expect(() => calculateFreshness(0, 10)).toThrow();
    expect(() => calculateFreshness(-5, 10)).toThrow();
  });
});

describe('getFreshnessStatus', () => {
  it('>= 0.75 为 fresh', () => {
    expect(getFreshnessStatus(0.75)).toBe('fresh');
    expect(getFreshnessStatus(1.0)).toBe('fresh');
    expect(getFreshnessStatus(0.9)).toBe('fresh');
  });

  it('>= 0.50 且 < 0.75 为 stale', () => {
    expect(getFreshnessStatus(0.50)).toBe('stale');
    expect(getFreshnessStatus(0.74)).toBe('stale');
  });

  it('>= 0.25 且 < 0.50 为 outdated', () => {
    expect(getFreshnessStatus(0.25)).toBe('outdated');
    expect(getFreshnessStatus(0.49)).toBe('outdated');
  });

  it('< 0.25 为 expired', () => {
    expect(getFreshnessStatus(0.24)).toBe('expired');
    expect(getFreshnessStatus(0)).toBe('expired');
  });
});

describe('daysBetween', () => {
  it('同一天返回 0', () => {
    const d = new Date('2026-05-17');
    expect(daysBetween(d, d)).toBe(0);
  });

  it('相隔 30 天', () => {
    const d1 = new Date('2026-01-01');
    const d2 = new Date('2026-01-31');
    expect(daysBetween(d1, d2)).toBe(30);
  });

  it('参数顺序不影响结果', () => {
    const d1 = new Date('2026-01-01');
    const d2 = new Date('2026-03-01');
    expect(daysBetween(d1, d2)).toBe(daysBetween(d2, d1));
  });
});
