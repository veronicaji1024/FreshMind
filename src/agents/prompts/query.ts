import type { Message } from '../../types.js';

const QUERY_SYSTEM_PROMPT = `基于以下 wiki 页面回答用户的问题。

注意：
- 如果引用的信息 freshness_status 不是 "fresh"，请在回答中标注 ⚠️ 并说明该信息可能已过时
- 标明信息的记录时间
- 如果 wiki 中没有足够信息，说明缺口
- 用中文回答`;

export function buildQueryPrompt(question: string, wikiPagesContent: string): Message[] {
  return [
    { role: 'system', content: QUERY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${wikiPagesContent}\n\n---\n\n用户问题：${question}`,
    },
  ];
}
