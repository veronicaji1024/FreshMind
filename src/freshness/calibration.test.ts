import { describe, it, expect } from 'vitest';
import { calibrate } from './calibration.js';

describe('calibrate', () => {
  it('update 不改变半衰期', () => {
    expect(calibrate(60, 'update')).toBe(60);
  });

  it('ignore 半衰期 ×1.5', () => {
    expect(calibrate(60, 'ignore')).toBe(90);
  });

  it('manual_edit 半衰期 ×0.7', () => {
    expect(calibrate(100, 'manual_edit')).toBeCloseTo(70, 5);
  });

  it('confirmed_3x 半衰期 ×1.3', () => {
    expect(calibrate(100, 'confirmed_3x')).toBeCloseTo(130, 5);
  });

  it('archive 不改变半衰期', () => {
    expect(calibrate(180, 'archive')).toBe(180);
  });

  it('连续 ignore 累积效果', () => {
    let hl = 45;
    hl = calibrate(hl, 'ignore'); // 67.5
    hl = calibrate(hl, 'ignore'); // 101.25
    expect(hl).toBeCloseTo(45 * 1.5 * 1.5, 5);
  });

  it('半衰期不会超过上限 1095 天', () => {
    // 1000 * 1.5 = 1500 → 应被 clamp 到 1095
    expect(calibrate(1000, 'ignore')).toBe(1095);
  });

  it('半衰期不会低于下限 7 天', () => {
    // 8 * 0.7 = 5.6 → 应被 clamp 到 7
    expect(calibrate(8, 'manual_edit')).toBe(7);
  });

  it('连续 ignore 最终被上限限制', () => {
    let hl = 540;
    for (let i = 0; i < 20; i++) {
      hl = calibrate(hl, 'ignore');
    }
    expect(hl).toBe(1095);
  });
});
