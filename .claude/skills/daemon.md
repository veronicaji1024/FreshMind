---
name: daemon
description: 启动自进化后台进程（定时 crawl + freshcheck + 行为 pattern 学习）
user_invocable: true
requires: [vault_initialized, tsc_compiled]
fallback: "无 API Key 时降级运行：crawl 正常执行，freshcheck 跳过，pattern 分析正常"
deterministic_steps: ["npx tsc", "node dist/cli/index.js daemon"]
---

# Daemon — 自进化后台进程

启动 FreshMind 长驻进程，自动化所有维护任务。

## 步骤

1. 确保项目已编译：
   ```bash
   npx tsc
   ```

2. 启动 daemon：
   ```bash
   node dist/cli/index.js daemon
   ```
   
   可配置间隔：
   ```bash
   node dist/cli/index.js daemon --crawl-interval 6 --freshcheck-interval 24 --analysis-interval 168
   ```

3. Ctrl+C 优雅退出

## 三个自动循环

| 周期 | 操作 | 需要 API Key？ |
|------|------|--------------|
| 每 6h | crawl + 自动 ingest | ingest 需要 SILICONFLOW_API_KEY |
| 每 24h | freshcheck + 生成报告 | 需要 SILICONFLOW_API_KEY + TAVILY_API_KEY |
| 每 168h | Pattern 分析 + 半衰期校准 | 不需要 |

## 自进化机制

- **不是每次编辑都校准**：fs.watch 只记录 EditEvent 到 `_meta/edit_events.yaml`
- **周期性分析 pattern**：积累足够事件后批量分析用户行为模式
- **阈值触发**：同类型 ≥3 次 false_negative 才缩短半衰期，≥2 次 skip_then_edit 才微调
