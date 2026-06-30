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
  const { settings, agreements } = useUser();

  const aiEnabled = isCloud()
    ? !!settings?.aiEnabled && !!agreements?.includes(AGREEMENT_TYPE_AI)
    : !!(settings?.aiEnabled && hasAnyAIKey());
  const aiAgreedTo = isCloud()
    ? !!agreements?.includes(AGREEMENT_TYPE_AI)
    : true;

  const defaultAIModel = settings?.defaultAIModel || "gpt-4o-mini";
  return { aiEnabled, defaultAIModel, aiAgreedTo };
};
