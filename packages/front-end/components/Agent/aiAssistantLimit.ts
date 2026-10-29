/** Cloud's daily cap. A null dailyLimit means no daily limit. */
export function isAiAssistantLimitReached(
  tokenUsage:
    | { numTokensUsed: number; dailyLimit: number | null }
    | null
    | undefined,
): boolean {
  return (
    !!tokenUsage &&
    tokenUsage.dailyLimit !== null &&
    tokenUsage.numTokensUsed >= tokenUsage.dailyLimit
  );
}

/** The reset is always within a day, so this never formats a date. */
export function formatResetsIn(resetsAtMs: number, nowMs: number): string {
  const minutes = Math.ceil(Math.max(0, resetsAtMs - nowMs) / 60_000);
  if (minutes < 1) return "in less than a minute";
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `in ${hours} hour${hours === 1 ? "" : "s"}`;
}
