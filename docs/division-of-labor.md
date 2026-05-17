# FreshMind 分工方案

> 2 人 × 48 小时黑客松 | 基于 architecture.md

---

## 角色定义

| | **Person A：数据管道** | **Person B：智能引擎** |
|--|--|--|
| 一句话 | 负责"数据怎么进来、怎么存" | 负责"数据怎么变聪明" |
| 核心模块 | Crawler + Wiki 读写 + Config | LLM Agent + Freshness + Search |
| CLI 命令 | `fm init` / `fm crawl` / `fm ingest` / `fm sources` / `fm status` | `fm freshcheck` / `fm query` / `fm update` |

---

## 时间线

### Phase 0：共建基础（0-4h，两人一起）

| 任务 | 产出文件 | 负责 |
|------|---------|------|
| 项目初始化 | `package.json`, `tsconfig.json`, CLI 骨架 | 一起 |
| 核心类型定义 | `src/types.ts` | 一起 |
| 配置管理 | `src/config/config.ts`, `src/config/defaults.ts` | 一起 |
| `fm init` 命令 | `src/cli/commands/init.ts` | 一起 |
| 模板文件 | `templates/sources.yaml`, `templates/index.md`, `templates/.freshmind.yaml` | 一起 |
| **对齐接口签名** | 确认 `PageWriter`、`RawItem`、`IngestResult` 的字段 | 一起 |

**产出验收**：`fm init --vault ./test-wiki` 能创建完整目录结构。

---

### Phase 1：并行开发（4-12h，各自独立）

#### Person A 的任务清单

| # | 任务 | 文件 | 预估 | 验收标准 |
|---|------|------|------|---------|
| A1 | RSS 解析器 | `src/crawler/rss.ts` | 1.5h | 能解析 a16z、Lenny 等 3 个真实 RSS feed，返回 `RawItem[]` |
| A2 | HTML 正文提取 | `src/crawler/html.ts` | 1.5h | 对无 RSS 的源（如 Anthropic blog），能用 Cheerio+Readability 提取正文 |
| A3 | 去重逻辑 | `src/crawler/dedup.ts` | 1h | state.json 读写正确，重复 URL 被过滤，7 天旧记录被清理 |
| A4 | CrawlAgent 主入口 | `src/crawler/index.ts` | 1h | 串联 RSS/HTML/去重，输出 `{ raw_items, new_items, stats }` |
| A5 | Wiki 页面读写 | `src/wiki/page-writer.ts`, `page-reader.ts` | 1.5h | 能创建带 frontmatter 的 .md 文件，能读取并解析 frontmatter |
| A6 | 日志写入 | `src/wiki/log-writer.ts` | 0.5h | append-only 写入 log.md |
| A7 | `fm crawl` 命令 | `src/cli/commands/crawl.ts` | 0.5h | 终端显示 spinner + 摘要（此阶段 ingest 用 mock） |
| A8 | `fm sources` 命令 | `src/cli/commands/sources.ts` | 0.5h | list / add / remove / enable / disable |

**Day 1 结束 Person A 的验收**：
```bash
fm crawl  # → 抓取 3+ 博客源，显示"发现 N 篇新内容"
fm sources list  # → 显示所有源及启用状态
```
此时 ingest 部分用 mock（硬编码一个 `IngestResult` JSON），不依赖 LLM。

#### Person B 的任务清单

| # | 任务 | 文件 | 预估 | 验收标准 |
|---|------|------|------|---------|
| B1 | LLM 客户端封装 | `src/agents/llm-client.ts` | 1h | SiliconFlow OpenAI 兼容接口调通，支持切换 model |
| B2 | Prompt 模板 | `src/agents/prompts/ingest.ts`, `verify.ts`, `query.ts` | 1.5h | 3 个 prompt 模板，中文，JSON 输出格式 |
| B3 | IngestAgent | `src/agents/ingest-agent.ts` | 2h | 给一段文本 → 返回结构化 `IngestResult`（含 claims、type、half_life） |
| B4 | 衰减公式 | `src/freshness/decay.ts` | 0.5h | `calculateFreshness()` + `getFreshnessStatus()` 单元测试通过 |
| B5 | 批量扫描 | `src/freshness/scanner.ts` | 1h | 扫描 vault 所有 .md → 按衰减分数排序 → 返回 `FreshnessEntry[]` |
| B6 | Tavily 搜索 | `src/search/tavily.ts` | 0.5h | 调通 Tavily API，返回结构化结果 |
| B7 | FreshnessAgent | `src/agents/freshness-agent.ts` | 1.5h | claim + search → LLM 判断 → 返回 `VerificationResult` |
| B8 | 保鲜报告生成 | `src/wiki/report-writer.ts` | 0.5h | 写入 `freshness-report-latest.md`，含 🔴🟡🟢 分组 |
| B9 | `fm freshcheck` | `src/cli/commands/freshcheck.ts` | 0.5h | 端到端跑通 |
| B10 | `fm query` | `src/cli/commands/query.ts` | 0.5h | 读 index → 定位页面 → LLM 回答 → 终端输出 |

**Day 1 结束 Person B 的验收**：
```bash
# 手动在 vault 里放 3-5 个带 frontmatter 的 wiki 页面（含过时数据）
fm freshcheck  # → 生成保鲜报告，至少 1 条 🔴
fm query "什么是 MCP？"  # → 从 wiki 页面回答，带保鲜标注
```
此时 wiki 页面是手动准备的，不依赖 Crawler。

---

### Phase 2：集成联调（12-16h，两人一起）

| # | 任务 | 依赖 | 负责 |
|---|------|------|------|
| I1 | Crawler → IngestAgent 对接 | A4 + B3 | 一起 |
| I2 | IngestAgent → PageWriter 对接 | B3 + A5 | 一起 |
| I3 | Index 管理器 | A5（基础） + B5（状态显示） | A 写基础，B 补保鲜状态 |
| I4 | Wikilink 交叉引用 | B3 的 entities 输出 | A |
| I5 | 校准系统 | B4 | B |
| I6 | `fm update` 命令 | I5 + A5 | B |
| I7 | 端到端冒烟测试 | 全部 | 一起 |

**集成验收**：
```bash
fm crawl          # → 抓取博客 → 自动 ingest → wiki 页面出现 → index.md 更新
fm freshcheck     # → 检测到过时内容 → 生成报告
fm update models/gpt-4o --action update  # → 自动修订页面
fm query "AI coding tools 竞争格局"       # → 回答带保鲜标注
```

---

### Phase 3：打磨（16-20h，各自独立）

| Person A | Person B |
|----------|----------|
| 预填充 10-15 个 wiki 页面（用真实过时数据） | 终端 UI 美化（chalk 颜色、表格、ora spinner） |
| 配置 Obsidian vault（双向链接、图谱） | `fm status` 统计面板 |
| 准备 3 个博客源的真实 crawl 数据 | 错误处理 + 友好提示 |
| 确认 Obsidian 中保鲜报告的 🔴🟡🟢 显示效果 | README.md 安装使用说明 |

---

### Phase 4：Demo 排练（20-24h，两人一起）

| 时间 | 内容 |
|------|------|
| 20-21h | 确定 demo 脚本，排练 2 遍 |
| 21-22h | 录屏备用（防 live demo 翻车） |
| 22-23h | 准备讲稿（开场 20s + crawl 30s + 保鲜高潮 40s + query 15s） |
| 23-24h | 最终排练 + 休息 |

---

## Day 1 Mock 策略

两人并行时，用 mock 替代对方未完成的模块：

### Person A 的 mock（替代 Person B 的 LLM）

```typescript
// src/agents/__mocks__/ingest-agent.ts
export async function mockIngest(content: string): Promise<IngestResult> {
  return {
    title: "Mock: " + content.slice(0, 30),
    summary: "这是一条 mock 摘要",
    type: "tech_concept",
    verifiable_claims: [{
      claim: "Mock claim from content",
      search_query: "mock search query",
      confidence: 0.8
    }],
    entities: ["MockEntity"],
    related_concepts: ["mock-concept"],
    source_date: new Date().toISOString().split('T')[0]
  };
}
```

### Person B 的 mock（替代 Person A 的 Crawler + Wiki）

准备 3 个 fixture 文件放在 `test/fixtures/` 下：

```
test/fixtures/
├── mock-wiki-pages/           # 手动写的 wiki 页面（带 frontmatter）
│   ├── models/gpt-4o.md       # 故意过时的数据
│   ├── concepts/mcp.md        # 仍然有效的数据
│   └── entities/anthropic.md  # 需关注的数据
└── mock-crawl-results.json    # 3-5 条 RawItem
```

**Day 2 集成时删掉所有 mock，替换为真实调用。**

---

## 关键对齐时间点

| 时间 | 事项 | 方式 |
|------|------|------|
| 4h（Phase 0 结束） | 确认 `types.ts` 所有接口字段 | 面对面 review |
| 8h（Day 1 中期） | 各自进度同步，是否需要调整接口 | 5 分钟站会 |
| 12h（Day 1 结束） | 各自 demo 自己的半边，确认可集成 | 互相演示 |
| 16h（集成完成） | 端到端冒烟测试 | 一起跑 |
| 20h（打磨完成） | 完整 demo 排练 | 一起排练 |

---

## 文件归属速查

| 文件路径 | Person A | Person B | 共建 |
|---------|----------|----------|------|
| `src/types.ts` | | | ✓ |
| `src/cli/index.ts` | | | ✓ |
| `src/cli/commands/init.ts` | | | ✓ |
| `src/cli/commands/crawl.ts` | ✓ | | |
| `src/cli/commands/ingest.ts` | ✓ | | |
| `src/cli/commands/sources.ts` | ✓ | | |
| `src/cli/commands/status.ts` | ✓ | | |
| `src/cli/commands/freshcheck.ts` | | ✓ | |
| `src/cli/commands/query.ts` | | ✓ | |
| `src/cli/commands/update.ts` | | ✓ | |
| `src/cli/ui.ts` | | ✓ | |
| `src/crawler/*` | ✓ | | |
| `src/agents/llm-client.ts` | | ✓ | |
| `src/agents/ingest-agent.ts` | | ✓ | |
| `src/agents/freshness-agent.ts` | | ✓ | |
| `src/agents/query-agent.ts` | | ✓ | |
| `src/agents/prompts/*` | | ✓ | |
| `src/wiki/page-writer.ts` | ✓ | | |
| `src/wiki/page-reader.ts` | ✓ | | |
| `src/wiki/log-writer.ts` | ✓ | | |
| `src/wiki/index-manager.ts` | ✓(基础) | ✓(状态) | |
| `src/wiki/report-writer.ts` | | ✓ | |
| `src/wiki/linker.ts` | ✓ | | |
| `src/freshness/*` | | ✓ | |
| `src/search/*` | | ✓ | |
| `src/config/*` | | | ✓ |
| `templates/*` | | | ✓ |

---

## 如果时间不够，按优先级砍

| 优先级 | 功能 | 砍了怎么说 |
|--------|------|-----------|
| **绝对不砍** | `fm ingest` + `fm freshcheck` | 这是核心差异化 |
| 尽量保 | `fm crawl` | 砍了就手动 ingest 几篇代替 |
| 可以砍 | `fm query` | "我们还支持自然语言查询" |
| 先砍 | 半衰期自校准 | "系统会根据用户反馈自动调整半衰期" |
| 先砍 | `fm sources` CRUD | 直接编辑 sources.yaml |
