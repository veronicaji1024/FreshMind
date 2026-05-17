---
name: sources
description: 管理 FreshMind 信息源（查看/添加/删除/启用/禁用）
user_invocable: true
---

# Sources — 信息源管理

管理 `sources.yaml` 中的博客信息源。

## 命令

### 查看所有源
```bash
node dist/cli/index.js sources list
```

### 添加新源
```bash
node dist/cli/index.js sources add --url <url> --category <category>
```
category 可选值：tech_progress, practical, entrepreneurship, product_management, macro_analysis, tech_critique, indie_dev

### 删除源
```bash
node dist/cli/index.js sources remove <source-id>
```

### 启用/禁用
```bash
node dist/cli/index.js sources enable <source-id>
node dist/cli/index.js sources disable <source-id>
```

## 添加新源的最佳实践

1. 先确认源有可用的 RSS feed：`curl -sI <rss-url>` 检查返回 200 + content-type 含 xml
2. 如果 RSS 不可用或文件太大（>500KB），设 `rss: null`，crawler 会自动走 HTML 抓取
3. URL 应指向文章列表页（如 `/blog`、`/engineering`），不是首页
