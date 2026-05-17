import type { Message } from '../../types.js';

const INGEST_SYSTEM_PROMPT = `你是一个 AI 行业知识管理专家。分析以下内容并提取结构化知识。

请提取以下信息并以 JSON 格式返回：

1. title: 标题（简洁概括）
2. summary: 一句话摘要
3. type: 信息类型，从以下选择一个：
   - benchmark_data（评测数据，半衰期 45 天）
   - model_capability（模型能力，半衰期 60 天）
   - product_update（产品更新，半衰期 120 天）
   - company_strategy（公司战略，半衰期 180 天）
   - industry_trend（行业趋势，半衰期 180 天）
   - person_move（人事变动，半衰期 365 天）
   - tech_concept（技术概念，半衰期 540 天）
4. verifiable_claims: 可验证的事实性声明列表，每条包含：
   - claim: 声明内容
   - search_query: 用于未来验证的搜索关键词
   - confidence: 当前置信度 0-1
5. entities: 提及的实体（公司、人物、产品名称）
6. related_concepts: 涉及的概念关键词
7. source_date: 内容的发布日期（格式 YYYY-MM-DD，如无法确定则用今天）

排除以下内容，不要标注为 verifiable_claims：
- 观点和主观判断
- 通用技术概念解释
- 修辞和比喻

输出格式：纯 JSON，不要包含 markdown 代码块标记。`;

export function buildIngestPrompt(content: string): Message[] {
  return [
    { role: 'system', content: INGEST_SYSTEM_PROMPT },
    { role: 'user', content: `分析以下内容：\n\n${content}` },
  ];
}
