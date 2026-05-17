# FreshMind PRD
## AI PM 的知识保鲜系统——基于 Karpathy LLM Wiki 模式的自动化认知管理工具

> 版本：v0.1 (Hackathon MVP)
> 日期：2026-05-17

---

## 一、产品定义

### 一句话描述

一个给 AI PM 用的知识库，**自动监控你指定的 100+ 信息源**（博客、X/Twitter、播客），帮你组织、关联，并**主动告诉你哪些认知已经过时了**。

### 核心理念

传统笔记工具假设知识永远有效。FreshMind 假设知识会腐烂。

Karpathy 的 LLM Wiki 解决了"组织"和"查询"，但没有解决"保鲜"和"采集"。FreshMind 在 LLM Wiki 的基础上加入**自动信息源监控**和**知识半衰期系统**——系统自动抓取你关注的信息源，组织成 wiki，并主动检查哪些认知已经过时。

### 类比

> 不是更好的笔记工具，是一个自动进货、自动检查过期食品的智能冰箱。

---

## 二、目标人群

### 核心用户画像

**AI PM（产品经理）**，在中国互联网公司工作或正在求职，需要持续追踪 AI 行业动态来做产品决策。

### 用户特征

- 每天刷大量 AI 信息源（Twitter/X、公众号、即刻、Hacker News、内部文档）
- 会零散记笔记，但不成体系
- 记完基本不会回看（write-only 行为模式）
- 需要时想不起信息在哪，或不确定是否还有效
- 核心焦虑不是"信息不够"而是"不知道已有认知还对不对"

### 典型用户故事

- "我三月份记了 DeepSeek V3 是最强开源模型，现在还对吗？"
- "面试时被问到小红书和抖音的 AI 战略差异，我之前整理过但不知道那些信息是否过时了"
- "我想写一篇 AI agent 产品分析，但我的素材库里有些信息可能已经是旧的了"

---

## 三、需求分析

### 用户痛点层级

| 层级 | 痛点 | 现有解决方案 | 为什么不够好 |
|------|------|-------------|-------------|
| L1 | 信息记了不会回看 | 飞书、Notion、Obsidian | 都是被动工具，等人来翻 |
| L2 | 不知道已有信息是否过时 | 无 | 没有任何工具做这件事 |
| L3 | 信息碎片化，缺乏关联 | Obsidian 双向链接 | 需要人工维护链接 |
| L4 | 需要时找不到 | 全文搜索 | 知道关键词才能搜 |

**核心创新点在 L2——目前没有任何产品主动告诉用户"你的认知过时了"。**

### 需求优先级

1. **Must Have**: 知识 ingest + 自动组织 + 过时检测 + 保鲜报告
2. **Should Have**: 知识间的关联图谱 + 查询系统
3. **Nice to Have**: 多信息源自动采集 + 团队协作

---

## 四、场景设计

### 场景 1：自动信息源监控（Crawl + Ingest）

**触发**：定时任务自动执行（GitHub Actions 每日跑），或用户手动执行 `fm crawl`

**流程**：
1. 系统自动抓取用户配置的信息源（`sources.yaml`）：
   - **博客/Newsletter**：通过 RSS 解析 + HTML 抓取正文（28 个源，MVP 支持）
   - **X/Twitter**：通过 X API v2 拉取最近 24h 推文（39 个账号，v0.2 支持）
   - **播客/YouTube**：通过 RSS + 转录服务提取文字（18 个源，v0.4 支持）
2. 对比去重状态（`_meta/state.json`），筛选出**新内容**（未见过的文章/推文）
3. 新内容自动进入 Ingest 流程——Agent 在**一次 LLM 调用中**完成所有标注：
   - 提取关键信息点，区分**事实性声明**和**观点/概念**
   - 为每条事实性声明标注**信息类型**和**预估半衰期**
   - 为每条声明预设**验证用搜索关键词**（供未来 freshness check 使用）
   - 关联到已有知识页面，更新交叉引用
   - **检测是否与已有知识矛盾**，如有则标注冲突并在终端提醒用户
4. 用户在 Obsidian 中看到新增/更新的 wiki 页面，每条声明已带保鲜 tag
5. 用户也可以通过 `fm ingest <url>` 手动补充不在监控列表中的内容

**关键技术决策**：
- **Crawl 与 Ingest 分离**：Crawl 只负责抓取原始内容 + 去重，Ingest 负责 LLM 结构化 + wiki 写入。Crawl 可以在 GitHub Actions 上跑（无需本地运行），Ingest 在本地跑
- **Ingest 时一次性完成所有标注**：不在后续阶段补标签，确保 freshness check 只需读 tag 来决定查谁

示例——一篇文章 ingest 后，每条声明的 tag 结构：
```json
{
  "claim": "Claude Opus 4.6 在 SWE-bench 上得分 72%",
  "type": "benchmark_data",
  "half_life_days": 45,
  "search_query": "Claude Opus 4.6 SWE-bench score 2026",
  "confidence": 0.9
}
```
benchmark 数据半衰期 45 天，很快需要检查；而同一篇文章中的"MCP 是 Anthropic 发起的协议"属于 tech_concept，半衰期 540 天。**不同声明在入口就获得了差异化的保鲜周期。**

**信息类型与半衰期预估**：

| 信息类型 | 示例 | 半衰期 (天) | 45天后新鲜度 | 90天后新鲜度 |
|----------|------|------------|-------------|-------------|
| benchmark_data 模型评测 | "GPT-4o 在 X benchmark 得分 Y" | 45 | 50% 🟡 | 25% 🟠 |
| model_capability 模型能力 | "Claude 编程能力最强" | 60 | 60% 🟡 | 35% 🟡 |
| product_update 产品更新 | "Claude 新增 MCP 支持" | 120 | 77% 🟢 | 59% 🟡 |
| company_strategy 公司战略 | "字节跳动收购 X 公司" | 180 | 84% 🟢 | 70% 🟡 |
| industry_trend 行业趋势 | "2026 是 agent 之年" | 180 | 84% 🟢 | 70% 🟡 |
| person_move 人事变动 | "X 加入 Y 公司" | 365 | 92% 🟢 | 84% 🟢 |
| tech_concept 技术概念 | "什么是 RAG" | 540 | 95% 🟢 | 89% 🟢 |

### 场景 2：保鲜检查（Freshness Check）

**触发**：用户执行 `fm freshcheck`（MVP 手动触发，未来可设定 cron 定时）

**流程**：
1. Agent 扫描 vault 中所有页面，计算衰减分数，筛选 freshness_score < 0.75 的条目
2. 对这些条目执行 web search，对比最新信息
3. 生成"保鲜报告"：
   - 🔴 **已过时**：明确有新信息推翻了原有认知
   - 🟡 **需关注**：有新发展但不一定推翻原有认知
   - 🟢 **仍然有效**：经检查无变化
4. 用户在 Obsidian 中阅读 `freshness-report-latest.md`，通过 CLI 做决策：
   - `fm update <page> --action update`：Agent 自动修订 wiki 页面
   - `fm update <page> --action archive`：保留但标注为过时信息
   - `fm update <page> --action ignore`：延长半衰期

**示例输出**：

**`freshness-report-latest.md`（在 Obsidian 中查看）**：

```markdown
# 📋 FreshMind 保鲜报告 | 2026-05-17

> 检查条目: 18 | 🔴 过时: 2 | 🟡 需关注: 1 | 🟢 有效: 15

## 🔴 已过时 (2条)

### 1. [[models/claude-sonnet-3-5]] — 新鲜度 12%
- **原始声明**: "Claude 3.5 Sonnet 是编程最强模型" (记录于 2025-11-03)
- **最新发现**: Claude Opus 4.6 于 2026-04 发布，SWE-bench 得分提升 15%
- **操作**: `fm update models/claude-sonnet-3-5 --action update`

### 2. [[entities/karpathy]] — 新鲜度 18%
- **原始声明**: "Karpathy 在做 Eureka Labs 教育项目" (记录于 2025-08-20)
- **最新发现**: Karpathy 近期重心转向 LLM Wiki 知识管理模式
- **操作**: `fm update entities/karpathy --action update`

## 🟡 需关注 (1条)

### 3. [[entities/xiaohongshu]] — 新鲜度 52%
- **原始声明**: "小红书 AI 战略聚焦于社区搜索" (记录于 2026-01-15)
- **最新发现**: 小红书近期上线了 AI 点评功能，战略可能有扩展
- **操作**: `fm update entities/xiaohongshu --action supplement`

## 🟢 仍然有效 (15条)
<details><summary>展开查看</summary>
- [[concepts/mcp-protocol]] — 89% 🟢
- [[concepts/transformer]] — 95% 🟢
- ...
</details>
```

### 场景 3：知识查询（Query）

**触发**：用户需要某个领域的信息

**流程**：
1. 用户执行 `fm query "AI coding tools 的竞争格局是什么？"`
2. Agent 读取 wiki index → 找到相关页面 → 综合回答
3. 回答直接输出到终端，标注每条信息的**保鲜状态**和**来源时间**

**与普通 RAG 的区别**：不是每次从原文重新检索，而是读取已经综合过的 wiki 页面。信息经过组织和验证，不是碎片化的 chunk。

### 场景 4：知识审计（Lint）

**触发**：用户手动触发 或 每周自动执行

**流程**：
1. 检查结构完整性：孤儿页面、缺失链接、被提到但没有独立页面的概念
2. 检查内容一致性：wiki 内部的矛盾（A 页面说 X 公司做了 Y，B 页面说没做）
3. 检查保鲜状态：批量检查所有超过半衰期的条目
4. 生成审计报告

---

## 五、为什么是现在做

1. **Karpathy 刚发布 LLM Wiki 模式（2026年4月）**：概念已被验证，社区热度极高（3万+ star），但尚无成熟产品化实现，市场窗口打开
2. **AI 信息的更新速度前所未有**：模型每几个月换代，公司战略频繁调整，AI PM 的信息保鲜压力是所有行业中最大的
3. **MCP 生态成熟**：web search、文件系统读写、日历集成等能力都可以通过 MCP 标准化调用，技术基建已就绪
4. **Agent 能力达到临界点**：自动联网检查 + 结构化写入 + 矛盾检测——这三个能力在 2025 年之前的模型上都不够可靠，现在可以了
5. **中文 AI 知识管理的空白**：Karpathy LLM Wiki 的所有实现都是英文的，中文 AI 从业者没有对应工具

---

## 六、为什么是 LLM Wiki 而不是其他方案

| 方案 | 优势 | 劣势 | 与 FreshMind 的关系 |
|------|------|------|-------------------|
| 传统笔记（Notion/飞书） | 用户熟悉，门槛低 | 纯被动，不会组织也不会保鲜 | FreshMind 要解决的问题 |
| RAG 系统 | 能从文档中检索 | 每次从头搜索，不积累不综合 | FreshMind 用 wiki 替代 RAG |
| 知识图谱工具（Obsidian） | 双向链接、可视化 | 需要人工维护链接，不会保鲜 | FreshMind 自动维护链接 |
| AI 搜索（Perplexity） | 实时信息 | 不积累个人认知，无个人知识库 | FreshMind 用搜索来做保鲜检查 |
| Karpathy LLM Wiki 原版 | 自动组织、index、lint | 没有保鲜机制，时间盲视 | FreshMind = LLM Wiki + 保鲜层 |

**核心论点**：LLM Wiki 解决了"谁来做知识的整理工作"（答：LLM 做），但没有解决"知识会过时"这个根本问题。FreshMind 的差异化就是在 LLM Wiki 的 ingest/query/lint 三件套上加了第四个原语：**freshness check**。

---

## 七、产品架构

**核心理念：Harness 模式——CLI 是操作入口，Obsidian 是展示层，中间是纯逻辑的 Harness。**

```
┌─────────────────────────────────────────────────────────────┐
│                       用户交互层                             │
│                                                             │
│  ┌─────────────────────┐      ┌───────────────────────────┐ │
│  │  CLI (终端)          │      │  Obsidian (知识浏览器)     │ │
│  │                     │      │                           │ │
│  │  $ fm crawl         │      │  📁 vault 目录浏览         │ │
│  │  $ fm ingest <url>  │      │  🔗 双向链接 + 图谱        │ │
│  │  $ fm freshcheck    │      │  📊 保鲜报告查看           │ │
│  │  $ fm query "..."   │      │  ✏️ 直接编辑 wiki 页面     │ │
│  │  $ fm sources       │      │                           │ │
│  └──────────┬──────────┘      └─────────────┬─────────────┘ │
│             │ 调用                   读取/编辑 .md 文件       │
└─────────────┼───────────────────────────────┼───────────────┘
              │                               │
              ▼                               │
┌─────────────────────────────────────────────────────────────┐
│                 Harness 层 (Node.js CLI)                     │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ Crawl    │  │ Ingest   │  │ Query    │  │ Freshness  │ │
│  │ Agent    │  │ Agent    │  │ Agent    │  │ Check Agent│ │
│  │ RSS/X/播客│  │ LLM提取  │  │ LLM回答  │  │ 搜索+验证  │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────┐      │
│  │ 核心模块：衰减计算 / frontmatter 读写 / 去重状态 / │      │
│  │ index 维护 / 日志追加 / 半衰期自校准              │      │
│  └──────────────────────────────────────────────────┘      │
└──────────┬──────────────────┬───────────────────────────────┘
           │                  │
           ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                     外部服务层                               │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌────────────┐  │
│  │ Kimi K2.6 │ │ Tavily    │ │ X API v2  │ │ Obsidian   │  │
│  │(SiliconFl)│ │(WebSearch)│ │(推文抓取) │ │ Vault      │  │
│  └───────────┘ └───────────┘ └───────────┘ └────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**不需要任何前端开发**。Obsidian 天然支持 Markdown + YAML frontmatter + `[[wikilinks]]` + 图谱可视化，打开 vault 目录即可使用。

---

## 八、核心数据模型

### 知识条目 (Knowledge Entry)

每个 wiki 页面的 frontmatter 包含：

```yaml
---
title: "Claude Opus 4.6 编程能力分析"
type: model_capability          # 信息类型
created: 2026-04-18             # 创建时间
last_verified: 2026-05-10       # 上次验证时间
half_life_days: 60              # 预估半衰期（天）
freshness_status: fresh         # fresh | stale | outdated | archived
confidence: 0.85                # 置信度 0-1
sources:                        # 来源
  - url: "https://anthropic.com/news/claude-opus-4-6"
    date: 2026-04-15
  - url: "https://..."
    date: 2026-04-20
related:                        # 关联页面
  - "[[concepts/coding-agents]]"
  - "[[entities/anthropic]]"
  - "[[comparisons/claude-vs-gpt]]"
superseded_by: null             # 被哪条新知识替代
tags: [模型能力, Anthropic, 编程, benchmark]
---
```

### 新鲜度衰减模型

每条知识的新鲜度通过**指数衰减公式**连续计算，而非简单的到期/未到期：

```
freshness_score = e^(-λ × t)

λ = ln(2) / half_life_days    （衰减常数，由信息类型决定）
t = today - last_verified      （距上次验证的天数）
```

**新鲜度分数 → 保鲜状态映射**：

| 分数 | 状态 | 颜色 | 含义 |
|------|------|------|------|
| ≥ 0.75 | fresh | 🟢 | 信息可信 |
| 0.50~0.75 | stale | 🟡 | 建议验证 |
| 0.25~0.50 | outdated | 🟠 | 很可能过时 |
| < 0.25 | expired | 🔴 | 几乎确定过时 |

**衰减示例**：同一天录入的 benchmark 数据（半衰期 45 天）和技术概念（半衰期 540 天），90 天后前者新鲜度仅 25%（🟠），后者仍有 89%（🟢）。

### 保鲜状态流转

```
fresh ──(分数降至<0.75)──→ stale ──(验证后确认过时)──→ outdated
  ↑                          │                            │
  │                          │(验证后确认仍有效,重置t=0)    │
  └──────────────────────────┘                            │
                                                          ↓
                                                  archived (保留历史记录)
```

---

## 九、自进化机制

FreshMind 不是静态工具——它会根据用户的使用行为越变越聪明。

### 层 1：半衰期自校准（MVP）

**核心思路**：默认半衰期只是初始猜测。用户每次对保鲜报告做决策，都在隐式告诉系统"你猜对了"或"你猜错了"。

**反馈信号 → 校准动作**：

| 用户行为 | 含义 | 校准动作 |
|---------|------|---------|
| 🔴 条目，执行 `update` | 系统抓到了真正过时的信息 | 半衰期不变（猜对了）|
| 🔴 条目，执行 `ignore` | 系统误报，信息其实没过时 | 该类型半衰期 × 1.5（太短了）|
| 🟢 条目，用户主动编辑修改 | 系统漏报，信息已过时但没抓到 | 该类型半衰期 × 0.7（太长了）|
| 🟡 条目，`暂不处理` 后 30 天内用户手动更新 | 半衰期略长 | 该类型半衰期 × 0.85 |
| 🟡 条目，`暂不处理` 后一直没动 | 半衰期合适 | 不变 |
| 某条 claim 连续 3 次被 `confirmed` | 该声明已证明稳定 | 该条 claim 的半衰期 × 1.3 |

**存储**：校准后的半衰期保存在 `_meta/calibration.yaml`，每个信息类型一个值，随使用自动更新。新页面的半衰期使用校准值而非默认值。

**效果**：使用 1 个月后，系统会学到"这个用户关注的 AI benchmark 数据平均 38 天就过时了（不是默认的 45 天）"，保鲜检查的精准度会显著提升。

### 层 2：验证精度反馈（v0.3）

当用户纠正 freshcheck 的判断时（系统说过时但用户说没有，或反过来），记录为 false_positive / false_negative。积累数据后：
- 分析 false_positive 共性 → 优化 verification prompt 的判断标准
- 分析 false_negative 共性 → 优化 search_query 的生成策略
- 按信息源追踪准确率 → 降低低质量来源的默认 confidence

### 层 3：知识图谱自生长（v0.5）

基于用户行为推断知识结构：
- 频繁 ingest 某领域内容 → 自动提升该领域的检查频率
- 从不查看某个页面 → 降低该页面的 freshcheck 优先级
- 频繁在 A 和 B 之间切换 → 自动建议 A↔B 关联
- 某个信息源的内容经常被标记过时 → 降低该来源的默认 confidence

### 自进化的飞轮效应

```
用户 ingest 更多内容 → wiki 更丰富
    ↓
freshcheck 覆盖更多条目 → 用户做更多决策
    ↓
更多反馈信号 → 半衰期校准更精确
    ↓
保鲜报告更准确 → 用户更信任系统 → 用户 ingest 更多内容
```

---

## 十、MVP 范围

### MVP 包括 ✅

1. **CLI 工具 (`fm`)**：全局安装的命令行工具，所有操作通过终端命令完成
2. **博客/RSS 自动监控**：`fm crawl` 自动抓取 28 个博客/Newsletter 源，发现新内容自动 ingest
3. **手动 Ingest 补充**：`fm ingest <url/text>` 手动补充不在监控列表中的内容
4. **Index 系统**：自动维护 index.md，按类别和保鲜状态组织
5. **保鲜检查**：`fm freshcheck` 手动触发，Agent 联网检查并生成 `freshness-report-latest.md`
6. **基础 Query**：`fm query "问题"` 用自然语言问 wiki，回答附带保鲜状态标注
7. **半衰期自校准**：根据用户对保鲜报告的反馈，自动调整半衰期参数
8. **信息源管理**：`fm sources` 查看/添加/删除监控的信息源
9. **Obsidian 展示**：vault 目录即 wiki，零开发成本获得双向链接、图谱、搜索能力
10. **中文优先**：Agent prompt 以中文为主

### MVP 不包括 ❌

- X/Twitter 自动监控（需要 Bearer Token，v0.2）
- 播客/YouTube 自动转录（需要 ASR，v0.4）
- 自动定时 crawl（MVP 手动 `fm crawl`，v0.2 加 cron/GitHub Actions）
- Web UI / 前端界面（Obsidian 即前端）
- 用户账号系统/多用户协作
- Lint 审计功能（优先级低于保鲜）
- MCP server 暴露（未来可做）
- Obsidian 插件开发（MVP 不需要，Obsidian 只做 viewer）

---

## 十一、技术选型（建议）

| 组件 | 选型 | 理由 |
|------|------|------|
| 交互方式 | CLI (`fm` 命令) + Obsidian (浏览) | 无需前端开发，Obsidian 免费提供展示层 |
| CLI 框架 | Commander.js + Ora | 轻量成熟，终端体验好 |
| LLM | Kimi K2.6 Pro via SiliconFlow (OpenAI 兼容接口) | 中文能力强，性价比高，API 兼容性好 |
| 信息源抓取 | Node.js fetch + RSS 解析（复用 follow-builders 模式） | 零外部依赖，28 个博客源 MVP 即覆盖 |
| X/Twitter | X API v2 + Bearer Token（v0.2，复用 follow-builders） | 官方 API，39 个账号监控 |
| 知识存储 | Obsidian Vault (本地 Markdown) | 与 Karpathy 模式一致，天然支持双向链接和图谱 |
| Web Search | Tavily API | 保鲜检查的关键依赖，专为 AI agent 设计 |
| 定时调度 | GitHub Actions（v0.2） / 本地 cron | 每日自动 crawl，无需服务器 |
| 分发 | npm 全局安装 | 一条命令安装，任意终端可用 |

---

## 十二、Hackathon Checklist

### Demo 前必须完成 ✅

- [ ] `fm init` 能初始化 vault 目录结构 + 预置 sources.yaml
- [ ] `fm crawl` 能自动抓取至少 3 个博客源的最新内容并 ingest 进 wiki
- [ ] `fm ingest <url>` 能手动补充一篇文章并写入 wiki
- [ ] 连续 ingest 的内容能自动关联到已有知识
- [ ] wiki 的 index.md 自动更新，显示所有条目和保鲜状态
- [ ] `fm freshcheck` 至少对 1 条知识成功检测出过时
- [ ] `freshness-report-latest.md` 在 Obsidian 中清晰展示 🔴🟡🟢 状态
- [ ] `fm update <page> --action update` 能自动修订 wiki 页面
- [ ] `fm query "问题"` 能用自然语言问 wiki 并得到回答
- [ ] 有一个能讲 2 分钟故事的 demo flow

### Demo Flow 建议（终端 + Obsidian 双屏演示）

1. **开场（20s）**："AI PM 关注 100+ 信息源，但记了就忘，而且不知道旧笔记还对不对"
2. **Crawl 演示（30s）**：终端执行 `fm crawl` → 系统自动抓取多个博客源 → Obsidian 里 wiki 页面批量出现
3. **冲突发现（15s）**：crawl 过程中发现新文章与已有 wiki 矛盾 → 终端高亮提示
4. **保鲜高潮（40s）**：`fm freshcheck` → 切到 Obsidian 打开保鲜报告 → 🔴 发现核心认知过时 → `fm update` 一键修订
5. **Query 演示（15s）**：问一个跨多条知识的问题，回答带保鲜状态标注

### 评分预期

| 维度 | 得分点 |
|------|--------|
| 创新性 | 知识半衰期 + 主动保鲜 = 市面上没有的功能 |
| 技术完成度 | Karpathy LLM Wiki 模式 + Web Search + Agent 编排 |
| 商业价值 | AI PM 刚需 + 可扩展到投资人/记者/分析师 |
| 用户体验 | 保鲜报告的 🔴🟡🟢 直觉化 + "信息来找人" |

---

## 十三、后续迭代方向（非 MVP）

| 版本 | 功能 | 信息源覆盖 | 自进化能力 | 价值 |
|------|------|-----------|-----------|------|
| v0.1 | CLI + Obsidian + 博客/RSS 自动监控 | 28 个博客源 | 层1：半衰期自校准 | 核心功能 + 自动采集 + 越用越准 |
| v0.2 | X/Twitter 监控 + GitHub Actions 定时 crawl | +39 个 X 账号 | - | 覆盖最活跃的信息源 |
| v0.3 | 定时保鲜 + 冲突检测推送 | - | 层2：验证精度反馈 | 信息来找人 + 减少误判 |
| v0.4 | 播客/YouTube 转录监控 | +18 个播客/视频 | - | 覆盖音视频内容 |
| v0.5 | Obsidian 插件 + MCP server | - | 层3：知识图谱自生长 | 不离开 Obsidian + 对外暴露 |
| v1.0 | 团队共享 wiki + 权限管理 | - | 团队级校准聚合 | 团队级知识管理 |

---

## 十四、风险与缓解

| 风险 | 严重性 | 缓解措施 |
|------|--------|---------|
| Web search 结果不准导致误判过时 | 高 | 保鲜报告只提供建议，最终由用户决策 |
| 半衰期预估不准 | 中 | 用信息类型做粗粒度分类，不追求精确 |
| Agent 组织知识的质量不稳定 | 中 | 用 schema.md 严格约束输出格式 |
| CLI 操作对非开发者有门槛 | 中 | 命令设计简洁（3-4 个核心命令），后续可做 Obsidian 插件降低门槛 |
| 中文 web search 质量不如英文 | 中 | 同时搜中英文源 |
| Obsidian 不是所有用户都用 | 低 | wiki 本质是 Markdown 文件，任何编辑器都能打开 |

---

## 十五、命名备选

| 名称 | 含义 | 优劣 |
|------|------|------|
| FreshMind | 保持大脑新鲜 | 直觉、好记、英文 |
| 知鲜 (ZhiXian) | 知识保鲜 | 中文感强，与"知乎"有差异 |
| HalfLife | 知识半衰期 | 极客感强，但与游戏重名 |
| WikiPulse | Wiki 的脉搏/生命力 | 偏工具感 |
| 保质期 (BaoZhiQi) | 直接说功能 | 太直白但好懂 |

---

## 十六、竞品分析

### 竞品全景图

FreshMind 面对三类竞争对手：传统知识管理工具、Karpathy LLM Wiki 生态的开源实现、以及企业级 AI 知识库。

#### A. 传统个人知识管理工具

| 竞品 | 核心能力 | 缺什么 |
|------|---------|--------|
| **Notion** | 模块化工作空间，2026年推出 Notion Agents 可跨应用完成任务 | AI 功能锁在 Business 计划（$20/人/月）；无保鲜机制；搜索准确率在独立测试中只有 52-58% |
| **Obsidian** | 本地优先、双向链接、图谱可视化 | 纯人工维护，无 AI 组织能力，无保鲜机制 |
| **飞书文档** | 中文生态主流协作工具 | 无 AI 组织、无关联、无保鲜——就是一个 write-only 文档 |
| **Heptabase** | 白板式知识管理，视觉化思维 | 强调空间组织但不做内容保鲜，无自动联网校验 |

**核心差距**：这些工具全部假设知识一旦写入就永远有效。没有任何一个会主动告诉你"这条信息过时了"。

#### B. Karpathy LLM Wiki 生态（直接竞争）

| 项目 | Stars | 核心特色 | 缺什么 |
|------|-------|---------|--------|
| **lucasastorian/llmwiki** | 新项目 | MCP 原生，通过 Claude 读写 wiki，最忠实的 Karpathy 实现 | 无保鲜检查、无 web search、无 UI |
| **yologdev/yopedia** | 新项目 | 6个专门化 agent pipeline，自动化程度最高（PM、office hour、build、review、research、architect） | 过度工程化，面向开发者，无保鲜机制 |
| **SamurAIGPT/llm-wiki-agent** | ~1,965 | 多平台兼容（Claude Code / Codex / Gemini），ingest 时检测矛盾 | 无时间维度、无保鲜、无 UI |
| **AgriciDaniel/claude-obsidian** | ~1,480 | 视觉最精致，10 个 skill，有 hot cache 保持跨 session 上下文 | 依赖 Obsidian 生态，无保鲜 |
| **Astro-Han/karpathy-llm-wiki** | 较新 | Agent Skills 标准实现，可安装到 Claude Code | 纯 CLI，无 web search，无保鲜 |
| **Kompl** | 较新 | Web app 形式，Obsidian 兼容导出，Docker 部署，Apache-2.0 | 无保鲜机制 |

**核心差距**：所有 Karpathy LLM Wiki 实现都忠实复刻了 ingest → query → lint 三件套，但**没有任何一个加入了保鲜层**。Karpathy 的 lint 检查结构一致性（孤儿页面、缺失链接），不检查内容是否过时。

#### C. 企业级 AI 知识管理产品

| 竞品 | 核心能力 | 与 FreshMind 的区别 |
|------|---------|-------------------|
| **Bloomfire** | AI 标记过时和冗余内容，自动建议更新 | 企业级，面向团队文档管理，不是个人知识库 |
| **Guru** | AI 自动验证知识新鲜度，Chrome/Slack 扩展 | 面向内部知识共享，按团队使用，$15+/人/月 |
| **Confluence + Rovo** | 20+ 预置 AI agent，跨 Jira 搜索 | 重型企业工具，个人使用过度 |
| **TTMS AI4Knowledge** | 语义搜索 + 内容保鲜检查 + 重复检测 | 面向大型企业咨询场景，非个人工具 |
| **Taskade** | AI wiki + stale-page detection + agent | 通用团队工具，无半衰期概念，不针对快速变化领域 |
| **Dume Cowork** | 无代码版 LLM Wiki，桌面 agent | 降低门槛但无保鲜机制，不联网校验 |

**核心差距**：企业工具有"标记过时"的概念，但它们检测的是"这篇文档多久没人访问了"（基于访问频率），而不是"这条信息在现实世界中还对不对"（基于联网验证）。这是本质区别。

---

### FreshMind 的差异化竞争优势

#### 1. 唯一做"联网保鲜"的个人知识库

所有竞品的"过时检测"要么基于访问频率（"这篇文档 3 个月没人看了"），要么基于结构完整性（"这个页面没有被其他页面引用"）。FreshMind 是唯一一个**主动联网检查信息在现实世界中是否仍然成立**的产品。

这不只是功能差异，是**范式差异**：从"这篇文档旧了"到"这条认知错了"。

#### 2. 半衰期系统——为快速变化领域量身定制

通用知识管理工具对所有信息一视同仁。但 AI 领域的信息有极不均匀的衰减速率：模型能力对比可能一个月就过时，而技术概念解释可以保持两年有效。

FreshMind 按信息类型设定差异化的半衰期，这意味着系统知道"GPT-4o 的 benchmark 得分"比"什么是 Transformer"更需要频繁检查。这个颗粒度是所有通用工具都不具备的。

#### 3. 填补 Karpathy LLM Wiki 生态的明确空白

Karpathy 自己在 gist 中提到 lint 操作但只覆盖结构层面。gist 评论区有人明确指出"时间退化"是未解决的问题。LLM Wiki v2 扩展方案提到"置信度评分、替代机制、保留衰减"但尚无实现。

FreshMind 不是在做一个新品类，而是在**补全 Karpathy 留下的最大缺口**。这让叙事极其清晰："Karpathy 说 LLM 解决了知识管理的 bookkeeping 问题，但他漏了一个——知识会过时。我们补上了这一块。"

#### 4. 中文 AI 生态的零号产品

目前所有 LLM Wiki 实现都是英文的。中文 AI PM 是一个有明确需求但完全未被服务的用户群：他们追踪的信息源（公众号、即刻、小红书、B站）、他们的竞品（抖音、小红书、字节）、他们的工作语言，都没有对应的工具。

#### 5. Obsidian 生态融合

FreshMind 不重新造轮子做 UI，而是直接输出到 Obsidian vault。用户获得双向链接、知识图谱、全文搜索等 Obsidian 生态能力，同时享受 FreshMind 的自动组织和保鲜检查。CLI + Obsidian 的组合让 AI PM 在熟悉的工具中使用全新的能力。

---

### 竞争矩阵总结

|  | 自动组织 | 交叉引用 | 过时检测 | 联网验证 | 半衰期 | 中文支持 | Obsidian 兼容 | 个人级 |
|--|---------|---------|---------|---------|-------|---------|-------------|-------|
| Notion | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ |
| Obsidian | ✗ | ✓(手动) | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ |
| lucasastorian/llmwiki | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| yopedia | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Bloomfire | ✓ | △ | ✓(访问频率) | ✗ | ✗ | ✗ | ✗ | ✗(企业) |
| Guru | ✓ | △ | ✓(访问频率) | ✗ | ✗ | ✗ | ✗ | ✗(团队) |
| Dume Cowork | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| **FreshMind** | **✓** | **✓** | **✓(内容层面)** | **✓** | **✓** | **✓** | **✓** | **✓** |

FreshMind 是唯一一个在所有维度上都打 ✓ 的产品。

---

### 防御性壁垒

1. **数据飞轮**：用户使用越多，wiki 越丰富，保鲜检查越有价值，切换成本越高
2. **半衰期模型积累**：随着保鲜检查的数据积累，不同信息类型的半衰期预估会越来越准
3. **中文 AI 领域的垂直知识**：schema 针对中文 AI PM 场景优化，通用工具难以复制这种垂直理解
4. **Karpathy 叙事的时间窗口**：LLM Wiki 概念热度正处于高峰期（3万+ star，6千+ fork），这个时间窗口可能只有 3-6 个月
