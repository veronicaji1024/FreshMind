import type { Message } from '../../types.js';

export function buildUpdatePrompt(
  pageTitle: string,
  existingContent: string,
  searchResults: string,
): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个知识库更新助手。你需要根据最新搜索结果，判断现有知识页面是否需要更新，并生成更新摘要。

请返回 JSON 格式：
{
  "needs_update": true/false,
  "summary": "更新摘要（简洁描述发生了什么变化）",
  "updated_claims": [
    {
      "original": "原始声明",
      "updated": "更新后的声明（如果有变化）",
      "status": "confirmed | updated | contradicted"
    }
  ]
}

规则：
- 只关注有实质性变化的信息
- 如果搜索结果没有新信息，needs_update 设为 false
- summary 用中文，简洁明了`,
    },
    {
      role: 'user',
      content: `## 页面：${pageTitle}

### 现有内容
${existingContent}

### 最新搜索结果
${searchResults}

请分析现有内容是否需要更新。`,
    },
  ];
}
