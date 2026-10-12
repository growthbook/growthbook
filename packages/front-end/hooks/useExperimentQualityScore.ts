import {
  ExperimentQualityScoreResult,
  getExperimentQualityScore,
  getHealthSettings,
  resolveExperimentQualityScoreSettings,
  resolveQualityScope,
} from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";

export interface ExperimentQualityScope {
  // Whether the config choice came from the experiment's Project or the
  // organization default, and which named config applies (undefined = the
  // built-in GrowthBook default)
  type: "org" | "project";
  configId?: string;
  configName?: string;
}

export interface ExperimentQualityScoreHookResult {
  result: ExperimentQualityScoreResult;
  scope: ExperimentQualityScope;
}

/**
 * Computes the quality score for an experiment. Scoring and the config
 * choice resolve field by field from the experiment's Project record and
 * the organization default's record (from definitions); the config is a
 * named ExperimentQualityConfig doc, falling back to the built-in default
 * when unset or deleted. Returns null when the org doesn't have the
 * feature or scoring is off for the experiment's scope.
 */
export default function useExperimentQualityScore(
  experiment: ExperimentInterfaceStringDates,
): ExperimentQualityScoreHookResult | null {
  const { hasCommercialFeature } = useUser();
  const orgSettings = useOrgSettings();
  const {
    getExperimentMetricById,
    getExperimentQualityConfigById,
    getHealthSettingsForScope,
  } = useDefinitions();

  if (!hasCommercialFeature("experiment-quality-score")) return null;

  const { enabled, configId, overridden } = resolveQualityScope(
    getHealthSettingsForScope(""),
    experiment.project ? getHealthSettingsForScope(experiment.project) : null,
  );
  if (!enabled) return null;

  const configDoc = configId ? getExperimentQualityConfigById(configId) : null;
  const settings = resolveExperimentQualityScoreSettings(
    // AI checks can't produce verdicts while org AI is off — exclude them
    // so their share redistributes instead of showing "pending" forever
    !orgSettings.aiEnabled
      ? { ...configDoc, aiChecksEnabled: false }
      : configDoc,
  );

  const result = getExperimentQualityScore({
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

  return {
    result,
    scope: {
      type: overridden.configId ? "project" : "org",
      configId: configDoc?.id,
      configName: configDoc?.name,
    },
  };
}
