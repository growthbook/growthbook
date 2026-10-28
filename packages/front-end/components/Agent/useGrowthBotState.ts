import { useEffect } from "react";
import { useUser } from "@/services/UserContext";
import { useAITokenUsage } from "@/enterprise/hooks/useAITokenUsage";
import { useAgentPanel } from "./AgentPanelContext";
import { getGrowthBotState, GrowthBotState } from "./growthBotState";

// Past the reset time, so the server has reset the count when we ask.
const RESET_REFRESH_DELAY_MS = 1000;

export function useGrowthBotState(): {
  state: GrowthBotState;
  resetsAt: number | null;
  refreshUsage: () => void;
} {
  const { available } = useAgentPanel();
  const { effectiveAccountPlan } = useUser();
  // Only while AI is available, and only Cloud plans other than Enterprise
  // have a daily limit (getDailyTokenLimit in the back-end).
  const { data: tokenUsage, refresh: refreshUsage } = useAITokenUsage({
    enabled:
      available &&
      !!effectiveAccountPlan &&
      effectiveAccountPlan !== "enterprise",
  });
  const state = getGrowthBotState({ tokenUsage });
  const resetsAt = state === "limit" ? (tokenUsage?.nextResetAt ?? null) : null;

  // The usage is only fetched on load and focus, so a tab left open at the
  // limit would stay blocked past the reset without this.
  useEffect(() => {
    if (resetsAt === null) return;
    const timer = window.setTimeout(
      refreshUsage,
      Math.max(0, resetsAt - Date.now()) + RESET_REFRESH_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [resetsAt, refreshUsage]);

  return { state, resetsAt, refreshUsage };
}
