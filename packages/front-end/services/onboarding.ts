import { DemographicData } from "shared/types/organization";

// When a user has no explicit usage intents, fall back to their role:
// Engineers most often start with feature flags, so they should not be
// pushed into the experimentation-focused onboarding by default.
export function isExperimentationLeaning(
  demographicData?: DemographicData,
): boolean {
  const intents = demographicData?.ownerUsageIntents;
  if (intents && intents.length > 0) {
    return intents.includes("experiments");
  }
  return demographicData?.ownerJobTitle !== "engineer";
}
