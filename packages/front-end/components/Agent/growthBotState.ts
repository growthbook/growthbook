// "off" includes Cloud without the AI agreement; "no-key" is self-hosted
// only; "limit" is Cloud's daily cap.
export type GrowthBotState =
  | "default"
  | "not-in-plan"
  | "off"
  | "no-key"
  | "limit";

export function getGrowthBotState({
  hasAISuggestions,
  aiSettingEnabled,
  aiUsable,
  tokenUsage,
}: {
  hasAISuggestions: boolean;
  // With the agreement accepted where needed.
  aiSettingEnabled: boolean;
  // The setting, and on self-hosted a provider API key.
  aiUsable: boolean;
  // null: no daily limit.
  tokenUsage?: { numTokensUsed: number; dailyLimit: number | null } | null;
}): GrowthBotState {
  if (!hasAISuggestions) return "not-in-plan";
  if (!aiSettingEnabled) return "off";
  if (!aiUsable) return "no-key";
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
