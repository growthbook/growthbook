import { useMemo } from "react";
import {
  ExperimentQualityScoreResult,
  getExperimentQualityScore,
  getGoalMetricNames,
  resolveExperimentQualitySettings,
} from "shared/enterprise";
import { ORG_DEFAULT_SCOPE } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";

export interface ExperimentQualityScoreHookResult {
  result: ExperimentQualityScoreResult;
  // undefined = the built-in GrowthBook default configuration
  configName?: string;
}

/**
 * The quality score for an experiment, or null when the org doesn't have
 * the feature or scoring is off for the experiment's scope.
 */
export default function useExperimentQualityScore(
  experiment: ExperimentInterfaceStringDates,
): ExperimentQualityScoreHookResult | null {
  const { hasCommercialFeature } = useUser();
  const { aiEnabled } = useAISettings();
  const {
    getExperimentMetricById,
    getExperimentQualityConfigById,
    getHealthSettingsForScope,
  } = useDefinitions();
  const hasFeature = hasCommercialFeature("experiment-quality-score");

  return useMemo(() => {
    if (!hasFeature) return null;
    const resolved = resolveExperimentQualitySettings({
      orgRecord: getHealthSettingsForScope(ORG_DEFAULT_SCOPE),
      projectRecord: experiment.project
        ? getHealthSettingsForScope(experiment.project)
        : null,
      getConfig: getExperimentQualityConfigById,
      aiEnabled,
    });
    if (!resolved) return null;

    const result = getExperimentQualityScore({
      experiment,
      settings: resolved.settings,
      goalMetricNames: getGoalMetricNames(
        experiment.goalMetrics,
        (id) => getExperimentMetricById(id)?.name,
      ),
    });
    return {
      result,
      configName: resolved.configId
        ? getExperimentQualityConfigById(resolved.configId)?.name
        : undefined,
    };
  }, [
    hasFeature,
    aiEnabled,
    experiment,
    getHealthSettingsForScope,
    getExperimentQualityConfigById,
    getExperimentMetricById,
  ]);
}
