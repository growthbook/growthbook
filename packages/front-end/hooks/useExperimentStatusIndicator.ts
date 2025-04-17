import {
  getHealthSettings,
  DEFAULT_DECISION_CRITERIA,
  getStatusIndicatorData,
  getPresetDecisionCriteriaForOrg,
} from "shared/enterprise";
import {
  ExperimentDataForStatusStringDates,
  DecisionCriteriaInterface,
} from "back-end/types/experiment";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";

export function useExperimentStatusIndicator() {
  const { hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const healthSettings = getHealthSettings(
    settings,
    hasCommercialFeature("decision-framework")
  );

  const decisionCriteria = getPresetDecisionCriteriaForOrg(settings);
  const { data } = useApi<{ decisionCriteria: DecisionCriteriaInterface }>(
    `/decision-criteria/${settings?.defaultDecisionCriteriaId}`,
    {
      shouldRun: () =>
        !!settings?.defaultDecisionCriteriaId && !decisionCriteria,
    }
  );

  return (
    experimentData: ExperimentDataForStatusStringDates,
    skipArchived: boolean = false
  ) =>
    getStatusIndicatorData(
      experimentData,
      skipArchived,
      healthSettings,
      decisionCriteria ?? data?.decisionCriteria ?? DEFAULT_DECISION_CRITERIA
    );
}
