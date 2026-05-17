# FreshMind 架构规范

> 两人协作的共同约定，开工前必读

---

## 一、项目结构

```
freshmind/
├── src/
│   ├── cli/                    # CLI 入口，只做参数解析 + 调用 agent/模块
│   │   ├── index.ts            # Commander.js 注册所有命令
│   │   ├── commands/*.ts       # 每个命令一个文件
│   │   └── ui.ts               # 终端输出：spinner、颜色、表格
│   ├── crawler/                # 信息源抓取，不依赖 LLM
│   ├── agents/                 # LLM 调用逻辑
│   │   ├── llm-client.ts       # 唯一的 LLM 调用入口
│   │   ├── *-agent.ts          # 各 agent
│   │   └── prompts/*.ts        # prompt 模板
│   ├── wiki/                   # Markdown 文件读写
│   ├── freshness/              # 衰减计算、校准
│   ├── search/                 # Web search 封装
│   ├── config/                 # 配置读写
│   └── types.ts                # 所有共享类型（唯一定义处）
├── templates/                  # fm init 复制的模板
├── test/
│   ├── unit/                   # 单元测试，按模块目录对应
│   ├── fixtures/               # mock 数据、测试用 wiki 页面
│   └── e2e/                    # 端到端测试
├── package.json
├── tsconfig.json
└── .env.example                # 环境变量模板
```

**规则**：
- `src/` 下每个子目录是一个模块，模块间通过 `import` 顶层 `index.ts` 调用
- 禁止跨模块直接 import 内部文件（如 `import { xxx } from '../crawler/rss'`），必须从模块入口导出

---

## 二、命名规范

### 文件命名

```
kebab-case.ts          # 所有源文件
kebab-case.test.ts     # 测试文件，和源文件同名
```

### 变量 / 函数 / 类

```typescript
// 变量和函数：camelCase
const halfLifeDays = 45;
function calculateFreshness() {}
async function crawlBlogs() {}

// 类：PascalCase
class CrawlAgent {}
class IngestAgent {}
class PageWriter {}

// 接口和类型：PascalCase
interface RawItem {}
type InfoType = 'benchmark_data' | 'model_capability' | ...;

// 常量：UPPER_SNAKE_CASE
const DEFAULT_HALF_LIFE: Record<InfoType, number> = { ... };
const FRESHNESS_THRESHOLD = 0.75;
const MAX_FRESHCHECK_ITEMS = 10;

// 枚举值（如果用）：PascalCase
enum FreshnessStatus { Fresh, Stale, Outdated, Expired }
```

### Wiki 文件命名

```
kebab-case.md          # 所有 wiki 页面
entities/anthropic.md  # 实体
concepts/mcp-protocol.md  # 概念
models/claude-opus-4-6.md  # 模型（版本号用连字符）
comparisons/claude-vs-gpt.md  # 对比
trends/agent-friendly-products.md  # 趋势
```

---

## 三、TypeScript 规范

### tsconfig 关键配置

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

### 异步规范

```typescript
// ✅ 所有 I/O 操作用 async/await
async function readPage(path: string): Promise<WikiPageMeta> { ... }

// ❌ 不用回调
fs.readFile(path, (err, data) => { ... })

// ✅ 用 fs/promises
import { readFile, writeFile } from 'fs/promises';
```

### 错误处理

```typescript
// ✅ 自定义错误类，带 code 字段
export class FreshMindError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'FreshMindError';
  }
}

// ✅ Agent 调用失败时抛明确错误
throw new FreshMindError(
  'SiliconFlow API 调用失败: ' + response.statusText,
  'LLM_API_ERROR'
);

// ✅ CLI 层统一 catch 并友好输出
// src/cli/commands/crawl.ts
try {
  await crawlAgent.crawl();
} catch (err) {
  if (err instanceof FreshMindError) {
    ui.error(err.message);  // 友好提示
  } else {
    throw err;  // 未知错误，let it crash
  }
}
```

### 日志

```typescript
// 不用 console.log，用 ui.ts 的封装
import { ui } from '../cli/ui';

ui.info('发现 3 篇新文章');       // 普通信息
ui.success('✅ 写入 concepts/mcp.md');  // 成功
ui.warn('⚠️ 与已有知识矛盾');     // 警告
ui.error('❌ API 调用失败');       // 错误
ui.spin('正在抓取博客源...');     // spinner
```

---

## 四、LLM 调用规范

### 唯一入口

所有 LLM 调用**必须通过 `llm-client.ts`**，禁止在 agent 里直接 fetch API。

```typescript
// src/agents/llm-client.ts
export class LLMClient {
  async chat(messages: Message[], options?: {
    temperature?: number;   // 默认 0.3
    max_tokens?: number;    // 默认 4096
    response_format?: { type: 'json_object' };
  }): Promise<string>;
}
```

### Prompt 管理

```typescript
// src/agents/prompts/ingest.ts
// 每个 prompt 导出一个函数，接收变量，返回 messages 数组

export function buildIngestPrompt(content: string): Message[] {
  return [
    { role: 'system', content: INGEST_SYSTEM_PROMPT },
    { role: 'user', content: `分析以下内容：\n\n${content}` }
  ];
}

// ❌ 不要把 prompt 硬编码在 agent 逻辑里
// ✅ prompt 模板集中在 prompts/ 目录，方便两人共同调优
```

### LLM 输出解析

```typescript
// ✅ 所有 LLM 返回值用 JSON mode + 类型校验
const result = await llm.chat(messages, {
  response_format: { type: 'json_object' }
});

const parsed = JSON.parse(result);

// 校验必要字段存在
if (!parsed.title || !parsed.type || !Array.isArray(parsed.verifiable_claims)) {
  throw new FreshMindError('LLM 返回格式不符合预期', 'LLM_FORMAT_ERROR');
}
```

---

## 五、Wiki 读写规范

### Frontmatter 格式

统一用 `gray-matter` 读写，frontmatter 字段顺序固定：

```yaml
---
title: "页面标题"
type: tech_concept          # InfoType 枚举值
created: 2026-05-17         # ISO 日期，不带时间
last_verified: 2026-05-17
half_life_days: 540         # 整数
freshness_status: fresh     # fresh | stale | outdated | expired
confidence: 0.9             # 0-1 浮点数
sources:
  - url: "https://..."
    date: 2026-05-17
related:
  - "[[entities/anthropic]]"
tags: [标签1, 标签2]
verifiable_claims:
  - claim: "声明内容"
    search_query: "搜索关键词"
    confidence: 0.9
    last_checked: 2026-05-17
    status: confirmed
---
```

### 页面正文结构

```markdown
# {title}

## 概述
一段话概述。

## 关键信息
- 要点 1
- 要点 2

## 相关链接
- [[entities/xxx]]
- [[concepts/yyy]]
```

### Wikilink 格式

```
[[目录/文件名]]          # 不带 .md 后缀
[[entities/anthropic]]   # ✅
[[entities/anthropic.md]] # ❌
```

### 文件操作原则

```typescript
// ✅ 写文件前确保目录存在
import { mkdir } from 'fs/promises';
await mkdir(path.dirname(filePath), { recursive: true });

// ✅ 更新页面时保留用户手动编辑的内容
// 只改 frontmatter 字段，不覆盖正文（除非是 fm update --action update）

// ✅ 所有写操作后追加 log.md
await logWriter.append({
  timestamp: new Date().toISOString(),
  action: 'ingest',
  page: 'concepts/mcp.md',
  summary: '新建页面，3 条声明'
});
```

---

## 六、配置读取规范

### 优先级（从高到低）

1. CLI 参数（`--vault ./path`）
2. 环境变量（`SILICONFLOW_API_KEY`）
3. `.freshmind.yaml` 配置文件
4. `src/config/defaults.ts` 默认值

### API Key 处理

```typescript
// ✅ 从环境变量读，不硬编码
const apiKey = process.env.SILICONFLOW_API_KEY;
if (!apiKey) {
  throw new FreshMindError(
    '请设置环境变量 SILICONFLOW_API_KEY\n' +
    '  export SILICONFLOW_API_KEY=sk-xxx',
    'MISSING_API_KEY'
  );
}

// ❌ 绝对不要把 key 写进代码或提交到 git
```

### .env.example

```bash
# 复制为 .env 并填入你的 key
SILICONFLOW_API_KEY=sk-xxx
TAVILY_API_KEY=tvly-xxx
# 可选：X API（v0.2 启用）
X_BEARER_TOKEN=
```

---

## 七、依赖管理

### 确定使用的依赖

```json
{
  "dependencies": {
    "commander": "^12.0.0",      // CLI 框架
    "ora": "^8.0.0",             // 终端 spinner
    "chalk": "^5.0.0",           // 终端颜色
    "gray-matter": "^4.0.0",     // frontmatter 解析
    "rss-parser": "^3.13.0",     // RSS 解析
    "cheerio": "^1.0.0",         // HTML 解析
    "@mozilla/readability": "^0.5.0",  // 正文提取
    "jsdom": "^24.0.0",          // Readability 依赖
    "yaml": "^2.4.0",            // YAML 读写
    "dotenv": "^16.0.0"          // 环境变量
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",          // 测试框架
    "@types/node": "^20.0.0"
  }
}
```

### 规则

- **加新依赖前先说一声**，避免两人装了功能重叠的包
- 优先用 Node.js 原生 API（`fs/promises`, `path`, `URL`）
- 不装 lodash，自己写 3 行能解决的不引包

---

## 八、Git 规范

### 分支

```
main                     # 稳定版本
├── feat/crawl           # Person A 的 crawl 功能
├── feat/freshness       # Person B 的 freshness 功能
└── feat/integration     # Day 2 集成分支
```

### Commit 格式

```
<type>(<scope>): <description>

feat(crawler): RSS 解析器支持 Atom 和 RSS 2.0
feat(agent): ingest prompt 模板初版
fix(wiki): frontmatter 日期格式修正
refactor(config): 统一配置读取逻辑
test(freshness): 衰减公式边界值测试
chore: 添加 .env.example
```

type 枚举：`feat` / `fix` / `refactor` / `test` / `chore` / `docs`

### 合并策略

```bash
# Day 1 各自在自己的分支上开发
git checkout -b feat/crawl    # Person A
git checkout -b feat/freshness # Person B

# Day 2 集成时
git checkout -b feat/integration
git merge feat/crawl
git merge feat/freshness
# 解决冲突（冲突大概率只在 types.ts 和 cli/index.ts）
```

---

## 九、测试规范

### 框架：Vitest

```typescript
// src/freshness/decay.test.ts
import { describe, it, expect } from 'vitest';
import { calculateFreshness, getFreshnessStatus } from './decay';

describe('calculateFreshness', () => {
  it('t=0 时新鲜度为 1', () => {
    expect(calculateFreshness(45, 0)).toBe(1);
  });

  it('t=半衰期 时新鲜度为 0.5', () => {
    expect(calculateFreshness(45, 45)).toBeCloseTo(0.5, 5);
  });

  it('benchmark_data 90天后约 25%', () => {
    expect(calculateFreshness(45, 90)).toBeCloseTo(0.25, 2);
  });

  it('tech_concept 90天后约 89%', () => {
    expect(calculateFreshness(540, 90)).toBeCloseTo(0.89, 2);
  });
});
```

### 什么必须测

| 模块 | 必须测 | 可以不测 |
|------|--------|---------|
| freshness/decay.ts | 公式正确性、边界值 | - |
| freshness/calibration.ts | 校准系数计算 | yaml 读写 |
| crawler/dedup.ts | 去重逻辑、7 天清理 | - |
| crawler/rss.ts | 用 fixture 测解析 | 网络请求 |
| wiki/page-writer.ts | frontmatter 格式 | - |
| agents/*.ts | 不测（依赖 LLM） | 用 mock 做集成测试 |

### 运行测试

```bash
npm test              # 跑全部
npm test -- --watch   # watch 模式
npm test -- decay     # 只跑某个文件
```

---

## 十、常量定义（defaults.ts）

两人共用，修改前必须同步：

```typescript
// src/config/defaults.ts

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
  fresh: 0.75,     // >= 0.75
  stale: 0.50,     // >= 0.50
  outdated: 0.25,  // >= 0.25
  expired: 0,      // < 0.25
} as const;

/** 保鲜检查默认配置 */
export const FRESHCHECK_DEFAULTS = {
  maxItems: 10,
  threshold: 0.75,
} as const;

/** Crawl 默认配置 */
export const CRAWL_DEFAULTS = {
  maxArticlesPerSource: 3,
  lookbackHours: 72,
  delayMs: 500,
  statePruneDays: 7,
} as const;

/** LLM 默认配置 */
export const LLM_DEFAULTS = {
  model: 'moonshotai/Kimi-K2.6',
  baseUrl: 'https://api.siliconflow.cn/v1',
  temperature: 0.3,
  maxTokens: 4096,
} as const;

/** 校准系数 */
export const CALIBRATION_FACTORS = {
  ignore: 1.5,       // 误报 → 半衰期延长
  manual_edit: 0.7,   // 漏报 → 半衰期缩短
  confirmed_3x: 1.3,  // 连续确认 → 延长
} as const;

/** Wiki 目录 → InfoType 映射 */
export const DIR_TYPE_MAP: Record<string, InfoType[]> = {
  entities: ['company_strategy', 'person_move'],
  concepts: ['tech_concept'],
  models: ['model_capability', 'benchmark_data'],
  comparisons: ['model_capability'],
  trends: ['industry_trend'],
} as const;

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
```

---

## 快速 checklist

开工前确认：

- [ ] 两人都读完了这份文档
- [ ] `types.ts` 的接口字段已对齐
- [ ] `.env.example` 都有了 SILICONFLOW_API_KEY 和 TAVILY_API_KEY
- [ ] 各自的分支已创建（`feat/crawl`, `feat/freshness`）
- [ ] `defaults.ts` 的常量值已确认
- [ ] 知道对方的 mock 数据格式（见 `division-of-labor.md`）
