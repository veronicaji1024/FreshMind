---
name: ingest
description: 从指定 URL 提取文章正文内容，有 API Key 时调用 LLM 写入 wiki
user_invocable: true
requires: [vault_initialized, tsc_compiled]
fallback: "无 SILICONFLOW_API_KEY 时降级为纯内容提取（显示标题和正文预览，不写入 wiki）"
deterministic_steps: ["npx tsc", "node dist/cli/index.js ingest <url>"]
---

# Ingest — 单篇文章内容提取

从给定 URL 提取文章正文，为后续写入 wiki 做准备。

## 步骤

1. 确保项目已编译：
   ```bash
   npx tsc
   ```

2. 提取文章内容：
   ```bash
   node dist/cli/index.js ingest <url>
   ```

3. 输出包含：标题、正文预览（前 500 字）、正文长度

## 提取原理

- 先用 JSDOM + @mozilla/readability 提取正文
- 如果 Readability 失败（内容 < 200 字），用 Cheerio fallback 尝试 `article`、`main`、`.post-content` 等选择器
- 最终 fallback 到 body 文本

## 用法示例

```bash
node dist/cli/index.js ingest https://simonwillison.net/2026/May/16/openclaw-names/
```
