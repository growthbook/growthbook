import {
  PRESET_DECISION_CRITERIA,
  getPresetDecisionCriteriaForOrg,
  getHealthSettings,
  getStatusIndicatorData,
} from "shared/enterprise";
import { ExperimentInterfaceExcludingHoldouts } from "shared/validators";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { ReqContext } from "back-end/types/request";

export async function toEnhancedExperimentApiResponse(
  context: ReqContext,
  experiment: ExperimentInterfaceExcludingHoldouts,
) {
  const settings = context.org.settings;
  const healthSettings = getHealthSettings(
    settings,
    orgHasPremiumFeature(context.org, "decision-framework"),
  );
  let decisionCriteria = getPresetDecisionCriteriaForOrg(settings);
  if (settings?.defaultDecisionCriteriaId) {
    try {
      decisionCriteria ||=
        (await context.models.decisionCriteria.getById(
          settings.defaultDecisionCriteriaId,
        )) ?? PRESET_DECISION_CRITERIA;
    } catch {
      // Empty catch - we fall back to the default below if the query failed.
    }
  }
  decisionCriteria ||= PRESET_DECISION_CRITERIA;

  const { status, detailedStatus } = getStatusIndicatorData(
    experiment,
    false,
    healthSettings,
    decisionCriteria,
  );
  const enhancedStatus = { status, detailedStatus };

  const apiExperiment = await resolveOwnerEmail(
    await toExperimentApiInterface(context, experiment),
    context,
  );
  return { ...apiExperiment, enhancedStatus };
}
