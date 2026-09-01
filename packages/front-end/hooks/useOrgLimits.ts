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

  // Display-side mirror of the server's flag read (cloud only).
  const flagValue = useFeatureValue(PRICING_PHASE_1_FLAG_KEY, null);
  const limitsDisabled = isCloud() && isLimitsFlagDisabled(flagValue);

  return useMemo(() => {
    if (limitsDisabled) {
      return makeOrgLimits({ effectivePlan: effectiveAccountPlan || "oss" });
    }

    // Free limits come from the org's stamp; paid tiers resolve live.
    const tier = planTierFor(effectiveAccountPlan || "oss");
    const planLimits =
      tier && tier !== "free"
        ? resolveOrgLimitsConfig(
            isCloud() ? flagValue : null,
            DEFAULT_ORG_LIMITS[tier],
          )
        : undefined;

    return makeOrgLimits({
      effectivePlan: effectiveAccountPlan || "oss",
      orgLimits: organization?.limits,
      licenseLimits: license?.limits,
      planLimits,
    });
  }, [
    effectiveAccountPlan,
    organization?.limits,
    license?.limits,
    limitsDisabled,
    flagValue,
  ]);
}
