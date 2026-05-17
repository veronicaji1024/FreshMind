import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { DEFAULT_HALF_LIFE, CALIBRATION_FACTORS } from '../config/defaults.js';
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

export function calibrate(
  currentHalfLife: number,
  action: CalibrationEvent['action'],
): number {
  switch (action) {
    case 'update':
      return currentHalfLife;
    case 'ignore':
      return currentHalfLife * CALIBRATION_FACTORS.ignore;
    case 'manual_edit':
      return currentHalfLife * CALIBRATION_FACTORS.manual_edit;
    case 'confirmed_3x':
      return currentHalfLife * CALIBRATION_FACTORS.confirmed_3x;
    case 'archive':
      return currentHalfLife;
    default:
      return currentHalfLife;
  }
}
