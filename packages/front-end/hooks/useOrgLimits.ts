import { useMemo } from "react";
import { useFeatureValue } from "@growthbook/growthbook-react";
import {
  DEFAULT_ORG_LIMITS,
  PRICING_PHASE_1_FLAG_KEY,
  isLimitsFlagDisabled,
  makeOrgLimits,
  planTierFor,
  resolveOrgLimitsConfig,
  OrgLimitsAccessor,
} from "shared/enterprise";
import { useUser } from "@/services/UserContext";

export default function useOrgLimits(): OrgLimitsAccessor {
  const { organization, license, effectiveAccountPlan } = useUser();

  // Display-side mirror of the server's flag on/off check.
  const flagValue = useFeatureValue(PRICING_PHASE_1_FLAG_KEY, null);
  const limitsDisabled = isLimitsFlagDisabled(flagValue);

  return useMemo(() => {
    if (limitsDisabled) {
      return makeOrgLimits({ effectivePlan: effectiveAccountPlan || "oss" });
    }

    const tier = planTierFor(effectiveAccountPlan || "oss");
    const planLimits =
      tier && tier !== "free"
        ? resolveOrgLimitsConfig(flagValue, DEFAULT_ORG_LIMITS[tier])
        : undefined;

    return makeOrgLimits({
      effectivePlan: effectiveAccountPlan || "oss",
      orgLimits: organization?.limits,
      orgDateCreated: organization?.dateCreated,
      licenseLimits: license?.limits,
      planLimits,
    });
  }, [
    effectiveAccountPlan,
    organization?.limits,
    organization?.dateCreated,
    license?.limits,
    limitsDisabled,
    flagValue,
  ]);
}
