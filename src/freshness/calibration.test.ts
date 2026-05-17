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
});
