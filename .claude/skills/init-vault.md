---
name: init-vault
description: 初始化 FreshMind wiki vault 目录结构
user_invocable: true
requires: [tsc_compiled]
fallback: "全部确定性操作，无 LLM 依赖"
deterministic_steps: ["npx tsc", "node dist/cli/index.js init"]
---

# Init Vault — 初始化 Wiki

创建 FreshMind vault 目录结构和配置文件。

## 步骤

1. 确保项目已编译：
   ```bash
   npx tsc
   ```

2. 初始化 vault：
   ```bash
   node dist/cli/index.js init
   ```
   默认创建在 `./freshmind-wiki/`，也可指定路径：
   ```bash
   node dist/cli/index.js init --vault ./my-wiki
   ```

3. 创建的目录结构：
   ```
   freshmind-wiki/
   ├── entities/      # 实体（公司、产品、人物）
   ├── concepts/      # 概念（技术、方法论）
   ├── models/        # 模型（AI模型）
   ├── comparisons/   # 对比分析
   ├── trends/        # 趋势预测
   ├── raw/           # 原始抓取数据
   ├── _meta/         # 元数据（state.json, calibration.yaml）
   ├── sources.yaml   # 信息源配置
   ├── .freshmind.yaml # 系统配置
   ├── index.md       # Wiki 索引
   └── log.md         # 操作日志
   ```
