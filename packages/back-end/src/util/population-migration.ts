import type { PopulationInterface, PopulationStep } from "shared/validators";

export function migratePopulation(legacyDoc: unknown): PopulationInterface {
  const doc = legacyDoc as PopulationInterface;
  // Projected reads may omit steps; do not add a missing field.
  if (!doc.steps) return doc;
  return {
    ...doc,
    steps: doc.steps.map((step) => {
      const migrated: PopulationStep & { windowSettings?: unknown } = {
        ...step,
      };
      delete migrated.windowSettings;
      return migrated;
    }),
  };
}
