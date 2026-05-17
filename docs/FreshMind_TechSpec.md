# FreshMind 技术方案
## v0.1 Hackathon MVP

---

## 一、系统总览

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户交互层                               │
│                                                                 │
│  ┌──────────────────────────┐    ┌────────────────────────────┐ │
│  │  CLI (终端命令)           │    │  Obsidian (知识浏览/编辑)   │ │
│  │                          │    │                            │ │
│  │  $ fm ingest <url>       │    │  📁 打开 wiki vault 目录    │ │
│  │  $ fm freshcheck         │    │  📄 浏览 wiki 页面          │ │
│  │  $ fm query "问题"       │    │  🔗 双向链接 + 图谱         │ │
│  │  $ fm update <page>      │    │  📊 查看保鲜报告            │ │
│  └────────────┬─────────────┘    └─────────────┬──────────────┘ │
│               │                                │               │
│               │ 调用                    读取 .md 文件            │
└───────────────┼────────────────────────────────┼───────────────┘
                │                                │
                ▼                                │
┌─────────────────────────────────────────────────────────────────┐
│                   Harness 层 (Node.js/TypeScript)                │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ IngestAgent  │  │ QueryAgent   │  │ FreshnessAgent        │ │
│  │              │  │              │  │                       │ │
│  │ 1.提取声明   │  │ 1.读index    │  │ 1.算衰减分数筛选      │ │
│  │ 2.分类标注   │  │ 2.定位页面   │  │ 2.提取可验证声明      │ │
│  │ 3.半衰期     │  │ 3.综合回答   │  │ 3.web search 验证    │ │
│  │ 4.写wiki页面 │  │ 4.标注保鲜   │  │ 4.LLM 判断新旧对比   │ │
│  │ 5.更新index  │  │              │  │ 5.写保鲜报告.md       │ │
│  └──────────────┘  └──────────────┘  └───────────────────────┘ │
└─────────┬────────────────┬──────────────────────┬──────────────┘
          │                │                      │
          ▼                ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                       外部服务层                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ Kimi K2.6    │  │ Tavily API   │  │ Obsidian Vault 目录   │ │
│  │ (SiliconFlow)│  │ (Web Search) │  │ (本地 Markdown 文件)  │ │
│  └──────────────┘  └──────────────┘  └───────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、新鲜度衰减模型

### 指数衰减公式

每条知识的新鲜度不是简单的"到期/没到期"二元状态，而是随时间连续衰减：

```
freshness_score = e^(-λ × t)

其中：
  λ = ln(2) / half_life_days    （衰减常数）
  t = today - last_verified      （距上次验证的天数）
  freshness_score ∈ [0, 1]       （1 = 完全新鲜，0 = 完全过时）
```

### 新鲜度分数 → 保鲜状态映射

| 分数范围 | 状态 | 含义 | 颜色 |
|---------|------|------|------|
| 0.75 - 1.0 | fresh | 信息可信 | 🟢 |
| 0.50 - 0.75 | stale | 建议验证 | 🟡 |
| 0.25 - 0.50 | outdated | 很可能过时 | 🟠 |
| 0.00 - 0.25 | expired | 几乎确定过时 | 🔴 |

### 计算示例

| 信息类型 | 半衰期 | 经过天数 | λ | 新鲜度分数 | 状态 |
|---------|--------|---------|---|-----------|------|
| benchmark_data | 45天 | 30天 | 0.0154 | 0.63 (63%) | 🟡 stale |
| benchmark_data | 45天 | 90天 | 0.0154 | 0.25 (25%) | 🟠 outdated |
| tech_concept | 540天 | 90天 | 0.0013 | 0.89 (89%) | 🟢 fresh |
| company_strategy | 180天 | 180天 | 0.0039 | 0.50 (50%) | 🟡 stale |
| model_capability | 60天 | 60天 | 0.0116 | 0.50 (50%) | 🟡 stale |

### TypeScript 实现

```typescript
function calculateFreshness(halfLifeDays: number, daysSinceVerified: number): number {
  const lambda = Math.LN2 / halfLifeDays;
  return Math.exp(-lambda * daysSinceVerified);
}

function getFreshnessStatus(score: number): 'fresh' | 'stale' | 'outdated' | 'expired' {
  if (score >= 0.75) return 'fresh';
  if (score >= 0.50) return 'stale';
  if (score >= 0.25) return 'outdated';
  return 'expired';
}

// Freshness Check 优先级排序：分数越低越优先检查
function getFreshnessCheckPriority(entries: WikiEntry[]): WikiEntry[] {
  return entries
    .map(e => ({
      ...e,
      freshness_score: calculateFreshness(
        e.half_life_days,
        daysBetween(e.last_verified, new Date())
      )
    }))
    .filter(e => e.freshness_score < 0.75) // 只检查非 fresh 的
    .sort((a, b) => a.freshness_score - b.freshness_score); // 最过时的排最前
}
```

### 半衰期自校准系统

默认半衰期是初始猜测值，系统根据用户反馈自动校准。

#### 校准规则

```typescript
interface CalibrationEvent {
  type: string;              // 信息类型 (benchmark_data, model_capability, ...)
  action: 'update' | 'archive' | 'ignore' | 'manual_edit' | 'confirmed_3x';
  page_path: string;
  timestamp: string;
}

function calibrate(currentHalfLife: number, event: CalibrationEvent): number {
  switch (event.action) {
    case 'update':        return currentHalfLife;          // 猜对了，不变
    case 'ignore':        return currentHalfLife * 1.5;    // 太短了，上调
    case 'manual_edit':   return currentHalfLife * 0.7;    // 太长了，下调
    case 'confirmed_3x':  return currentHalfLife * 1.3;    // 已证明稳定，延长
    default:              return currentHalfLife;
  }
}
```

#### 校准数据存储 `_meta/calibration.yaml`

```yaml
# 自动生成，请勿手动编辑
# 根据用户反馈校准的半衰期参数
last_updated: 2026-06-15

calibrated_half_life:
  benchmark_data: 38        # 默认 45，你的反馈显示这类信息过时更快
  model_capability: 52      # 默认 60
  product_update: 120       # 默认 120，未偏离
  tech_concept: 620         # 默认 540，你关注的概念变化更慢
  company_strategy: 150     # 默认 180，AI 行业变化比预期快
  industry_trend: 180       # 默认 180，未偏离
  person_move: 365          # 默认 365，未偏离

# 校准事件日志（最近 50 条）
calibration_log:
  - date: 2026-06-15
    type: benchmark_data
    action: ignore
    page: models/gpt-4o
    old_half_life: 42
    new_half_life: 63
    reason: "用户认为 GPT-4o benchmark 数据仍然有效"
  - date: 2026-06-10
    type: company_strategy
    action: manual_edit
    page: entities/xiaohongshu
    old_half_life: 165
    new_half_life: 115
    reason: "用户主动修改了页面内容"
```

#### 校准流程集成

```
fm update <page> --action ignore
    │
    ▼
┌─ 校准逻辑 ─────────────────────────────────────┐
│  1. 读取 _meta/calibration.yaml                 │
│  2. 获取该页面的 type（如 benchmark_data）       │
│  3. 当前 calibrated_half_life[type] × 1.5       │
│  4. 写回 calibration.yaml                       │
│  5. 追加 calibration_log                        │
│  6. 后续新建同类型页面自动使用校准后的半衰期      │
└────────────────────────────────────────────────┘

Obsidian 中用户直接编辑某个 wiki 页面并保存
    │
    ▼
┌─ 文件变更检测（fm watch 或下次 fm status 时）──┐
│  1. 检测到 .md 文件内容变化（非 frontmatter）   │
│  2. 判定为 manual_edit 事件                    │
│  3. 触发校准：该类型半衰期 × 0.7              │
│  4. 更新该页面的 last_verified = today          │
└────────────────────────────────────────────────┘
```

---

## 三、核心数据流

### Flow 0: Crawl（自动信息源监控）

```
触发（用户执行 `fm crawl` 或 GitHub Actions 定时任务）
    │
    ▼
┌─ Step 1: 加载信息源配置 ──────────────────────────┐
│  读取 sources.yaml，获取所有已启用的信息源          │
│  按类型分组：blogs / x_accounts / podcasts          │
│  MVP 只处理 blogs 类型                             │
└────────────────────────────────────────────────────┘
    │
    ▼
┌─ Step 2: 抓取新内容（复用 follow-builders 模式）──┐
│                                                    │
│  blogs/newsletters:                                │
│    对每个源尝试 RSS 解析 → 获取文章列表             │
│    如果无 RSS → 用 Cheerio 抓取 HTML 列表页         │
│    对每篇文章用 Readability 提取正文                 │
│    限制：每源最多 3 篇新文章，72h 回看窗口           │
│    延迟：500ms/篇（防止被封）                       │
│                                                    │
│  x_accounts (v0.2):                                │
│    批量查用户 ID（X API v2 /users/by）             │
│    逐用户拉最近 24h 推文（/users/{id}/tweets）      │
│    排除转发和回复，每人最多 3 条                     │
│    延迟：200ms/用户，遇 429 立即停止                │
│                                                    │
│  podcasts (v0.4):                                  │
│    RSS 获取最新剧集 → pod2txt 转录文字              │
│    14 天回看窗口                                   │
│                                                    │
│  输出：raw_items[] (每条含 source, title,           │
│         content, url, publishedAt)                 │
└────────────────────────────────────────────────────┘
    │
    ▼
┌─ Step 3: 去重 ────────────────────────────────────┐
│  读取 _meta/state.json                             │
│  对每条 raw_item 检查 URL/ID 是否已在 seenItems 中  │
│  过滤掉已见内容，只保留新内容                       │
│  将新内容的 URL/ID 写入 state.json                  │
│  自动清理 7 天前的旧记录                            │
│                                                    │
│  输出：new_items[]                                 │
└────────────────────────────────────────────────────┘
    │
    ▼
┌─ Step 4: 批量 Ingest ────────────────────────────┐
│  对每条 new_item 执行 Flow 1 (Ingest) 流程         │
│  LLM 结构化提取 → 写入 wiki 页面 → 更新 index.md   │
│  检测与已有 wiki 内容的矛盾 → 终端高亮提醒          │
│                                                    │
│  输出：终端打印摘要                                 │
│  ✅ Crawl 完成：抓取 28 源，发现 7 篇新内容         │
│     📄 新建 3 个 wiki 页面                         │
│     📝 更新 2 个已有页面                           │
│     ⚠️ 发现 1 处与已有知识矛盾                     │
│     ⏭️ 跳过 1 篇（内容过短/无事实性声明）           │
└────────────────────────────────────────────────────┘
```

### Flow 1: Ingest（摄入新知识）

```
用户输入 (URL 或文本)
    │
    ▼
┌─ Step 1: 内容获取 ─────────────────────────────────────┐
│  if URL → fetch 网页内容，提取正文（去除导航/广告）      │
│  if 文本 → 直接使用                                     │
│  输出：raw_content (string)                             │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌─ Step 2: LLM 结构化提取（单次 LLM API 调用）─────────┐
│                                                         │
│  System Prompt（发送至 SiliconFlow Kimi K2.6 Pro）：      │
│  你是一个 AI 行业知识管理专家。分析以下内容并提取：       │
│  1. title: 标题                                         │
│  2. summary: 一句话摘要                                 │
│  3. type: 信息类型（从以下选择）                         │
│     - model_capability (模型能力，半衰期 60 天)          │
│     - company_strategy (公司战略，半衰期 180 天)         │
│     - product_update (产品更新，半衰期 120 天)           │
│     - tech_concept (技术概念，半衰期 540 天)             │
│     - industry_trend (行业趋势，半衰期 180 天)           │
│     - person_move (人事变动，半衰期 365 天)              │
│     - benchmark_data (评测数据，半衰期 45 天)            │
│  4. verifiable_claims: 可验证的事实性声明列表             │
│     每条包含：                                          │
│     - claim: 声明内容                                   │
│     - search_query: 用于未来验证的搜索关键词             │
│     - confidence: 当前置信度 0-1                        │
│  5. entities: 提及的实体（公司、人物、产品）              │
│  6. related_concepts: 涉及的概念关键词                   │
│  7. source_date: 内容的发布日期（尽可能提取）            │
│                                                         │
│  排除以下内容，不要标注为 verifiable_claims：             │
│  - 观点和主观判断                                       │
│  - 通用技术概念解释                                     │
│  - 修辞和比喻                                           │
│                                                         │
│  输出格式：JSON                                         │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌─ Step 3: Wiki 写入 ──────────────────────────────────────┐
│  3a. 读取 _meta/calibration.yaml，获取校准后的半衰期      │
│      （如 benchmark_data 校准为 38 天而非默认 45 天）      │
│  3b. 读取 index.md，检查是否有相关已存在页面              │
│  3c. 如果有相关页面 → 更新已有页面（追加新信息+声明）     │
│      如果没有 → 创建新 wiki 页面（带 frontmatter）       │
│      页面的 half_life_days 使用校准值                     │
│  3d. 更新 index.md（添加/更新条目）                      │
│  3e. 把原始内容存入 raw/ 目录（不可变）                  │
│  3f. 追加 log.md                                        │
└────────────────────────────────────────────────────────┘
```

### Flow 2: Freshness Check（保鲜检查）

```
触发（用户执行 `fm freshcheck` 命令）
    │
    ▼
┌─ Step 1: 筛选到期条目 ─────────────────────────────────┐
│  扫描所有 wiki 页面的 frontmatter                       │
│  筛选条件（基于指数衰减公式）：                          │
│    freshness_score = e^(-λ × t)                        │
│    其中 λ = ln(2)/half_life_days, t = 距上次验证天数     │
│    筛选 freshness_score < 0.75 的条目                   │
│  按优先级排序：                                         │
│    freshness_score 越低 → 越可能过时 → 优先检查          │
│  MVP 限制：每次最多检查 10 条（控制 API 成本）           │
│                                                         │
│  输出：expired_entries[]                                │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌─ Step 2: 逐条验证（并行处理）──────────────────────────┐
│  对每条 expired_entry:                                  │
│                                                         │
│  2a. 从页面提取 verifiable_claims                       │
│  2b. 对每条 claim 的 search_query 执行 web search       │
│      （Tavily API 或类似服务，每条 1 次搜索）            │
│  2c. 把 claim + search_results 交给 LLM 判断         │
│                                                         │
│  Verification Prompt:                                   │
│  ────────────────────────────────────                   │
│  你是一个事实核查专家。对比以下信息：                     │
│                                                         │
│  【原始声明】（记录于 {date}）                           │
│  {claim}                                                │
│                                                         │
│  【最新搜索结果】                                       │
│  {search_results}                                       │
│                                                         │
│  判断这条声明的当前状态：                                │
│  1. "confirmed" - 搜索结果确认声明仍然成立               │
│  2. "updated" - 有新发展但不完全推翻（需要补充）          │
│  3. "contradicted" - 有明确证据表明声明已过时             │
│  4. "uncertain" - 搜索结果不足以判断                     │
│                                                         │
│  返回 JSON：                                            │
│  {                                                      │
│    "status": "confirmed|updated|contradicted|uncertain", │
│    "evidence": "判断依据的一句话总结",                   │
│    "new_info": "如果有更新，新的正确信息是什么",          │
│    "source_url": "最相关的来源 URL"                     │
│  }                                                      │
│  ────────────────────────────────────                   │
│                                                         │
│  输出：verification_results[]                           │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌─ Step 3: 生成保鲜报告 ─────────────────────────────────┐
│  聚合所有 verification_results                          │
│  按状态分组：                                           │
│    🔴 contradicted → "已过时"                           │
│    🟡 updated → "需关注"                                │
│    🟢 confirmed → "仍然有效"                            │
│    ⚪ uncertain → "无法确认"                             │
│                                                         │
│  输出：freshness-report-latest.md（写入 vault）          │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌─ Step 4: 用户决策 + Wiki 更新 ─────────────────────────┐
│  用户在 Obsidian 中查看保鲜报告，然后通过 CLI 操作：     │
│                                                         │
│  对 🔴 contradicted 条目：                               │
│    $ fm update <page> --action update                   │
│      → Agent 自动修订 wiki 页面                          │
│      → 更新 frontmatter 的 last_verified                │
│      → 修改或追加内容 + 标注修订历史                      │
│    $ fm update <page> --action archive                  │
│      → freshness_status = "archived"                    │
│    $ fm update <page> --action ignore                   │
│      → 延长 half_life_days，重置 last_verified           │
│                                                         │
│  对 🟡 updated 条目：                                   │
│    $ fm update <page> --action supplement               │
│      → Agent 在现有页面追加新信息                        │
└────────────────────────────────────────────────────────┘
```

### Flow 3: Query（知识查询）

```
用户提问（自然语言）
    │
    ▼
┌─ Step 1: 读取 index.md ───────────────────────────────┐
│  把 index.md 全文 + 用户问题交给 Kimi K2.6              │
│  让 LLM 判断需要读取哪些 wiki 页面                   │
│  输出：relevant_pages[]（文件路径列表）                 │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌─ Step 2: 读取相关页面 ────────────────────────────────┐
│  读取所有 relevant_pages 的完整内容                     │
│  包括 frontmatter（特别是 freshness_status）            │
└────────────────────────────────────────────────────────┘
    │
    ▼
┌─ Step 3: 综合回答 ────────────────────────────────────┐
│  Query Prompt:                                         │
│  ────────────────────────────────────                  │
│  基于以下 wiki 页面回答用户的问题。                      │
│  注意：                                                │
│  - 如果引用的信息 freshness_status 不是 "fresh"，       │
│    请在回答中标注 ⚠️ 并说明该信息可能已过时             │
│  - 标明信息的记录时间                                   │
│  - 如果 wiki 中没有足够信息，说明缺口                   │
│                                                        │
│  {wiki_pages_content}                                  │
│                                                        │
│  用户问题：{question}                                   │
│  ────────────────────────────────────                  │
│                                                        │
│  输出：answer（带保鲜状态标注的回答）                    │
└────────────────────────────────────────────────────────┘
```

---

## 四、Wiki 文件结构

```
freshmind-wiki/                  # = Obsidian Vault 目录
├── .freshmind.yaml              # CLI 配置（API keys、vault 路径）
├── sources.yaml                 # 信息源配置（107 个预置源）
├── index.md                     # 全局目录（按类别+保鲜状态组织）
├── log.md                       # 操作日志（append-only）
├── freshness-report-latest.md   # 最新一次保鲜报告
│
├── _meta/                       # 系统元数据（自进化 + 去重）
│   ├── calibration.yaml         # 半衰期自校准参数 + 事件日志
│   ├── state.json               # crawl 去重状态（已见 URL/ID → 时间戳）
│   └── stats.yaml               # 使用统计（crawl/ingest/check 次数等）
│
├── raw/                         # 原始素材（不可变）
│   ├── 2026-05-17-claude-opus-4-7.md
│   ├── 2026-05-10-a16z-notes-2026.md
│   └── ...
│
├── entities/                    # 实体页面
│   ├── anthropic.md
│   ├── openai.md
│   ├── xiaohongshu.md
│   └── ...
│
├── concepts/                    # 概念页面
│   ├── mcp-protocol.md
│   ├── vibe-coding.md
│   ├── context-engineering.md
│   └── ...
│
├── models/                      # 模型页面（高频更新）
│   ├── claude-opus-4-6.md
│   ├── gpt-5.md
│   └── ...
│
├── comparisons/                 # 对比页面
│   ├── claude-vs-gpt.md
│   ├── cursor-vs-windsurf.md
│   └── ...
│
└── trends/                      # 趋势页面
    ├── agent-friendly-products.md
    ├── ai-pm-role-evolution.md
    └── ...
```

### Wiki 页面示例

```markdown
---
title: "MCP (Model Context Protocol)"
type: tech_concept
created: 2026-03-15
last_verified: 2026-05-01
half_life_days: 540
freshness_status: fresh
confidence: 0.9
sources:
  - url: "https://www.anthropic.com/engineering/writing-tools-for-agents"
    date: 2025-10-01
  - url: "https://a16z.com/newsletter/big-ideas-2026-part-1/"
    date: 2025-12-09
related:
  - "[[entities/anthropic]]"
  - "[[concepts/agent-friendly-products]]"
  - "[[concepts/context-engineering]]"
tags: [协议, Anthropic, agent, 工具集成]
verifiable_claims:
  - claim: "MCP 由 Anthropic 于 2024 年 11 月开源"
    search_query: "MCP Model Context Protocol Anthropic release date"
    confidence: 0.95
    last_checked: 2026-05-01
    status: confirmed
  - claim: "Google、OpenAI、Microsoft 均已支持 MCP"
    search_query: "Google OpenAI Microsoft MCP support 2026"
    confidence: 0.85
    last_checked: 2026-05-01
    status: confirmed
  - claim: "MCP 已捐赠给 Linux Foundation"
    search_query: "MCP Linux Foundation donation"
    confidence: 0.9
    last_checked: 2026-05-01
    status: confirmed
---

# MCP (Model Context Protocol)

## 概述
MCP 是 Anthropic 开发的开放协议...

## 核心架构
...

## 生态现状
...

## 与 FreshMind 的关联
MCP 是实现 agent-friendly 产品的关键基础设施...
```

### index.md 示例

```markdown
# FreshMind Wiki Index

> 最后更新: 2026-05-17 | 总页面: 23 | 🔴 过时: 2 | 🟡 待确认: 3 | 🟢 有效: 18

## 按类别

### 实体 (Entities)
| 页面 | 类型 | 保鲜状态 | 上次验证 |
|------|------|---------|---------|
| [[entities/anthropic]] | company_strategy | 🟢 | 2026-05-10 |
| [[entities/openai]] | company_strategy | 🟡 | 2026-04-01 |
| [[entities/xiaohongshu]] | company_strategy | 🔴 | 2026-02-15 |

### 概念 (Concepts)
| 页面 | 类型 | 保鲜状态 | 上次验证 |
|------|------|---------|---------|
| [[concepts/mcp-protocol]] | tech_concept | 🟢 | 2026-05-01 |
| [[concepts/vibe-coding]] | industry_trend | 🟢 | 2026-04-20 |

### 模型 (Models)
| 页面 | 类型 | 保鲜状态 | 上次验证 |
|------|------|---------|---------|
| [[models/claude-opus-4-6]] | model_capability | 🟢 | 2026-05-15 |
| [[models/gpt-4o]] | model_capability | 🔴 | 2026-01-20 |

## 按保鲜状态

### 🔴 已过时 (2)
- [[entities/xiaohongshu]] - 上次验证 2026-02-15 (92天前)
- [[models/gpt-4o]] - 上次验证 2026-01-20 (118天前)

### 🟡 需关注 (3)
- [[entities/openai]] - 上次验证 2026-04-01 (47天前)
- ...
```

---

## 五、技术选型

| 组件 | 选型 | 理由 | 备选 |
|------|------|------|------|
| **CLI 框架** | Commander.js + Ora (spinner) | 轻量、成熟、零配置 | yargs, inquirer |
| **LLM** | Kimi K2.6 Pro (via SiliconFlow) | 中文能力强，性价比高，OpenAI 兼容接口 | DeepSeek-V3 |
| **Web Search** | Tavily API | 专为 AI agent 设计，返回结构化结果，免费额度够 MVP | Brave Search API |
| **Wiki 存储** | Obsidian Vault (本地 Markdown) | 与 Karpathy 模式一致，Obsidian 原生兼容，无需数据库 | 纯文件系统 |
| **文件操作** | Node.js fs + gray-matter | 读写 markdown + 解析 frontmatter | - |
| **URL 内容提取** | Cheerio / Mozilla Readability | 从 URL 提取正文 | Firecrawl |
| **分发** | npm 全局安装 (`npm i -g freshmind`) | 一条命令安装，任意终端可用 | npx |

---

## 六、CLI 命令设计

```bash
# ─── 信息源监控（核心新功能）────────────────────────────
$ fm crawl [--type blogs|x|podcasts]
# 抓取所有已启用信息源的新内容 → 去重 → 自动 ingest
# 输出摘要：新内容数、新建页面数、矛盾数

$ fm sources list                    # 查看所有信息源
$ fm sources add --url <rss_url> --category tech_progress
$ fm sources remove <source_id>
$ fm sources enable/disable <source_id>

# ─── 初始化 ───────────────────────────────────────────────
$ fm init [--vault <path>]
# 初始化 FreshMind，指定 Obsidian vault 目录
# 创建 schema.md, index.md, log.md 和子目录结构
# 生成 .freshmind.yaml 配置文件（存放 API keys 和 vault 路径）

# ─── 摄入新知识 ───────────────────────────────────────────
$ fm ingest <url>
$ fm ingest --text "粘贴的文本内容"
$ fm ingest --file ./article.md
# 提取 → 结构化 → 写入 wiki 页面 → 更新 index.md → 追加 log.md
# 输出：✅ 已写入 concepts/mcp-protocol.md (3 条声明, 半衰期 540 天)

# ─── 保鲜检查 ─────────────────────────────────────────────
$ fm freshcheck [--max 10] [--type model_capability]
# 扫描 vault → 计算衰减分数 → 筛选 < 0.75 → web search → LLM 验证
# 输出：终端打印摘要 + 写入 freshness-report-latest.md
# 用户在 Obsidian 中打开报告查看详情

# ─── 知识查询 ─────────────────────────────────────────────
$ fm query "AI coding tools 的竞争格局是什么？"
# 读 index → 定位页面 → LLM 综合回答（带保鲜标注）
# 输出直接打印到终端

# ─── 用户决策更新 ─────────────────────────────────────────
$ fm update <page_path> --action update      # Agent 自动修订
$ fm update <page_path> --action archive     # 标记为历史
$ fm update <page_path> --action ignore      # 延长半衰期

# ─── 查看状态 ─────────────────────────────────────────────
$ fm status
# 输出 wiki 统计：总页面数、🟢/🟡/🟠/🔴 各多少、最近操作
```

### 信息源配置 `sources.yaml`

```yaml
# 预置 107 个信息源（去重后），用户可增删
# 完整源清单详见 sources_dedup.md

# ═══════════════════════════════════════════════════
# 博客 / Newsletter / Substack（28个）— MVP v0.1 启用
# ═══════════════════════════════════════════════════

blogs:
  # 技术进步
  - id: anthropic-engineering
    name: Anthropic Engineering
    url: https://www.anthropic.com/engineering
    rss: null
    category: tech_progress
    enabled: true
  - id: claude-tutorials
    name: Claude Tutorials
    url: https://claude.com/resources/tutorials
    rss: null
    category: practical
    enabled: true
  - id: claude-use-cases
    name: Claude Use Cases
    url: https://claude.com/resources/use-cases
    rss: null
    category: practical
    enabled: true
  - id: ai-valley
    name: The AI Valley
    url: https://www.theaivalley.com
    rss: null
    category: tech_progress
    enabled: true
  - id: every-to
    name: Every.to
    url: https://every.to/newsletter
    rss: https://every.to/feed
    category: tech_progress
    enabled: true
  - id: latent-space
    name: Latent Space
    url: https://www.latent.space
    rss: https://www.latent.space/feed
    category: tech_progress
    enabled: true
  # 实操应用
  - id: one-useful-thing
    name: One Useful Thing (Ethan Mollick)
    url: https://www.oneusefulthing.org
    rss: https://www.oneusefulthing.org/feed
    category: practical
    enabled: true
  - id: simon-willison
    name: Simon Willison
    url: https://simonwillison.net
    rss: https://simonwillison.net/atom/everything/
    category: practical
    enabled: true
  - id: creator-economy
    name: Creator Economy
    url: https://creatoreconomy.so
    rss: https://creatoreconomy.so/feed
    category: practical
    enabled: true
  # 产品经理
  - id: lenny-newsletter
    name: "Lenny's Newsletter"
    url: https://www.lennysnewsletter.com
    rss: https://www.lennysnewsletter.com/feed
    category: product_management
    enabled: true
  - id: aakash-ai-pm
    name: Aakash Gupta (AI PM)
    url: https://www.news.aakashg.com/t/ai-pm
    rss: https://www.news.aakashg.com/feed
    category: product_management
    enabled: true
  - id: aakash-pm-job
    name: Aakash Gupta (PM Job)
    url: https://www.news.aakashg.com/t/getting-pm-job
    rss: https://www.news.aakashg.com/feed
    category: product_management
    enabled: true
  # 创业投资
  - id: a16z-news
    name: a16z News
    url: https://www.a16z.news
    rss: https://www.a16z.news/feed
    category: entrepreneurship
    enabled: true
  - id: levels-io
    name: Levels.io Blog
    url: https://levels.io/blog/
    rss: https://levels.io/feed/
    category: indie_dev
    enabled: true
  # 技术反思
  - id: gary-marcus
    name: Gary Marcus
    url: https://garymarcus.substack.com
    rss: https://garymarcus.substack.com/feed
    category: tech_critique
    enabled: true
  - id: normaltech
    name: NormalTech
    url: https://www.normaltech.ai
    rss: null
    category: tech_critique
    enabled: true
  - id: jasmi-news
    name: Jasmine Sun
    url: https://jasmi.news
    rss: null
    category: tech_critique
    enabled: true
  - id: reboot
    name: Reboot
    url: https://joinreboot.org
    rss: null
    category: tech_critique
    enabled: true
  # 宏观分析
  - id: ben-evans
    name: Ben Evans Newsletter
    url: https://www.ben-evans.com/newsletter
    rss: https://www.ben-evans.com/feed
    category: macro_analysis
    enabled: true
  # 访谈 / 哲学
  - id: lex-fridman-substack
    name: Lex Fridman (Substack)
    url: https://substack.com/@lexfridman
    rss: null
    category: interview
    enabled: true
  - id: naval-archive
    name: Naval's Archive
    url: https://substack.com/@navalsarchive
    rss: null
    category: philosophy
    enabled: true
  # 学术 / 研究机构（6个）
  - id: stanford-hai-publications
    name: Stanford HAI Publications
    url: https://hai.stanford.edu/research/publications
    rss: null
    category: academic
    enabled: true
  - id: stanford-hai-news
    name: Stanford HAI News
    url: https://hai.stanford.edu/news
    rss: null
    category: academic
    enabled: true
  - id: stanford-hai-policy
    name: Stanford HAI Policy
    url: https://hai.stanford.edu/policy/publications
    rss: null
    category: ai_policy
    enabled: true
  - id: stanford-ai-blog
    name: Stanford AI Blog
    url: https://ai.stanford.edu/blog/
    rss: null
    category: academic
    enabled: true
  - id: ai-now
    name: AI Now Institute
    url: https://ainowinstitute.org/publications
    rss: null
    category: ai_ethics
    enabled: true
  - id: cosmos-institute
    name: Cosmos Institute Blog
    url: https://blog.cosmos-institute.org
    rss: null
    category: tech_critique
    enabled: true
  # RSS Feed
  - id: acquired-rss
    name: Acquired Podcast (RSS)
    url: https://www.acquired.fm
    rss: https://feeds.acquired.fm/acquired
    category: business_strategy
    enabled: true

# ═══════════════════════════════════════════════════
# X/Twitter 账号（39个）— v0.2 启用，需要 X_BEARER_TOKEN
# ═══════════════════════════════════════════════════

x_accounts:
  # 技术进步（16个）
  - { handle: sama, name: Sam Altman, category: tech_progress, enabled: false }
  - { handle: DarioAmodei, name: Dario Amodei, category: tech_progress, enabled: false }
  - { handle: karpathy, name: Andrej Karpathy, category: tech_progress, enabled: false }
  - { handle: ylecun, name: Yann LeCun, category: tech_progress, enabled: false }
  - { handle: AnthropicAI, name: Anthropic, category: tech_progress, enabled: false }
  - { handle: ClaudeAI, name: Claude, category: tech_progress, enabled: false }
  - { handle: GoogleLabs, name: Google Labs, category: tech_progress, enabled: false }
  - { handle: alexandr_wang, name: Alexandr Wang, category: tech_progress, enabled: false }
  - { handle: hardmaru, name: David Ha, category: tech_progress, enabled: false }
  - { handle: DrJimFan, name: Jim Fan, category: tech_progress, enabled: false }
  - { handle: omarsar0, name: Elvis (DAIR.AI), category: tech_progress, enabled: false }
  - { handle: TheAhmadOsman, name: Ahmad Osman, category: tech_progress, enabled: false }
  - { handle: felixrieseberg, name: Felix Rieseberg, category: tech_progress, enabled: false }
  - { handle: AndrewYNg, name: Andrew Ng, category: tech_progress, enabled: false }
  - { handle: StanfordAILab, name: Stanford AI Lab, category: tech_progress, enabled: false }
  - { handle: apolloaievals, name: Apollo Research, category: tech_progress, enabled: false }
  # 应用实战（15个）
  - { handle: amasad, name: Amjad Masad, category: practical, enabled: false }
  - { handle: edwinarbus, name: Edwin (Cursor), category: practical, enabled: false }
  - { handle: levelsio, name: Pieter Levels, category: practical, enabled: false }
  - { handle: petergyang, name: Peter Yang, category: practical, enabled: false }
  - { handle: emollick, name: Ethan Mollick, category: practical, enabled: false }
  - { handle: simpsoka, name: Kate Sim, category: practical, enabled: false }
  - { handle: mckaywrigley, name: Mckay Wrigley, category: practical, enabled: false }
  - { handle: heykahn, name: Sahil Bloom, category: practical, enabled: false }
  - { handle: superhuman_ai, name: Superhuman AI, category: practical, enabled: false }
  - { handle: dannypostma, name: Danny Postma, category: practical, enabled: false }
  - { handle: nikitabier, name: Nikita Bier, category: practical, enabled: false }
  - { handle: zarazhangrui, name: Zara Zhang, category: practical, enabled: false }
  - { handle: AlexFinn, name: Alex Finn, category: practical, enabled: false }
  - { handle: im_roy_lee, name: Roy Lee, category: practical, enabled: false }
  - { handle: dhruvamin, name: Dhruv Amin, category: practical, enabled: false }
  # 更多应用实战
  - { handle: SaloniRakheja, name: Saloni Rakheja, category: practical, enabled: false }
  - { handle: ashebytes, name: Ashe, category: practical, enabled: false }
  - { handle: gregisenberg, name: Greg Isenberg, category: entrepreneurship, enabled: false }
  - { handle: itsandrewgao, name: Andrew Gao, category: practical, enabled: false }
  - { handle: CodeNewsletter, name: Code Newsletter, category: practical, enabled: false }
  - { handle: covacut, name: Covacut, category: design, enabled: false }
  - { handle: 0xDesigner, name: 0xDesigner, category: design, enabled: false }
  - { handle: steipete, name: Peter Steinberger, category: practical, enabled: false }
  # 创业投资（15个）
  - { handle: garrytan, name: Garry Tan, category: entrepreneurship, enabled: false }
  - { handle: eladgil, name: Elad Gil, category: entrepreneurship, enabled: false }
  - { handle: natfriedman, name: Nat Friedman, category: entrepreneurship, enabled: false }
  - { handle: lennysan, name: Lenny Rachitsky, category: product_management, enabled: false }
  - { handle: venturetwins, name: a16z Consumer, category: entrepreneurship, enabled: false }
  - { handle: gilbert, name: Gilbert (Acquired), category: entrepreneurship, enabled: false }
  - { handle: levie, name: Aaron Levie, category: entrepreneurship, enabled: false }
  - { handle: tobi, name: Tobi Lutke, category: entrepreneurship, enabled: false }
  - { handle: saranormous, name: Sarah Guo, category: entrepreneurship, enabled: false }
  - { handle: jaminball, name: Jamin Ball, category: entrepreneurship, enabled: false }
  - { handle: GavinSBaker, name: Gavin Baker, category: entrepreneurship, enabled: false }
  - { handle: IFP, name: Inst for Progress, category: entrepreneurship, enabled: false }
  - { handle: notablecap, name: Notable Capital, category: entrepreneurship, enabled: false }
  - { handle: scottbelsky, name: Scott Belsky, category: entrepreneurship, enabled: false }
  - { handle: Liangstays, name: Brent Liang, category: entrepreneurship, enabled: false }
  # 技术反思 / 伦理（7个）
  - { handle: JohnathanBi, name: Johnathan Bi, category: tech_critique, enabled: false }
  - { handle: GaryMarcus, name: Gary Marcus, category: tech_critique, enabled: false }
  - { handle: benedictevans, name: Benedict Evans, category: macro_analysis, enabled: false }
  - { handle: random_walker, name: Arvind Narayanan, category: ai_ethics, enabled: false }
  - { handle: jasminewsun, name: Jasmine Sun, category: tech_critique, enabled: false }
  - { handle: mtlaiethics, name: Montreal AI Ethics, category: ai_ethics, enabled: false }
  - { handle: berylpong, name: Beryl Pong, category: tech_critique, enabled: false }

# ═══════════════════════════════════════════════════
# 播客 / YouTube（18个）— v0.4 启用，需要 ASR 转录
# ═══════════════════════════════════════════════════

podcasts:
  # 小宇宙播客（10个）
  - { id: shizi-lukou, name: 十字路口, platform: xiaoyuzhou, category: general, enabled: false }
  - { id: 42-zhangjing, name: 42章经, platform: xiaoyuzhou, category: entrepreneurship, enabled: false }
  - { id: why-not-tv, name: Why Not TV, platform: xiaoyuzhou, category: general, enabled: false }
  - { id: zhangxiaojun, name: 张小jun访谈录, platform: xiaoyuzhou, category: interview, enabled: false }
  - { id: luanfanshu, name: 乱翻书, platform: xiaoyuzhou, category: tech, enabled: false }
  - { id: keji-luandun, name: 科技乱炖, platform: xiaoyuzhou, category: tech, enabled: false }
  - { id: guigu-101, name: 硅谷101, platform: xiaoyuzhou, category: tech, enabled: false }
  - { id: houxue-changbo, name: 厚雪长波, platform: xiaoyuzhou, category: investment, enabled: false }
  - { id: zhixing-xiaojiuguan, name: 知行小酒馆, platform: xiaoyuzhou, category: investment, enabled: false }
  - { id: ai-lianjinshu, name: AI炼金术, platform: xiaoyuzhou, category: ai, enabled: false }
  # YouTube 频道（8个）
  - { id: lex-fridman-yt, name: Lex Fridman, platform: youtube, url: "https://www.youtube.com/@lexfridman", category: interview, enabled: false }
  - { id: no-priors, name: No Priors, platform: youtube, category: vc_ai, enabled: false }
  - { id: ai-and-i, name: AI & I, platform: youtube, category: ai, enabled: false }
  - { id: all-in, name: All-In Podcast, platform: youtube, category: tech_business, enabled: false }
  - { id: anthropic-yt, name: Anthropic, platform: youtube, url: "https://www.youtube.com/@anthropic-ai", category: tech, enabled: false }
  - { id: lenny-podcast-yt, name: "Lenny's Podcast", platform: youtube, category: product, enabled: false }
  - { id: latentspace-yt, name: LatentSpace, platform: youtube, category: tech, enabled: false }
  - { id: ai-explained, name: AI Explained, platform: youtube, category: tech, enabled: false }
```

### 去重状态 `_meta/state.json`

```json
{
  "seenItems": {
    "https://www.anthropic.com/engineering/some-article": 1716000000000,
    "https://a16z.news/some-post": 1716100000000,
    "tweet:1234567890": 1716200000000
  },
  "lastCrawl": "2026-05-17T06:17:00Z",
  "stats": {
    "totalCrawls": 15,
    "totalIngested": 47,
    "totalSkipped": 12
  }
}
```

> 自动清理 7 天前的记录，防止文件无限增长（复用 follow-builders 的 state pruning 模式）。

### 配置文件 `.freshmind.yaml`

```yaml
vault_path: ~/obsidian-vault/FreshMind    # Obsidian vault 目录
llm:
  provider: siliconflow
  model: moonshotai/Kimi-K2.6
  api_key: ${SILICONFLOW_API_KEY}         # 从环境变量读取
  base_url: https://api.siliconflow.cn/v1
search:
  provider: tavily
  api_key: ${TAVILY_API_KEY}
freshcheck:
  max_items: 10                           # 每次最多检查条数
  threshold: 0.75                         # 新鲜度阈值
```

---

## 七、LLM 调用成本估算（SiliconFlow Kimi K2.6 Pro）

> 注：SiliconFlow 上 Kimi K2.6 Pro 的定价远低于闭源头部模型，以下为估算。
> 具体价格请参考 SiliconFlow 官网实时定价页面。

### 每次 Ingest
- 1 次 Kimi K2.6 调用（结构化提取）：~2K input + ~1K output ≈ ¥0.03
- 总计：**≈ ¥0.03/篇**

### 每次 Freshness Check（10 条）
- 10 次 Tavily 搜索：免费额度内（1000次/月）
- 10 次 Kimi K2.6 调用（验证判断）：~1K input + ~0.3K output × 10 ≈ ¥0.15
- 1 次报告生成：≈ ¥0.03
- 总计：**≈ ¥0.18/次保鲜检查**

### 每次 Query
- 1 次 Kimi K2.6（读 index 定位页面）：≈ ¥0.01
- 1 次 Kimi K2.6（综合回答）：≈ ¥0.05
- 总计：**≈ ¥0.06/次查询**

### 月度估算（日常使用）
- 每天 ingest 3 篇：¥0.03 × 3 × 30 = ¥2.70
- 每天 1 次保鲜检查：¥0.18 × 30 = ¥5.40
- 每天 5 次查询：¥0.06 × 5 × 30 = ¥9.00
- **月度总计：≈ ¥17.10**（极其可承受）

---

## 八、MVP 开发计划（48 小时黑客松）

### Day 1（前 24 小时）

| 时间 | 任务 | 产出 |
|------|------|------|
| 0-2h | 项目初始化 | Node.js CLI 项目 + wiki 目录 + .freshmind.yaml + sources.yaml |
| 2-4h | `fm crawl` (博客/RSS) | RSS 解析 + HTML 抓取 + 去重状态管理（复用 follow-builders） |
| 4-8h | `fm ingest` | LLM 结构化提取 → 写 wiki 页面 → crawl 自动调用 ingest |
| 8-10h | Index 系统 | 自动维护 index.md + `fm status` + `fm sources` |
| 10-12h | `fm freshcheck` | 衰减分数计算 + Tavily 搜索 + LLM 验证 + 写保鲜报告.md |

### Day 2（后 24 小时）

| 时间 | 任务 | 产出 |
|------|------|------|
| 12-14h | `fm query` | 知识查询 + 保鲜状态标注 |
| 14-16h | `fm update` + 自校准 | 用户决策更新 + calibration.yaml 自动调整 |
| 16-18h | 联调测试 | 用 3-5 篇真实过时文章测试完整流程（含校准验证）|
| 18-20h | Demo 数据 | 预填充 10-15 个 wiki 页面（含 2-3 个已过时的） |
| 20-22h | Obsidian 配置 | 打开 vault、验证双向链接和图谱显示效果 |
| 22-24h | Demo 排练 | 2 分钟演示流程打磨（终端 + Obsidian 双屏） |

### 预填充的 Demo 数据建议

用你自己飞书笔记里真实过时的内容：

| 旧笔记内容 | 为什么过时 | Demo 效果 |
|-----------|-----------|---------|
| "DeepSeek V3 是最强开源模型" | 后续有更新版本 | 🔴 经典保鲜发现 |
| "Claude 3.5 Sonnet 是编程最强" | Opus 4.6 已发布 | 🔴 直观对比 |
| "Karpathy 在做 Eureka Labs" | 重心转向 LLM Wiki | 🟡 关注更新 |
| "MCP 由 Anthropic 维护" | 已捐赠给 Linux Foundation | 🟡 细微变化 |
| "Transformer 是主流架构" | 依然成立 | 🟢 确认有效 |

---

## 九、信息源覆盖路线图

基于用户提供的 107 个去重后信息源（详见 `sources_dedup.md`），按技术难度分阶段覆盖：

| 阶段 | 版本 | 类型 | 数量 | 技术方案 | 外部依赖 |
|------|------|------|------|---------|---------|
| **MVP** | v0.1 | 博客/Newsletter/Substack | 28 个 | RSS 解析 + HTML 抓取（复用 follow-builders） | 无 |
| **Phase 2** | v0.2 | X/Twitter 账号 | 39 个 | X API v2 + Bearer Token（复用 follow-builders） | X_BEARER_TOKEN |
| **Phase 3** | v0.3 | 学术机构博客 | 6 个 | 网页抓取 | 无 |
| **Phase 4** | v0.4 | YouTube 频道 | 8 个 | YouTube 字幕 API / Whisper | pod2txt 或 Whisper |
| **Phase 5** | v0.4 | 小宇宙播客 | 10 个 | RSS + ASR 转录 | pod2txt / Whisper |
| **Phase 6** | v0.5 | RSS Feed (Acquired 等) | 1 个 | RSS 解析 | 无 |
| | | **总计** | **92 个** | | |

> 剩余 15 个源（部分 X 账号信息量低）可按需手动 `fm ingest` 补充。

**最终形态**：FreshMind 每日自动监控 92+ 信息源，发现新内容时自动 ingest 进 wiki 并检测与已有知识的矛盾。从"你找信息"到"信息找你"。
