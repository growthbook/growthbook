import { ExperimentInterface } from "../../types/experiment";

export const CURRENT_SCHEMA_VERSION = 1;

export function upgradeExperiment(experiment: ExperimentInterface) {
  // Put version upgrade functions here in order
  upgradeToV1(experiment);
}

function upgradeToV1(experiment: ExperimentInterface) {
  // Skip if it's already updated
  if (experiment.version && experiment.version >= 1) return;

  experiment.version = 1;

  // Add id and key to every variation
  experiment.variations.forEach((v, i) => {
    if (v.key === "" || v.key === undefined || v.key === null) {
      v.key = i + "";
    }
    if (!v.id) {
      v.id = experiment.id + "_var_" + i;
    }
  });

  // Populate phase names and migrate variationWeights to trafficSplit
  if (experiment.phases) {
    experiment.phases.forEach((phase) => {
      if (!phase.name) {
        const p = phase.phase || "main";
        phase.name = p.substring(0, 1).toUpperCase() + p.substring(1);
      }

      if (!phase.trafficSplit?.length) {
        phase.trafficSplit = experiment.variations.map((v, i) => ({
          variation: v.id,
          weight:
            phase.variationWeights?.[i] || 1 / experiment.variations.length,
        }));
      }
    });
  }
}
