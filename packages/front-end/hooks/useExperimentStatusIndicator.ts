import {
  getHealthSettings,
  getExperimentResultStatus,
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
  getStatusIndicatorData,
} from "shared/enterprise";
import {
  DecisionCriteriaData,
  DecisionCriteriaInterface,
  ExperimentDataForStatusStringDates,
  ExperimentHealthSettings,
} from "back-end/types/experiment";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";

export function useExperimentDecisionCriteria() {
  const settings = useOrgSettings();
  const decisionCriteria = !settings?.defaultDecisionCriteriaId
    ? PRESET_DECISION_CRITERIA
    : PRESET_DECISION_CRITERIAS.find(
        (dc) => dc.id === settings.defaultDecisionCriteriaId
      );
  const { data } = useApi<{ decisionCriteria: DecisionCriteriaInterface }>(
    `/decision-criteria/${settings?.defaultDecisionCriteriaId}`,
    {
      shouldRun: () =>
        !!settings?.defaultDecisionCriteriaId && !decisionCriteria,
    }
  );
  return data?.decisionCriteria ?? decisionCriteria ?? PRESET_DECISION_CRITERIA;
}

export function useRunningExperimentStatus() {
  const { hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const healthSettings = getHealthSettings(
    settings,
    hasCommercialFeature("decision-framework")
  );

  const decisionCriteria = useExperimentDecisionCriteria();

  return {
    decisionCriteria,
    getRunningExperimentResultStatus: (
      experimentData: ExperimentDataForStatusStringDates
    ) =>
      getRunningExperimentResultStatus({
        experimentData,
        healthSettings,
        decisionCriteria,
      }),
  };
}

export function useExperimentStatusIndicator() {
  const { hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const healthSettings = getHealthSettings(
    settings,
    hasCommercialFeature("decision-framework")
  );

  const decisionCriteria = useExperimentDecisionCriteria();
  return (
    experimentData: ExperimentDataForStatusStringDates,
    skipArchived: boolean = false
  ) =>
    getStatusIndicatorData(
      experimentData,
      skipArchived,
      healthSettings,
      decisionCriteria
    );
}

function getRunningExperimentResultStatus({
  experimentData,
  healthSettings,
  decisionCriteria,
}: {
  experimentData: ExperimentDataForStatusStringDates;
  healthSettings: ExperimentHealthSettings;
  decisionCriteria: DecisionCriteriaData;
}) {
  if (experimentData.status !== "running") {
    return undefined;
  }
  return getExperimentResultStatus({
    experimentData,
    healthSettings,
    decisionCriteria,
  });
}
