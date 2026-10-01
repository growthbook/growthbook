import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { isCloud } from "@/services/env";

// Self-hosted orgs keep the existing flow until they get their own layout.
export function useNewDataSourceOnboarding(): boolean {
  const enabled = useFeatureIsOn("new-data-source-onboarding");
  return isCloud() && enabled;
}
