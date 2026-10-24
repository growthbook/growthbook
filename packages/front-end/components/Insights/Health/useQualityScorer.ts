import { useMemo } from "react";
import {
  ExperimentQualityScoreResult,
  GetQuality,
  InsightsExperiment,
  getExperimentQualityScore,
  resolveExperimentQualitySettings,
} from "shared/enterprise";
import { ORG_DEFAULT_SCOPE } from "shared/validators";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";

// Quality scores for many experiments, as useExperimentQualityScore gives one
export default function useQualityScorer(): {
  getQuality: GetQuality;
  hasFeature: boolean;
} {
  const { hasCommercialFeature } = useUser();
  const { aiEnabled } = useAISettings();
  const { getHealthSettingsForScope } = useDefinitions();
  const hasFeature = hasCommercialFeature("experiment-quality-score");

  const getQuality = useMemo<GetQuality>(() => {
    if (!hasFeature) return () => null;
    const cache = new WeakMap<
      InsightsExperiment,
      ExperimentQualityScoreResult | null
    >();
    return (experiment) => {
      if (cache.has(experiment)) return cache.get(experiment) ?? null;
      const settings = resolveExperimentQualitySettings({
        orgRecord: getHealthSettingsForScope(ORG_DEFAULT_SCOPE),
        projectRecord: experiment.project
          ? getHealthSettingsForScope(experiment.project)
          : null,
        aiEnabled,
      });
      const result = settings
        ? getExperimentQualityScore({ experiment, settings })
        : null;
      cache.set(experiment, result);
      return result;
    };
  }, [hasFeature, aiEnabled, getHealthSettingsForScope]);

  return { getQuality, hasFeature };
}
