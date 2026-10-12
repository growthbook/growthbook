import {
  ExperimentQualityScoreResult,
  getExperimentQualityScore,
  getHealthSettings,
  resolveExperimentQualityScoreSettings,
  resolveQualityEnabled,
} from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";

export interface ExperimentQualityScope {
  // Whether the config reference came from the experiment's Project or the
  // org default, and which named config applies (undefined = the built-in
  // GrowthBook default)
  type: "org" | "project";
  configId?: string;
  configName?: string;
}

export interface ExperimentQualityScoreHookResult {
  result: ExperimentQualityScoreResult;
  scope: ExperimentQualityScope;
}

/**
 * Computes the quality score for an experiment. Scoring is gated by the
 * org pointer with a per-project tri-state override; the config body is a
 * named ExperimentQualityConfig doc referenced by id (from definitions),
 * falling back to the built-in default when unset or dangling. Returns
 * null when the org doesn't have the feature or scoring is off for the
 * experiment's scope.
 */
export default function useExperimentQualityScore(
  experiment: ExperimentInterfaceStringDates,
): ExperimentQualityScoreHookResult | null {
  const { hasCommercialFeature } = useUser();
  const orgSettings = useOrgSettings();
  const {
    getExperimentMetricById,
    getProjectById,
    getExperimentQualityConfigById,
  } = useDefinitions();

  if (!hasCommercialFeature("experiment-quality-score")) return null;

  const orgPointer = orgSettings.experimentQuality;
  const project = experiment.project
    ? getProjectById(experiment.project)
    : null;
  const projectPointer = project?.settings?.experimentQuality;

  if (!resolveQualityEnabled(orgPointer, projectPointer)) return null;

  const configId = projectPointer?.configId ?? orgPointer?.configId;
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
      type: projectPointer?.configId ? "project" : "org",
      configId: configDoc?.id,
      configName: configDoc?.name,
    },
  };
}
