import { estimateAICompletionUsd } from "back-end/src/services/aiCost";
import { addUsage, callUsage, emptyUsage, type Usage } from "./record";

// Token usage the in-app agent reports through GrowthBook's own AI usage
// tracking, keyed by org. Every trial has its own org, so concurrent trials
// never mix their totals.
const byOrg = new Map<string, Usage>();

export interface TrackedAIUsage {
  organizationId: string;
  model: string;
  numPromptTokensUsed?: number;
  numCompletionTokensUsed?: number;
  numCacheReadTokens?: number;
  numCacheWriteTokens?: number;
  spendUsd?: number;
}

export function recordAgentUsage(event: TrackedAIUsage): void {
  // A turn parked on a confirm card is aborted, so GrowthBook records no
  // spend for it; its tokens are still known, so price them here.
  const spend =
    event.spendUsd ??
    estimateAICompletionUsd(event.model, {
      inputTokens: event.numPromptTokensUsed,
      outputTokens: event.numCompletionTokensUsed,
      cacheReadTokens: event.numCacheReadTokens,
      cacheWriteTokens: event.numCacheWriteTokens,
    });
  byOrg.set(
    event.organizationId,
    addUsage(
      byOrg.get(event.organizationId) ?? emptyUsage(),
      callUsage(
        event.numPromptTokensUsed,
        event.numCompletionTokensUsed,
        spend,
      ),
    ),
  );
}

export function takeAgentUsage(orgId: string): Usage {
  const usage = byOrg.get(orgId) ?? emptyUsage();
  byOrg.delete(orgId);
  return usage;
}
