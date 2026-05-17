---
name: rebuild-index
description: 重建 wiki 的 index.md 索引文件
user_invocable: true
requires: [vault_initialized, tsc_compiled]
fallback: "全部确定性操作，无 LLM 依赖"
deterministic_steps: ["npx tsc", "node -e \"import('./dist/wiki/index-manager.js').then(m => m.rebuildIndex('./freshmind-wiki'))\""]
---

# Rebuild Index — 重建 Wiki 索引

扫描 vault 中所有 wiki 页面，重新生成 `index.md`。

## 步骤

1. 确保项目已编译：
   ```bash
   npx tsc
   ```

2. 执行重建：
   ```bash
   node -e "import { rebuildIndex } from './dist/wiki/index-manager.js'; rebuildIndex('./freshmind-wiki').then(() => console.log('done'))"
   ```

3. 检查 `freshmind-wiki/index.md` 输出是否正确

## 索引内容

- 按目录分组（entities, concepts, models, comparisons, trends）
- 每个页面显示：名称、类型、保鲜状态、上次验证时间
- 底部列出需要关注的过期/过时页面
