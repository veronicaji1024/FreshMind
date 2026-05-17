# FreshMind Architecture Breakdown & 分工方案

> 版本：v0.1 MVP | 日期：2026-05-17

---

## 一、模块总览

```
freshmind/
├── src/
│   ├── cli/                    # 模块 A: CLI 入口层
│   │   ├── index.ts            # Commander.js 主入口
│   │   ├── commands/
│   │   │   ├── init.ts         # fm init
│   │   │   ├── crawl.ts        # fm crawl
│   │   │   ├── ingest.ts       # fm ingest
│   │   │   ├── freshcheck.ts   # fm freshcheck
│   │   │   ├── query.ts        # fm query
│   │   │   ├── update.ts       # fm update
│   │   │   ├── sources.ts      # fm sources
│   │   │   └── status.ts       # fm status
│   │   └── ui.ts               # 终端输出格式化（Ora spinner, chalk 颜色）
│   │
│   ├── crawler/                # 模块 B: 信息源抓取层
│   │   ├── index.ts            # CrawlAgent 主入口
│   │   ├── rss.ts              # RSS 解析（rss-parser）
│   │   ├── html.ts             # HTML 正文提取（Cheerio + Readability）
│   │   ├── twitter.ts          # X API v2 抓取（v0.2）
│   │   ├── podcast.ts          # 播客转录（v0.4）
│   │   └── dedup.ts            # 去重逻辑（state.json 读写 + 7天清理）
│   │
│   ├── agents/                 # 模块 C: LLM Agent 层
│   │   ├── llm-client.ts       # SiliconFlow/Kimi K2.6 统一调用封装
│   │   ├── ingest-agent.ts     # Ingest Agent：结构化提取 + 分类 + 半衰期
│   │   ├── freshness-agent.ts  # Freshness Agent：搜索验证 + 新旧对比
│   │   ├── query-agent.ts      # Query Agent：读 wiki 综合回答
│   │   └── prompts/            # Prompt 模板集中管理
│   │       ├── ingest.ts       # Ingest 结构化提取 prompt
│   │       ├── verify.ts       # 保鲜验证 prompt
│   │       └── query.ts        # 查询回答 prompt
│   │
│   ├── wiki/                   # 模块 D: Wiki 读写层
│   │   ├── index-manager.ts    # index.md 维护（增删改查条目）
│   │   ├── page-writer.ts      # wiki 页面创建/更新（含 frontmatter）
│   │   ├── page-reader.ts      # wiki 页面读取 + frontmatter 解析
│   │   ├── log-writer.ts       # log.md append-only 日志
│   │   ├── report-writer.ts    # freshness-report-latest.md 生成
│   │   └── linker.ts           # [[wikilink]] 交叉引用管理
│   │
│   ├── freshness/              # 模块 E: 新鲜度计算引擎
│   │   ├── decay.ts            # 指数衰减公式 + 分数→状态映射
│   │   ├── calibration.ts      # 半衰期自校准逻辑 + calibration.yaml 读写
│   │   └── scanner.ts          # 批量扫描 vault 计算新鲜度 + 优先级排序
│   │
│   ├── search/                 # 模块 F: Web Search 封装
│   │   ├── tavily.ts           # Tavily API 调用
│   │   └── types.ts            # 搜索结果类型定义
│   │
│   └── config/                 # 模块 G: 配置管理
│       ├── config.ts           # .freshmind.yaml 读写
│       ├── sources.ts          # sources.yaml 读写 + CRUD
│       └── defaults.ts         # 默认半衰期、阈值等常量
│
├── templates/                  # fm init 时复制的模板文件
│   ├── sources.yaml            # 107 个预置信息源
│   ├── index.md                # 空 index 模板
│   └── .freshmind.yaml         # 配置模板
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## 二、模块依赖关系

```
                    ┌──────────────────┐
                    │  A: CLI 入口层    │
                    │  (commands/*.ts) │
                    └────────┬─────────┘
                             │ 调用
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
   ┌────────────┐   ┌────────────┐   ┌────────────────┐
   │ B: Crawler │   │ C: Agents  │   │ E: Freshness   │
   │ (抓取+去重) │   │ (LLM调用)  │   │ (衰减计算)     │
   └─────┬──────┘   └──────┬─────┘   └───────┬────────┘
         │                 │                  │
         │           ┌─────┼─────┐            │
         │           │     │     │            │
         ▼           ▼     ▼     ▼            ▼
   ┌──────────┐ ┌──────┐ ┌──────┐  ┌──────────────┐
   │ G:Config │ │D:Wiki│ │F:Search│ │ G: Config    │
   │(sources) │ │(读写) │ │(Tavily)│ │(calibration) │
   └──────────┘ └──────┘ └──────┘  └──────────────┘
```

**依赖规则**：
- A 依赖 B/C/D/E/F/G（CLI 是编排层）
- B 依赖 G（读 sources.yaml + state.json）
- C 依赖 D（写 wiki 页面）、F（搜索）、G（读 API key）
- E 依赖 D（读 frontmatter）、G（读 calibration.yaml）
- B/C/D/E/F/G 之间**无循环依赖**

---

## 三、核心接口定义

### 模块间数据类型

```typescript
// ─── 原始抓取结果 ──────────────────────────
interface RawItem {
  source_id: string;          // 来源 ID（如 "anthropic-engineering"）
  title: string;
  content: string;            // 正文纯文本
  url: string;
  published_at: string;       // ISO 日期
  source_type: 'blog' | 'tweet' | 'podcast';
}

// ─── LLM 结构化提取结果 ──────────────────────
interface IngestResult {
  title: string;
  summary: string;
  type: InfoType;
  verifiable_claims: VerifiableClaim[];
  entities: string[];
  related_concepts: string[];
  source_date: string;
}

type InfoType = 
  | 'benchmark_data' | 'model_capability' | 'product_update'
  | 'company_strategy' | 'industry_trend' | 'person_move' 
  | 'tech_concept';

interface VerifiableClaim {
  claim: string;
  search_query: string;
  confidence: number;
}

// ─── 保鲜验证结果 ──────────────────────────
interface VerificationResult {
  claim: string;
  status: 'confirmed' | 'updated' | 'contradicted' | 'uncertain';
  evidence: string;
  new_info?: string;
  source_url?: string;
}

// ─── Wiki 页面元数据 ──────────────────────────
interface WikiPageMeta {
  title: string;
  type: InfoType;
  created: string;
  last_verified: string;
  half_life_days: number;
  freshness_status: 'fresh' | 'stale' | 'outdated' | 'expired';
  confidence: number;
  sources: { url: string; date: string }[];
  related: string[];
  tags: string[];
  verifiable_claims: (VerifiableClaim & {
    last_checked?: string;
    status?: string;
  })[];
}

// ─── 新鲜度扫描结果 ──────────────────────────
interface FreshnessEntry {
  page_path: string;
  meta: WikiPageMeta;
  freshness_score: number;
  freshness_status: 'fresh' | 'stale' | 'outdated' | 'expired';
  days_since_verified: number;
}
```

### 模块公开方法

```typescript
// ─── B: Crawler ──────────────────────────────
class CrawlAgent {
  async crawl(options?: { type?: 'blogs' | 'x' | 'podcasts' }): Promise<{
    raw_items: RawItem[];
    new_items: RawItem[];      // 去重后
    stats: { total: number; new: number; skipped: number };
  }>;
}

// ─── C: Agents ───────────────────────────────
class IngestAgent {
  async ingest(input: { url?: string; text?: string }): Promise<{
    page_path: string;         // 写入的 wiki 页面路径
    action: 'created' | 'updated';
    claims_count: number;
    conflicts: string[];       // 与已有知识的矛盾
  }>;
}

class FreshnessAgent {
  async check(entries: FreshnessEntry[]): Promise<{
    results: (FreshnessEntry & { verification: VerificationResult[] })[];
    report_path: string;       // 保鲜报告文件路径
  }>;
}

class QueryAgent {
  async query(question: string): Promise<{
    answer: string;
    sources: { page: string; freshness: string }[];
  }>;
}

// ─── D: Wiki ─────────────────────────────────
class IndexManager {
  async read(): Promise<IndexEntry[]>;
  async addOrUpdate(entry: IndexEntry): Promise<void>;
  async rebuild(): Promise<void>;  // 全量重建
}

class PageWriter {
  async createPage(dir: string, slug: string, meta: WikiPageMeta, content: string): Promise<string>;
  async updatePage(path: string, updates: Partial<WikiPageMeta>, contentAppend?: string): Promise<void>;
  async findRelatedPages(entities: string[], concepts: string[]): Promise<string[]>;
}

class PageReader {
  async readPage(path: string): Promise<{ meta: WikiPageMeta; content: string }>;
  async readAllPages(): Promise<{ path: string; meta: WikiPageMeta }[]>;
}

// ─── E: Freshness ────────────────────────────
class FreshnessEngine {
  calculateScore(halfLifeDays: number, daysSinceVerified: number): number;
  getStatus(score: number): 'fresh' | 'stale' | 'outdated' | 'expired';
  async scanVault(): Promise<FreshnessEntry[]>;
  async getCheckPriority(threshold?: number): Promise<FreshnessEntry[]>;
}

class CalibrationEngine {
  async getHalfLife(type: InfoType): Promise<number>;
  async recordEvent(event: CalibrationEvent): Promise<void>;
}

// ─── F: Search ───────────────────────────────
class TavilySearch {
  async search(query: string): Promise<SearchResult[]>;
}
```

---

## 四、分工方案

### 人力假设

假设 2 人协作（Person A + Person B），48 小时黑客松。

### 分工原则

1. **按垂直切片分**，不按水平层分——每人端到端负责若干完整功能
2. **先打通骨架**：Day 1 上午两人一起搭基础设施（项目初始化 + 公共模块），下午各自开发功能
3. **接口先行**：types.ts 和模块接口在搭基础设施阶段一起定义

### 具体分工

```
┌────────────────────────────────────────────────────────────────┐
│                    Day 1 上午（0-4h）: 共建基础                  │
│                                                                │
│  两人一起完成：                                                 │
│  • 项目初始化（package.json, tsconfig, CLI 骨架）               │
│  • types.ts 核心类型定义                                        │
│  • G: config.ts + defaults.ts（配置读写）                       │
│  • templates/ 目录（sources.yaml 预置源列表）                    │
│  • fm init 命令                                                │
└────────────────────────────────────────────────────────────────┘

┌───────────────────────────┐    ┌───────────────────────────────┐
│     Person A: 数据采集线    │    │     Person B: 智能分析线       │
│                           │    │                               │
│  Day 1 下午（4-12h）       │    │  Day 1 下午（4-12h）           │
│                           │    │                               │
│  ✦ 模块 B: Crawler        │    │  ✦ 模块 C: LLM Agent          │
│    • rss.ts（RSS 解析）    │    │    • llm-client.ts            │
│    • html.ts（HTML 提取）  │    │      (SiliconFlow 封装)       │
│    • dedup.ts（去重状态）   │    │    • prompts/*.ts             │
│                           │    │      (所有 prompt 模板)        │
│  ✦ 模块 D（部分）:         │    │    • ingest-agent.ts          │
│    • page-writer.ts       │    │      (结构化提取逻辑)          │
│    • page-reader.ts       │    │                               │
│    • log-writer.ts        │    │  ✦ 模块 E: Freshness          │
│                           │    │    • decay.ts（衰减公式）      │
│  ✦ CLI:                   │    │    • calibration.ts            │
│    • fm crawl             │    │      (自校准逻辑)              │
│    • fm ingest（基础版）   │    │    • scanner.ts               │
│    • fm sources           │    │      (批量扫描)               │
│                           │    │                               │
│  ─ 产出 ─────────────     │    │  ✦ 模块 F: Search             │
│  能跑通：                  │    │    • tavily.ts                │
│  fm crawl → 抓到新内容     │    │                               │
│  → 内容写入 raw/ 目录      │    │  ✦ CLI:                       │
│  → state.json 去重生效     │    │    • fm freshcheck            │
│    （此时 ingest 先用      │    │    • fm query                 │
│     mock 的 LLM 结果）     │    │    • fm update                │
│                           │    │                               │
│                           │    │  ─ 产出 ─────────────         │
│                           │    │  能跑通：                      │
│                           │    │  手动放几个 wiki 页面进 vault   │
│                           │    │  → fm freshcheck 生成报告      │
│                           │    │  → fm query 能问答             │
│                           │    │  → fm update 能修订+校准       │
└───────────────────────────┘    └───────────────────────────────┘

                              │
                              │ Day 2 上午集成
                              ▼

┌────────────────────────────────────────────────────────────────┐
│                Day 2 上午（12-16h）: 集成联调                    │
│                                                                │
│  两人一起完成：                                                 │
│  • Person A 的 Crawler + Person B 的 IngestAgent 对接           │
│    → fm crawl 抓到内容后自动调用 LLM ingest                     │
│  • index-manager.ts（Person A 写基础版，Person B 补全状态显示）  │
│  • report-writer.ts（Person B 写，对接 Crawler 数据格式）        │
│  • linker.ts（Person A 写，基于 IngestResult 的 entities）      │
│  • 端到端测试：fm crawl → wiki 页面出现 → fm freshcheck → 报告  │
└────────────────────────────────────────────────────────────────┘

┌───────────────────────────┐    ┌───────────────────────────────┐
│   Person A: Demo 数据      │    │   Person B: 体验打磨           │
│                           │    │                               │
│  Day 2 下午（16-20h）      │    │  Day 2 下午（16-20h）          │
│                           │    │                               │
│  • 预填充 10-15 个 wiki    │    │  • ui.ts 终端输出美化          │
│    页面（真实过时数据）     │    │    (颜色、表格、spinner)       │
│  • 配好 Obsidian vault     │    │  • fm status 统计面板          │
│    双向链接 + 图谱展示      │    │  • 错误处理 + 用户提示优化     │
│  • 准备 3 个博客源的       │    │  • README.md 安装说明          │
│    真实 crawl 数据          │    │                               │
│                           │    │                               │
│  Day 2 晚上（20-24h）      │    │  Day 2 晚上（20-24h）          │
│                           │    │                               │
│  • Demo 排练              │    │  • Demo 排练                   │
│  • 准备讲稿               │    │  • 兜底方案（录屏备用）         │
└───────────────────────────┘    └───────────────────────────────┘
```

---

## 五、关键集成点 & 接口约定

### 集成点 1：Crawler → IngestAgent

Person A 的 `CrawlAgent.crawl()` 返回 `RawItem[]`，Person B 的 `IngestAgent.ingest()` 接收 `{ url, text }`。

```typescript
// crawl.ts 中的集成代码（Day 2 集成时写）
const { new_items } = await crawlAgent.crawl();
for (const item of new_items) {
  const result = await ingestAgent.ingest({ 
    text: item.content,
    url: item.url 
  });
  console.log(`✅ ${result.action} ${result.page_path}`);
}
```

**约定**：Day 1 结束前两人确认 `RawItem` 字段是否需要调整。

### 集成点 2：FreshnessEngine → FreshnessAgent

Person B 的 `FreshnessEngine.getCheckPriority()` 返回 `FreshnessEntry[]`，同样 Person B 的 `FreshnessAgent.check()` 消费这个列表。这个在 Person B 内部闭环，无跨人依赖。

### 集成点 3：PageWriter（Person A）↔ IngestAgent（Person B）

`IngestAgent` 调用 `PageWriter` 写入 wiki 页面。**Day 1 两人需要先对齐 `PageWriter` 的接口签名**。

**约定**：
```typescript
// Person A 提供的 PageWriter 接口
async createPage(
  dir: string,          // 如 "concepts", "entities", "models"
  slug: string,         // 如 "mcp-protocol"
  meta: WikiPageMeta,   // frontmatter 数据
  content: string       // markdown 正文
): Promise<string>;     // 返回完整文件路径
```

### 集成点 4：CalibrationEngine → fm update

`fm update --action ignore` 触发校准。Person B 负责 `CalibrationEngine`，Person A 只需在 `update.ts` 中调用。

---

## 六、Day 1 Mock 策略

为了让两人可以**独立开发、并行推进**，Day 1 各自用 mock 替代对方的模块：

| Person A 需要 mock | mock 方式 |
|-------------------|----------|
| LLM 调用（IngestAgent） | 返回硬编码的 `IngestResult` JSON |
| 衰减计算 | 直接在 frontmatter 里写死 `freshness_status` |

| Person B 需要 mock | mock 方式 |
|-------------------|----------|
| Crawler 抓取结果 | 手动准备 3-5 篇文章的 `RawItem[]` JSON 文件 |
| Wiki 页面读写 | 手动在 vault 里放几个带 frontmatter 的 .md 文件 |

**Day 2 上午集成时替换所有 mock 为真实调用。**

---

## 七、1 人独立开发方案

如果只有 1 人开发，按以下优先级串行推进：

### 最小可演示路径（Minimum Demo Path）

```
Phase 1（0-6h）: 基础设施
  → 项目初始化 + types + config + fm init
  → 模块 D: page-writer + page-reader（最核心的读写能力）
  → 模块 G: config + sources

Phase 2（6-12h）: Ingest 线（核心价值 1）
  → 模块 C: llm-client + ingest-agent + prompts
  → fm ingest <url> 端到端跑通
  → index-manager 自动更新

Phase 3（12-18h）: Freshness 线（核心价值 2）
  → 模块 E: decay + scanner
  → 模块 F: tavily search
  → 模块 C: freshness-agent
  → fm freshcheck 端到端跑通

Phase 4（18-22h）: Crawl + Query
  → 模块 B: rss + html + dedup
  → fm crawl 对接 ingest
  → 模块 C: query-agent + fm query

Phase 5（22-24h）: 收尾
  → calibration（自校准）
  → Demo 数据 + Obsidian 配置
  → 排练
```

**砍功能优先级**（时间不够时按顺序砍）：
1. 最后砍：fm ingest + fm freshcheck（核心差异化）
2. 其次砍：fm crawl（可以 demo 时手动 ingest 几篇代替）
3. 再砍：fm query（可以口头说"我们还支持查询"）
4. 先砍：半衰期自校准（可以说"未来会根据用户反馈自动调整"）

---

## 八、技术风险 & 兜底

| 风险 | 概率 | 影响 | 兜底方案 |
|------|------|------|---------|
| SiliconFlow API 不稳定/延迟高 | 中 | 阻塞所有 LLM 调用 | 准备 DeepSeek API 作为备选，llm-client.ts 抽象层支持切换 |
| RSS 源格式不统一/解析失败 | 高 | 部分源无法 crawl | MVP 只保证 5 个高质量源能 crawl，其余用 `fm ingest` 手动补 |
| Tavily 免费额度用完 | 低 | freshcheck 无法执行 | 单次 freshcheck 限制 10 条，demo 前预留额度 |
| Readability 提取正文质量差 | 中 | ingest 内容缺失 | 对提取结果做长度检查，过短则跳过并提示用户手动 ingest |
| 半衰期分类不准 | 中 | 保鲜检查时间不合理 | LLM prompt 给出明确分类规则 + 示例，降低歧义 |
| Demo 时 crawl 无新内容 | 中 | 演示效果差 | 预先准备 mock 数据，Demo 用预填充的真实过时内容 |

---

## 九、测试策略

### 单元测试（每个模块独立验证）

| 模块 | 测试重点 |
|------|---------|
| E: decay.ts | 衰减公式正确性（已知输入→已知输出）、边界值（t=0, t=∞） |
| E: calibration.ts | 校准系数是否正确应用、calibration.yaml 读写 |
| B: dedup.ts | 新 URL 通过、旧 URL 过滤、7 天清理 |
| B: rss.ts | 解析真实 RSS feed（准备 3 个 fixture） |
| D: page-writer.ts | frontmatter 格式正确、文件路径正确、更新时不丢数据 |

### 集成测试（端到端流程）

| 测试场景 | 预期结果 |
|---------|---------|
| `fm ingest <real_url>` | vault 中出现新 wiki 页面，index.md 更新 |
| `fm freshcheck`（有过时数据时） | 生成保鲜报告，至少 1 条 🔴 |
| `fm crawl`（有新内容时） | 发现新文章 → 自动 ingest → wiki 更新 |
| `fm update <page> --action ignore` | calibration.yaml 中对应类型半衰期 × 1.5 |

### Demo 验收清单

- [ ] `fm init` 创建完整目录结构 + 预置 sources.yaml
- [ ] `fm crawl` 至少成功抓取 3 个博客源
- [ ] `fm ingest <url>` 写入 wiki 页面，frontmatter 完整
- [ ] 连续 ingest 多篇能自动关联（[[wikilink]]）
- [ ] index.md 自动更新，显示保鲜状态
- [ ] `fm freshcheck` 生成保鲜报告，至少 1 条 🔴
- [ ] Obsidian 打开 vault 能看到双向链接和图谱
- [ ] `fm update --action update` 能自动修订页面
- [ ] `fm query "问题"` 能回答并标注保鲜状态
- [ ] 完整 demo flow 2 分钟内演示完毕
