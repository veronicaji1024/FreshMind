---
title: "MCP (Model Context Protocol)"
type: tech_concept
created: 2025-12-01
last_verified: 2026-05-01
half_life_days: 540
freshness_status: fresh
confidence: 0.9
sources:
  - url: "https://www.anthropic.com/engineering/writing-tools-for-agents"
    date: 2025-10-01
  - url: "https://modelcontextprotocol.io"
    date: 2025-11-25
related:
  - "[[entities/anthropic]]"
  - "[[concepts/context-engineering]]"
tags: [协议, Anthropic, agent, 工具集成]
verifiable_claims:
  - claim: "MCP 由 Anthropic 于 2024 年 11 月开源"
    search_query: "MCP Model Context Protocol Anthropic release date"
    confidence: 0.95
    last_checked: 2026-05-01
    status: confirmed
  - claim: "Google、OpenAI、Microsoft 均已支持 MCP"
    search_query: "Google OpenAI Microsoft MCP support 2026"
    confidence: 0.85
    last_checked: 2026-05-01
    status: confirmed
---

# MCP (Model Context Protocol)

## 概述
MCP 是 Anthropic 开发的开放协议，用于标准化 LLM 应用与外部工具/数据源之间的通信。

## 核心架构
- Server-Client 模式
- 标准化的工具调用接口
- 支持多种传输协议（stdio, HTTP SSE）

## 生态现状
- 主要大模型厂商均已宣布支持
- 已捐赠给 Linux Foundation

## 相关链接
- [[entities/anthropic]]
- [[concepts/context-engineering]]
