import { useMemo } from "react";
import {
  ExperimentQualityScoreResult,
  getExperimentQualityScore,
  resolveExperimentQualitySettings,
} from "shared/enterprise";
import { ORG_DEFAULT_SCOPE } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";

/**
 * The quality score for an experiment, or null when the org doesn't have
 * the feature or scoring is off for the experiment's scope.
 */
export default function useExperimentQualityScore(
  experiment: ExperimentInterfaceStringDates,
): ExperimentQualityScoreResult | null {
  const { hasCommercialFeature } = useUser();
  const { aiEnabled } = useAISettings();
  const { getHealthSettingsForScope } = useDefinitions();
  const hasFeature = hasCommercialFeature("experiment-quality-score");

  return useMemo(() => {
    if (!hasFeature) return null;
    const settings = resolveExperimentQualitySettings({
      orgRecord: getHealthSettingsForScope(ORG_DEFAULT_SCOPE),
      projectRecord: experiment.project
        ? getHealthSettingsForScope(experiment.project)
        : null,
      aiEnabled,
    });
    if (!settings) return null;

    return getExperimentQualityScore({ experiment, settings });
  }, [hasFeature, aiEnabled, experiment, getHealthSettingsForScope]);
}
