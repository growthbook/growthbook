import { AGREEMENT_TYPE_AI } from "shared/validators";
import { CLOUD_MANAGED_AI_MODEL } from "shared/ai";
import { DEFAULT_REVISION_CONFIGURATION } from "shared/constants";
import type { OrganizationSettings } from "shared/types/organization";
import { useUser } from "@/services/UserContext";
import { isCloud, hasAnyAIKey } from "@/services/env";

// Unlicensed orgs keep their stored rules but none of them require approval.
// Every rule, not just the first: an org can carry per-project overrides.
export function applyApprovalFlowEntitlements(
  approvalFlows: OrganizationSettings["approvalFlows"],
  hasRequireApprovals: boolean,
): OrganizationSettings["approvalFlows"] {
  if (hasRequireApprovals || !approvalFlows) return approvalFlows;
  const savedGroups = approvalFlows.savedGroups?.length
    ? approvalFlows.savedGroups
    : DEFAULT_REVISION_CONFIGURATION.savedGroups;
  return {
    ...approvalFlows,
    savedGroups: savedGroups.map((rule) => ({ ...rule, required: false })),
  };
}

export default function useOrgSettings() {
  const { settings, hasCommercialFeature } = useUser();
  if (!hasCommercialFeature("require-approvals") && settings) {
    return {
      ...settings,
      requireReviews: [],
      approvalFlows: applyApprovalFlowEntitlements(
        settings.approvalFlows,
        false,
      ),
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

  // Self-hosted needs a key from somewhere. `aiKeyProviders` counts stored keys
  // and back-end env vars; hasAnyAIKey only sees the front-end server's env, so
  // it is just a fallback for a stale org payload.
  const hasKey = aiKeyProviders.length > 0 || hasAnyAIKey();

  const aiEnabled = isCloud()
    ? !!settings?.aiEnabled && !!agreements?.includes(AGREEMENT_TYPE_AI)
    : !!(settings?.aiEnabled && hasKey);
  const aiAgreedTo = isCloud()
    ? !!agreements?.includes(AGREEMENT_TYPE_AI)
    : true;

  // Unset on Cloud means GrowthBook's managed model, not the self-hosted one.
  const defaultAIModel =
    settings?.defaultAIModel ||
    (isCloud() ? CLOUD_MANAGED_AI_MODEL : "gpt-4o-mini");
  return { aiEnabled, defaultAIModel, aiAgreedTo };
};
