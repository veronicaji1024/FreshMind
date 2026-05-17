// ─── 信息类型 ──────────────────────────────────
export type InfoType =
  | 'benchmark_data'
  | 'model_capability'
  | 'product_update'
  | 'company_strategy'
  | 'industry_trend'
  | 'person_move'
  | 'tech_concept';

export type FreshnessStatus = 'fresh' | 'stale' | 'outdated' | 'expired';

// ─── 原始抓取结果 ──────────────────────────────
export interface RawItem {
  source_id: string;
  title: string;
  content: string;
  url: string;
  published_at: string;
  source_type: 'blog' | 'tweet' | 'podcast';
}

// ─── 可验证声明 ────────────────────────────────
export interface VerifiableClaim {
  claim: string;
  search_query: string;
  confidence: number;
  last_checked?: string;
  status?: 'confirmed' | 'updated' | 'contradicted' | 'uncertain';
}

// ─── Wiki 页面元数据 ──────────────────────────
export interface WikiPageMeta {
  title: string;
  type: InfoType;
  created: string;
  last_verified: string;
  half_life_days: number;
  freshness_status: FreshnessStatus;
  confidence: number;
  sources: { url: string; date: string }[];
  related: string[];
  tags: string[];
  verifiable_claims: VerifiableClaim[];
  superseded_by?: string | null;
}

// ─── LLM 结构化提取结果 ──────────────────────
export interface IngestResult {
  title: string;
  summary: string;
  type: InfoType;
  verifiable_claims: VerifiableClaim[];
  entities: string[];
  related_concepts: string[];
  source_date: string;
}

// ─── 保鲜验证结果 ──────────────────────────────
export interface VerificationResult {
  claim: string;
  status: 'confirmed' | 'updated' | 'contradicted' | 'uncertain';
  evidence: string;
  new_info?: string;
  source_url?: string;
}

// ─── 新鲜度扫描条目 ────────────────────────────
export interface FreshnessEntry {
  page_path: string;
  meta: WikiPageMeta;
  freshness_score: number;
  freshness_status: FreshnessStatus;
  days_since_verified: number;
}

// ─── 校准事件 ──────────────────────────────────
export interface CalibrationEvent {
  type: InfoType;
  action: 'update' | 'archive' | 'ignore' | 'manual_edit' | 'confirmed_3x';
  page_path: string;
  timestamp: string;
}

// ─── Crawl 统计 ────────────────────────────────
export interface CrawlStats {
  total: number;
  new: number;
  skipped: number;
}

export interface CrawlResult {
  raw_items: RawItem[];
  new_items: RawItem[];
  stats: CrawlStats;
}

// ─── 信息源配置 ────────────────────────────────
export interface BlogSource {
  id: string;
  name: string;
  url: string;
  rss: string | null;
  category: string;
  enabled: boolean;
}

export interface XAccountSource {
  handle: string;
  name: string;
  category: string;
  enabled: boolean;
}

export interface PodcastSource {
  id: string;
  name: string;
  platform: string;
  rss?: string | null;
  youtube?: string;
  url?: string;
  category: string;
  enabled: boolean;
}

export interface SourcesConfig {
  blogs: BlogSource[];
  x_accounts: XAccountSource[];
  podcasts: PodcastSource[];
}

// ─── 去重状态 ──────────────────────────────────
export interface DedupState {
  seenItems: Record<string, number>;
  lastCrawl: string;
  stats: {
    totalCrawls: number;
    totalIngested: number;
    totalSkipped: number;
  };
}

// ─── Index 条目 ────────────────────────────────
export interface IndexEntry {
  page_path: string;
  title: string;
  type: InfoType;
  freshness_status: FreshnessStatus;
  last_verified: string;
}

// ─── 应用配置 ──────────────────────────────────
export interface AppConfig {
  vault_path: string;
  llm: {
    provider: string;
    model: string;
    api_key: string;
    base_url: string;
  };
  search: {
    provider: string;
    api_key: string;
  };
  freshcheck: {
    max_items: number;
    threshold: number;
  };
}
