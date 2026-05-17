# CLAUDE.md

## Language

所有回复使用中文。

## Project

FreshMind — 面向 AI PM 的自动化知识管理系统（Hackathon MVP）。

## Role

我是 Person B（智能引擎），负责：
- LLM Client、Prompt 模板、IngestAgent
- 知识半衰期 & 衰减公式、FreshnessAgent
- Tavily 搜索集成、新鲜度报告
- CLI 命令：`fm freshcheck`、`fm query`、`fm update`

## Collaboration

与 **Zixuan**（Person A：数据管道）协作开发。

### Git 规范

每次 push 前必须先 pull --rebase，避免覆盖 Zixuan 的改动：

```bash
git pull --rebase origin main
git push origin main
```
