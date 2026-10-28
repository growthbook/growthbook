// "limit" is Cloud's daily cap. The header button and the panel only exist
// while AI is available (AgentPanelContext), so there's no other state.
export type GrowthBotState = "default" | "limit";

export function getGrowthBotState({
  tokenUsage,
}: {
  // null: no daily limit.
  tokenUsage?: { numTokensUsed: number; dailyLimit: number | null } | null;
}): GrowthBotState {
  if (
    tokenUsage &&
    tokenUsage.dailyLimit !== null &&
    tokenUsage.numTokensUsed >= tokenUsage.dailyLimit
  ) {
    return "limit";
  }
  return "default";
}

// Always within a day, so never a date.
export function formatResetsIn(resetsAtMs: number, nowMs: number): string {
  const minutes = Math.ceil(Math.max(0, resetsAtMs - nowMs) / 60_000);
  if (minutes < 1) return "in less than a minute";
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `in ${hours} hour${hours === 1 ? "" : "s"}`;
}
