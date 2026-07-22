import { useMemo } from "react";
import { useFeatureValue } from "@growthbook/growthbook-react";
import {
  PRICING_PHASE_1_FLAG_KEY,
  isLimitsFlagDisabled,
  makeOrgLimits,
  OrgLimitsAccessor,
} from "shared/enterprise";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";

export default function useOrgLimits(): OrgLimitsAccessor {
  const { organization, license, effectiveAccountPlan } = useUser();

  // Display-side mirror of the server's flag on/off check (cloud only).
  const flagValue = useFeatureValue(PRICING_PHASE_1_FLAG_KEY, null);
  const limitsDisabled = isCloud() && isLimitsFlagDisabled(flagValue);

  return useMemo(() => {
    if (limitsDisabled) {
      return makeOrgLimits({ effectivePlan: effectiveAccountPlan || "oss" });
    }
    return makeOrgLimits({
      effectivePlan: effectiveAccountPlan || "oss",
      orgLimits: organization?.limits,
      licenseLimits: license?.limits,
    });
  }, [
    effectiveAccountPlan,
    organization?.limits,
    license?.limits,
    limitsDisabled,
  ]);
}
