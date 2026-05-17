import type { Message } from '../../types.js';

const VERIFY_SYSTEM_PROMPT = `你是一个事实核查专家。对比原始声明与最新搜索结果，判断声明的当前状态。

判断标准：
1. "confirmed" - 搜索结果确认声明仍然成立
2. "updated" - 有新发展但不完全推翻（需要补充）
3. "contradicted" - 有明确证据表明声明已过时
4. "uncertain" - 搜索结果不足以判断

返回 JSON 格式：
{
  "status": "confirmed|updated|contradicted|uncertain",
  "evidence": "判断依据的一句话总结",
  "new_info": "如果有更新，新的正确信息是什么（可选）",
  "source_url": "最相关的来源 URL（可选）"
}

输出纯 JSON，不要包含 markdown 代码块标记。`;

export function buildVerifyPrompt(
  claim: string,
  claimDate: string,
  searchResults: string,
): Message[] {
  return [
    { role: 'system', content: VERIFY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `【原始声明】（记录于 ${claimDate}）\n${claim}\n\n【最新搜索结果】\n${searchResults}`,
    },
  ];
}
