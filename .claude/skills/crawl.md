---
name: crawl
description: 抓取信息源 → 并行 LLM ingest → 写入 Obsidian wiki 页面的完整链路
user_invocable: true
requires: [vault_initialized, tsc_compiled]
fallback: "仅执行抓取，不调用 LLM ingest（无 SILICONFLOW_API_KEY 时自动降级）"
deterministic_steps: ["npx tsc", "source .env && node dist/cli/index.js crawl --vault <vault_path>"]
---

# Crawl → Ingest 全链路 Skill

从信息源抓取新文章，通过 LLM 提取结构化知识，写入 Obsidian vault。

## 前置条件

1. `.env` 文件包含 `SILICONFLOW_API_KEY`
2. vault 已初始化（包含 `sources.yaml`、`_meta/state.json`）
3. 项目已编译（`npx tsc`）

## 执行步骤

```bash
# 1. 编译
npx tsc

# 2. 执行 crawl + 自动 ingest（并行，默认并发 3）
source .env && node dist/cli/index.js crawl \
  --vault "/Users/jizixuan/Downloads/obsidian/ai pm" \
  --max-ingest 10 \
  --concurrency 3
```

## 全链路架构

```
sources.yaml → RSS/HTML 抓取 → URL 去重(state.json)
  → 新文章列表 → pLimit(3) 并行 ingest
    → 抓取正文(Readability) → 内容质量门控(≥200字)
    → 截断(≤8000字) → LLM 结构化提取(IngestAgent)
    → Claims 质量门控(>0条) → 写入 wiki 页面
    → rebuildIndex() → 更新 index.md
```

## 质量门控（3 层）

| 门控 | 条件 | 效果 |
|------|------|------|
| 内容长度 | < 200 字 | 跳过，抛 CONTENT_TOO_SHORT |
| 内容截断 | > 8000 字 | 截断前 8000 字送 LLM |
| Claims 数 | = 0 条 | 跳过，抛 NO_CLAIMS |

## LLM 稳定性配置

| 参数 | 值 | 说明 |
|------|------|------|
| 模型 | Pro/moonshotai/Kimi-K2.6 | SiliconFlow 上的 Kimi |
| 超时 | 120s | 并发场景下 API 响应慢 |
| 重试 | 2 次 | 退避 3s, 6s |
| 4xx | 不重试 | 客户端错误直接失败 |
| 5xx/429 | 重试 | 服务端错误可恢复 |
| JSON 解析 | 3 层 fallback | 直接解析 → markdown 代码块 → 找 JSON 括号 |

## 文章链接过滤

`html.ts` 的 `extractArticleLinks()` 排除以下非文章 URL：
- `/docs`, `/documentation`, `/api-reference`, `/changelog`
- `/@username` 用户主页
- `/resources`, `/tutorials`, `/academy`, `/platform`, `/products`
- `/category`, `/tag`, `/author`, `/search`, `/login`
- 静态资源（`.png`, `.css`, `.js`, `.pdf`）

## 历史问题归因

| 问题 | 根因 | 修复 |
|------|------|------|
| 垃圾页面"无有效内容" | 文档首页进入 ingest，LLM 生成空内容 | URL 过滤 + Claims 门控 |
| LLM 超时 | 长文章全文送 LLM | 内容截断 8000 字 |
| 并发超时 | 60s 超时 + 退避太短 | 120s + 退避 3s/6s |
| state.json 崩溃 | 重置时缺少 stats 字段 | 完整格式：seenItems + lastCrawl + stats |

## 降级策略

- **无 SILICONFLOW_API_KEY**：只 crawl 不 ingest，打印新文章列表
- **LLM 返回非 JSON**：3 层 fallback 解析，全失败则跳过该篇
- **单篇 ingest 失败**：不影响其他篇（Promise.allSettled 隔离）

## 重新抓取

```bash
# 清空去重记录，重新抓取所有内容
echo '{"seenItems":{},"lastCrawl":"2026-01-01T00:00:00.000Z","stats":{"totalCrawls":0,"totalIngested":0,"totalSkipped":0}}' \
  > "/Users/jizixuan/Downloads/obsidian/ai pm/_meta/state.json"
```

## 验证标准

- 编译零错误：`npx tsc --noEmit`
- 成功率 ≥ 70%（质量门控拦截不算失败）
- 超时 = 0
- vault 中无垃圾页面（无"无有效内容"类文件）
