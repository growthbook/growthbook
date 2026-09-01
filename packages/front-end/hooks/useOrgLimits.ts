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
import { isCloud } from "@/services/env";

export default function useOrgLimits(): OrgLimitsAccessor {
  const { organization, license, effectiveAccountPlan } = useUser();

  // Display-side mirror of the server's flag read (cloud only). The SDK is
  // seeded with the org's accountPlan, so per-plan targeting resolves the same
  // way it does server-side.
  const flagValue = useFeatureValue(PRICING_PHASE_1_FLAG_KEY, null);

  return useMemo(() => {
    const plan = effectiveAccountPlan || "oss";

    if (isCloud() && isLimitsFlagDisabled(flagValue)) {
      return makeOrgLimits({ effectivePlan: plan });
    }

    // Free limits come from the org's stamp; paid tiers resolve live.
    const tier = planTierFor(plan);
    const planLimits =
      tier && tier !== "free"
        ? isCloud()
          ? resolveOrgLimitsConfig(flagValue, DEFAULT_ORG_LIMITS[tier])
          : DEFAULT_ORG_LIMITS[tier]
        : undefined;

    return makeOrgLimits({
      effectivePlan: plan,
      orgLimits: organization?.limits,
      licenseLimits: license?.limits,
      planLimits,
    });
  }, [effectiveAccountPlan, organization?.limits, license?.limits, flagValue]);
}
