import { LLMClient } from './llm-client.js';
import { buildVerifyPrompt } from './prompts/index.js';
import { TavilySearch } from '../search/tavily.js';
import type { FreshnessEntry, VerifiableClaim, VerificationResult } from '../types.js';

export class FreshnessAgent {
  constructor(
    private llm: LLMClient,
    private search: TavilySearch,
  ) {}

  async verifyClaim(
    claim: VerifiableClaim,
    claimDate: string,
  ): Promise<VerificationResult> {
    // 1. Web 搜索
    const searchResults = await this.search.search(claim.search_query, 3);

    // 2. 搜索无结果时直接返回 uncertain，跳过 LLM 调用
    if (searchResults.length === 0) {
      return {
        claim: claim.claim,
        status: 'uncertain',
        evidence: '无法找到相关搜索结果，跳过验证',
      };
    }

    // 3. 格式化搜索结果
    const formattedResults = searchResults
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}\n来源: ${r.url}`)
      .join('\n\n');

    // 4. LLM 判断
    const messages = buildVerifyPrompt(claim.claim, claimDate, formattedResults);
    const result = await this.llm.chatJSON<VerificationResult>(messages);

    return {
      claim: claim.claim,
      status: result.status ?? 'uncertain',
      evidence: result.evidence ?? '无法获取判断依据',
      new_info: result.new_info,
      source_url: result.source_url,
    };
  }

  async check(
    entries: FreshnessEntry[],
  ): Promise<(FreshnessEntry & { verification: VerificationResult[] })[]> {
    const results: (FreshnessEntry & { verification: VerificationResult[] })[] = [];

    for (const entry of entries) {
      const claims = entry.meta.verifiable_claims ?? [];
      const verifications: VerificationResult[] = [];

      for (const claim of claims) {
        try {
          const result = await this.verifyClaim(claim, entry.meta.last_verified);
          verifications.push(result);
        } catch (err) {
          // 单条 claim 验证失败不阻塞其他
          verifications.push({
            claim: claim.claim,
            status: 'uncertain',
            evidence: `验证失败: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      results.push({ ...entry, verification: verifications });
    }

    return results;
  }
}
