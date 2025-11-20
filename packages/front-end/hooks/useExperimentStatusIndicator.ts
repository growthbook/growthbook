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
import { useDefinitions } from "@/services/DefinitionsContext";

function getExperimentDecisionCriteria({
  orgCustomDecisionCriterias,
  experimentDecisionCriteriaId,
  defaultDecisionCriteriaId,
}: {
  orgCustomDecisionCriterias: DecisionCriteriaInterface[];
  experimentDecisionCriteriaId?: string;
  defaultDecisionCriteriaId?: string;
}): DecisionCriteriaData {
  // If the experiment has a decision criteria id, use that. Otherwise, use the org's default
  const decisionCriteriaToGet =
    experimentDecisionCriteriaId ?? defaultDecisionCriteriaId;

  // return default if no decision criteria id is provided
  if (!decisionCriteriaToGet) {
    return PRESET_DECISION_CRITERIA;
  }

  const presetDecisionCriteria = PRESET_DECISION_CRITERIAS.find(
    (dc) => dc.id === decisionCriteriaToGet,
  );
  // if decision criteria is one of the presets, use that
  if (presetDecisionCriteria) {
    return presetDecisionCriteria;
  }

  // if the decision criteria is a custom one, use that
  const customDecisionCriteria = orgCustomDecisionCriterias.find(
    (dc) => dc.id === decisionCriteriaToGet,
  );
  if (customDecisionCriteria) {
    return customDecisionCriteria;
  }

  // Always fall back to main preset
  return PRESET_DECISION_CRITERIA;
}

export function useRunningExperimentStatus() {
  const { hasCommercialFeature } = useUser();
  const { decisionCriteria } = useDefinitions();
  const settings = useOrgSettings();
  const healthSettings = getHealthSettings(
    settings,
    hasCommercialFeature("decision-framework"),
  );

  return {
    getDecisionCriteria: (experimentDecisionCriteriaId?: string) =>
      getExperimentDecisionCriteria({
        orgCustomDecisionCriterias: decisionCriteria,
        experimentDecisionCriteriaId,
        defaultDecisionCriteriaId: settings?.defaultDecisionCriteriaId,
      }),
    getRunningExperimentResultStatus: (
      experimentData: ExperimentDataForStatusStringDates,
    ) =>
      getRunningExperimentResultStatus({
        experimentData,
        healthSettings,
        decisionCriteria: getExperimentDecisionCriteria({
          orgCustomDecisionCriterias: decisionCriteria,
          experimentDecisionCriteriaId:
            experimentData.decisionFrameworkSettings?.decisionCriteriaId,
          defaultDecisionCriteriaId: settings?.defaultDecisionCriteriaId,
        }),
      }),
  };
}

export function useExperimentStatusIndicator() {
  const { hasCommercialFeature } = useUser();
  const { decisionCriteria } = useDefinitions();
  const settings = useOrgSettings();
  const healthSettings = getHealthSettings(
    settings,
    hasCommercialFeature("decision-framework"),
  );

  return (
    experimentData: ExperimentDataForStatusStringDates,
    skipArchived: boolean = false,
  ) => {
    console.log("experimentData", experimentData);
    return getStatusIndicatorData(
      experimentData,
      skipArchived,
      healthSettings,
      getExperimentDecisionCriteria({
        orgCustomDecisionCriterias: decisionCriteria,
        experimentDecisionCriteriaId:
          experimentData.decisionFrameworkSettings?.decisionCriteriaId,
        defaultDecisionCriteriaId: settings?.defaultDecisionCriteriaId,
      }),
    );
  };
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
