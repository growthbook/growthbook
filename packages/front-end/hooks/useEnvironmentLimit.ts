import { DEFAULT_ENVIRONMENT_IDS } from "shared/util";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";

// Pricing Phase 1: environment allowance. Under the default-only policy new
// environments may only use ids from DEFAULT_ENVIRONMENT_IDS; existing custom
// environments stay editable (soft enforcement, matching the back-end's
// assertEnvironmentCreateAllowed).
export function useEnvironmentLimit() {
  const { planLimits } = useUser();
  const environments = useEnvironments();

  const defaultOnly = planLimits.environmentPolicy === "default-only";
  const missingDefaultIds = DEFAULT_ENVIRONMENT_IDS.filter(
    (id) => !environments.some((e) => e.id === id),
  );

  return {
    defaultOnly,
    missingDefaultIds,
    // No creatable environment ids remain under the current policy
    atLimit: defaultOnly && missingDefaultIds.length === 0,
  };
}
