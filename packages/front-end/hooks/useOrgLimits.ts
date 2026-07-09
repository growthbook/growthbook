import { useMemo } from "react";
import { useFeatureValue } from "@growthbook/growthbook-react";
import {
  PRICING_PHASE_1_FLAG_KEY,
  isLimitsFlagDisabled,
  makeOrgLimits,
  OrgLimitsAccessor,
} from "shared/enterprise";
import { useUser } from "@/services/UserContext";

export default function useOrgLimits(): OrgLimitsAccessor {
  const { organization, license, effectiveAccountPlan } = useUser();

  // Enforcement on/off from the same flag that stamps new orgs: a base value
  // of `enabled: false` (global kill switch) or a targeting rule serving it
  // for this org (per-customer exemption) lifts all limits. The FE evaluates
  // with the org attributes set in UserContext; the back-end enforces the
  // same check server-side, so this is display alignment, not security.
  const flagValue = useFeatureValue(PRICING_PHASE_1_FLAG_KEY, null);
  const limitsDisabled = isLimitsFlagDisabled(flagValue);

  return useMemo(() => {
    if (limitsDisabled) {
      // No stored/license limits passed ⇒ the accessor resolves to unlimited
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
