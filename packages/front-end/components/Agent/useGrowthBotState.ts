import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useAITokenUsage } from "@/enterprise/hooks/useAITokenUsage";
import { getGrowthBotState, GrowthBotState } from "./growthBotState";

// The GrowthBot button's state for this org (growthBotState.ts), and when
// Cloud's daily limit resets, if it's been reached.
export function useGrowthBotState(): {
  state: GrowthBotState;
  resetsAt: number | null;
} {
  const { hasCommercialFeature, settings, effectiveAccountPlan } = useUser();
  const { aiEnabled, aiAgreedTo } = useAISettings();
  // Only orgs with a daily limit can reach it: Cloud plans other than
  // Enterprise, which is uncapped (getDailyTokenLimit in the back-end).
  // Null elsewhere, and while the plan loads.
  const { data: tokenUsage } = useAITokenUsage({
    enabled: !!effectiveAccountPlan && effectiveAccountPlan !== "enterprise",
  });
  const state = getGrowthBotState({
    hasAISuggestions: hasCommercialFeature("ai-suggestions"),
    // As the AI settings page's checkbox: the setting, with the agreement.
    aiSettingEnabled: !!settings?.aiEnabled && aiAgreedTo,
    aiUsable: aiEnabled,
    tokenUsage,
  });
  return {
    state,
    resetsAt: state === "limit" ? (tokenUsage?.nextResetAt ?? null) : null,
  };
}
