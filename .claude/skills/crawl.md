---
name: crawl
description: 抓取所有已启用的 RSS/博客信息源，返回新发现的文章列表
user_invocable: true
---

# Crawl — 信息源抓取

执行 FreshMind 的博客信息源抓取流程。

## 步骤

1. 确保项目已编译：
   ```bash
   npx tsc
   ```

2. 确保 vault 已初始化（如果 `freshmind-wiki/` 不存在）：
   ```bash
   node dist/cli/index.js init
   ```

3. 执行抓取：
   ```bash
   node dist/cli/index.js crawl
   ```

4. 检查结果：
   - 如果有 `⚠️ xxx 抓取失败`，检查 `templates/sources.yaml` 中该源的 RSS URL 是否有效
   - 如果 RSS 超时，可以将 `rss` 字段设为 `null`，让 crawler 自动走 HTML 抓取
   - 去重机制会自动跳过已见过的 URL（基于 `freshmind-wiki/_meta/state.json`）

## 常见问题

- **全部 0 篇新内容**：可能是 state.json 中已记录。删除 `freshmind-wiki/_meta/state.json` 后重试
- **RSS 超时**：大文件 RSS（>500KB）容易超时，设 `rss: null` 改用 HTML 抓取
- **fetch failed**：网络波动，重试即可
