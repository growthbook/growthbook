import { AGREEMENT_TYPE_AI } from "shared/validators";
import { DEFAULT_REVISION_CONFIGURATION } from "shared/constants";
import { useUser } from "@/services/UserContext";
import { isCloud, hasAnyAIKey } from "@/services/env";

export default function useOrgSettings() {
  const { settings, hasCommercialFeature } = useUser();
  if (!hasCommercialFeature("require-approvals") && settings) {
    if (!settings.approvalFlows) return { ...settings, requireReviews: [] };

    const savedGroupApprovalFlow =
      settings.approvalFlows.savedGroups?.[0] ??
      DEFAULT_REVISION_CONFIGURATION.savedGroups[0];
    return {
      ...settings,
      requireReviews: [],
      approvalFlows: {
        ...settings.approvalFlows,
        savedGroups: [
          {
            ...savedGroupApprovalFlow,
            required: false,
          },
          ...(settings.approvalFlows.savedGroups?.slice(1) ?? []),
        ],
      },
    };
  }
  return settings;
}

export const useAISettings = (): {
  aiEnabled: boolean;
  aiAgreedTo: boolean;
  defaultAIModel: string;
} => {
  const { settings, agreements, aiKeyProviders } = useUser();

  // Self-hosted needs a key from somewhere before AI can do anything.
  // `aiKeyProviders` counts both the org's own stored keys and the back end's
  // environment variables — the front-end server's env (hasAnyAIKey) can't see
  // either reliably, so it is only a fallback for a stale org payload.
  const hasKey = aiKeyProviders.length > 0 || hasAnyAIKey();

  const aiEnabled = isCloud()
    ? !!settings?.aiEnabled && !!agreements?.includes(AGREEMENT_TYPE_AI)
    : !!(settings?.aiEnabled && hasKey);
  const aiAgreedTo = isCloud()
    ? !!agreements?.includes(AGREEMENT_TYPE_AI)
    : true;

  const defaultAIModel = settings?.defaultAIModel || "gpt-4o-mini";
  return { aiEnabled, defaultAIModel, aiAgreedTo };
};
