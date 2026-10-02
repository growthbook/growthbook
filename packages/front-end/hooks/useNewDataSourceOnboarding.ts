import { useFeatureIsOn, useGrowthBook } from "@growthbook/growthbook-react";
import { isCloud } from "@/services/env";

// Self-hosted orgs keep the existing flow until they get their own layout, so
// they never need to wait for flag values to load.
export function useNewDataSourceOnboarding(): {
  enabled: boolean;
  ready: boolean;
} {
  const growthbook = useGrowthBook();
  const enabled = useFeatureIsOn("new-data-source-onboarding");
  if (!isCloud()) return { enabled: false, ready: true };
  return { enabled, ready: !!growthbook?.ready };
}
