import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { DEFAULT_HALF_LIFE, CALIBRATION_FACTORS, HALF_LIFE_BOUNDS } from '../config/defaults.js';
import type { InfoType, CalibrationEvent } from '../types.js';

interface CalibrationData {
  last_updated: string | null;
  calibrated_half_life: Partial<Record<InfoType, number>>;
  calibration_log: Array<{
    date: string;
    type: string;
    action: string;
    page: string;
    old_half_life: number;
    new_half_life: number;
  }>;
}

export class CalibrationEngine {
  private calibPath: string;

  constructor(private vaultPath: string) {
    this.calibPath = join(vaultPath, '_meta/calibration.yaml');
  }

  async getHalfLife(type: InfoType): Promise<number> {
    const data = await this.readData();
    return data.calibrated_half_life[type] ?? DEFAULT_HALF_LIFE[type];
  }

  async recordEvent(event: CalibrationEvent): Promise<void> {
    const data = await this.readData();
    const currentHalfLife = data.calibrated_half_life[event.type]
      ?? DEFAULT_HALF_LIFE[event.type];

    const newHalfLife = calibrate(currentHalfLife, event.action);

    // 更新校准数据
    data.calibrated_half_life[event.type] = Math.round(newHalfLife);
    data.last_updated = new Date().toISOString().slice(0, 10);

    // 追加日志（保留最近 50 条）
    data.calibration_log.unshift({
      date: new Date().toISOString().slice(0, 10),
      type: event.type,
      action: event.action,
      page: event.page_path,
      old_half_life: currentHalfLife,
      new_half_life: Math.round(newHalfLife),
    });
    data.calibration_log = data.calibration_log.slice(0, 50);

    await this.writeData(data);
  }

  private async readData(): Promise<CalibrationData> {
    try {
      const content = await readFile(this.calibPath, 'utf-8');
      const data = parseYaml(content);
      return {
        last_updated: data?.last_updated ?? null,
        calibrated_half_life: data?.calibrated_half_life ?? {},
        calibration_log: data?.calibration_log ?? [],
      };
    } catch {
      return {
        last_updated: null,
        calibrated_half_life: {},
        calibration_log: [],
      };
    }
  }

  private async writeData(data: CalibrationData): Promise<void> {
    await mkdir(dirname(this.calibPath), { recursive: true });
    const content = `# 半衰期自校准参数（自动生成，请勿手动编辑）\n${stringifyYaml(data)}`;
    await writeFile(this.calibPath, content);
  }
}

/**
 * 校准半衰期（严格对齐 PRD 第九节 Layer 1）
 *
 * | 用户行为                          | 校准动作              |
 * |----------------------------------|----------------------|
 * | 🔴 执行 update                    | 不变（猜对了）         |
 * | 🔴 执行 ignore                    | × 1.5（误报，太短了）  |
 * | 🟢 用户主动编辑 (manual_edit)       | × 0.7（漏报，太长了）  |
 * | 🟡 skip 后 30 天内编辑             | × 0.85（略长）        |
 * | 🟡 skip 后一直没动                 | 不变                  |
 * | 某 claim 连续 3 次 confirmed       | × 1.3（稳定）         |
 * | archive                           | 不变                  |
 */
export function calibrate(
  currentHalfLife: number,
  action: CalibrationEvent['action'],
): number {
  let result: number;
  switch (action) {
    case 'update':
      result = currentHalfLife;
      break;
    case 'ignore':
      result = currentHalfLife * CALIBRATION_FACTORS.ignore;
      break;
    case 'manual_edit':
      result = currentHalfLife * CALIBRATION_FACTORS.manual_edit;
      break;
    case 'skip_then_edit':
      result = currentHalfLife * CALIBRATION_FACTORS.skip_then_edit;
      break;
    case 'confirmed_3x':
      result = currentHalfLife * CALIBRATION_FACTORS.confirmed_3x;
      break;
    case 'archive':
      result = currentHalfLife;
      break;
    default:
      result = currentHalfLife;
  }
  return Math.max(HALF_LIFE_BOUNDS.min, Math.min(HALF_LIFE_BOUNDS.max, result));
}
