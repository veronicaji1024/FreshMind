import type { InfoType } from '../types.js';

/** 信息类型 → 默认半衰期（天） */
export const DEFAULT_HALF_LIFE: Record<InfoType, number> = {
  benchmark_data: 45,
  model_capability: 60,
  product_update: 120,
  company_strategy: 180,
  industry_trend: 180,
  person_move: 365,
  tech_concept: 540,
};

/** 新鲜度分数 → 状态阈值 */
export const FRESHNESS_THRESHOLDS = {
  fresh: 0.75,
  stale: 0.50,
  outdated: 0.25,
  expired: 0,
} as const;

/** 保鲜检查默认配置 */
export const FRESHCHECK_DEFAULTS = {
  maxItems: 10,
  threshold: 0.75,
} as const;

/** Crawl 默认配置 (Person A) */
export const CRAWL_DEFAULTS = {
  maxArticlesPerSource: 3,
  lookbackHours: 72,
  delayMs: 500,
  statePruneDays: 90,
} as const;

/** LLM 默认配置 */
export const LLM_DEFAULTS = {
  model: 'Pro/moonshotai/Kimi-K2.6',
  baseUrl: 'https://api.siliconflow.cn/v1',
  temperature: 0.3,
  maxTokens: 4096,
} as const;

/** 校准系数（严格对齐 PRD 第九节） */
export const CALIBRATION_FACTORS = {
  ignore: 1.5,           // 🔴误报：信息没过时但系统说过时了 → 半衰期太短
  manual_edit: 0.7,      // 🟢漏报：信息过时了但系统没发现 → 半衰期太长
  skip_then_edit: 0.85,  // 🟡略长：暂不处理后30天内用户手动更新
  confirmed_3x: 1.3,     // 连续3次confirmed：该声明已证明稳定
} as const;

/** 半衰期上下限（天） */
export const HALF_LIFE_BOUNDS = {
  min: 7,
  max: 1095,
} as const;

/** Wiki 目录 → InfoType 映射 */
export const DIR_TYPE_MAP: Record<string, InfoType[]> = {
  entities: ['company_strategy', 'person_move'],
  concepts: ['tech_concept'],
  models: ['model_capability', 'benchmark_data'],
  comparisons: ['model_capability'],
  trends: ['industry_trend'],
};

/** 信息类型 → 默认存放目录 */
export const TYPE_DIR_MAP: Record<InfoType, string> = {
  benchmark_data: 'models',
  model_capability: 'models',
  product_update: 'entities',
  company_strategy: 'entities',
  industry_trend: 'trends',
  person_move: 'entities',
  tech_concept: 'concepts',
};

/** Wiki vault 子目录列表 */
export const VAULT_DIRS = [
  'entities',
  'concepts',
  'models',
  'comparisons',
  'trends',
  'raw',
  '_meta',
] as const;
