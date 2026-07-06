import { useMemo } from "react";
import { makeOrgLimits, OrgLimitsAccessor } from "shared/enterprise";
import { useUser } from "@/services/UserContext";

export default function useOrgLimits(): OrgLimitsAccessor {
  const { organization, license, effectiveAccountPlan } = useUser();

  return useMemo(
    () =>
      makeOrgLimits({
        effectivePlan: effectiveAccountPlan || "oss",
        orgLimits: organization?.limits,
        licenseLimits: license?.limits,
      }),
    [effectiveAccountPlan, organization?.limits, license?.limits],
  );
}
