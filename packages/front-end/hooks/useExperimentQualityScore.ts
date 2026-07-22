import {
  ExperimentQualityScoreResult,
  getExperimentQualityScore,
  getHealthSettings,
  resolveExperimentQualityScoreSettings,
} from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";

/**
 * Computes the quality score for an experiment from org settings and the
 * experiment's own fields (plus any cached AI verdicts on the doc).
 * Returns null when the org doesn't have the feature or hasn't enabled it.
 */
export default function useExperimentQualityScore(
  experiment: ExperimentInterfaceStringDates,
): ExperimentQualityScoreResult | null {
  const { hasCommercialFeature } = useUser();
  const orgSettings = useOrgSettings();
  const { getExperimentMetricById } = useDefinitions();

  if (!hasCommercialFeature("experiment-quality-score")) return null;

  const settings = resolveExperimentQualityScoreSettings(
    orgSettings.experimentQualityScoreSettings,
  );
  if (!settings.enabled) return null;

  return getExperimentQualityScore({
    experiment,
    settings,
    healthSettings: getHealthSettings(
      orgSettings,
      hasCommercialFeature("decision-framework"),
    ),
    goalMetricNames: experiment.goalMetrics.map(
      (id) => getExperimentMetricById(id)?.name ?? id,
    ),
  });
}
