import { useEffect } from "react";
import { useUser } from "@/services/UserContext";
import { useAITokenUsage } from "@/enterprise/hooks/useAITokenUsage";
import { useAgentPanel } from "./AgentPanelContext";
import { isAiAssistantLimitReached } from "./aiAssistantLimit";

/** Waits past the reset time, so the server has reset the count when we ask. */
const RESET_REFRESH_DELAY_MS = 1000;

export function useAiAssistantLimit(): {
  limitReached: boolean;
  resetsAt: number | null;
  refreshUsage: () => void;
} {
  const { available } = useAgentPanel();
  const { effectiveAccountPlan } = useUser();
  // Only non-Enterprise Cloud plans have a daily limit (getDailyTokenLimit in
  // the back-end).
  const { data: tokenUsage, refresh: refreshUsage } = useAITokenUsage({
    enabled:
      available &&
      !!effectiveAccountPlan &&
      effectiveAccountPlan !== "enterprise",
  });
  const limitReached = isAiAssistantLimitReached(tokenUsage);
  const resetsAt = limitReached ? (tokenUsage?.nextResetAt ?? null) : null;

  // Usage is only fetched on load and focus, so a tab left open at the limit
  // would stay blocked past the reset.
  useEffect(() => {
    if (resetsAt === null) return;
    const timer = window.setTimeout(
      refreshUsage,
      Math.max(0, resetsAt - Date.now()) + RESET_REFRESH_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [resetsAt, refreshUsage]);

  return { limitReached, resetsAt, refreshUsage };
}
