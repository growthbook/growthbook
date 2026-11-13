import { getStatusIndicatorData } from "shared/enterprise";
import { ExperimentInterfaceExcludingHoldouts } from "shared/validators";
import {
  getExperimentDecisionCriteria,
  getHealthSettingsForOrg,
  toExperimentApiInterface,
} from "back-end/src/services/experiments";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { ReqContext } from "back-end/types/request";
import { toApiExperimentDecision } from "./experimentDecision";

export async function toEnhancedExperimentApiResponse(
  context: ReqContext,
  experiment: ExperimentInterfaceExcludingHoldouts,
) {
  const healthSettings = getHealthSettingsForOrg(context);
  // Honor the experiment's own decision criteria (falling back to the org
  // default, then the preset) so the enhanced status matches how the scheduler
  // evaluates it.
  const decisionCriteria = await getExperimentDecisionCriteria(
    context,
    experiment,
  );
  const metricGroups = await context.models.metricGroups.getAll();

  const {
    status,
    detailedStatus,
    needsAttention,
    decisionCategory,
    tooltip,
    resultStatus,
  } = getStatusIndicatorData({
    experimentData: experiment,
    skipArchived: false,
    healthSettings,
    decisionCriteria,
    metricGroups,
  });
  const enhancedStatus = {
    status,
    detailedStatus,
    needsAttention: !!needsAttention,
    // A result status always comes with its category.
    ...(resultStatus && decisionCategory
      ? {
          decision: toApiExperimentDecision(
            resultStatus,
            decisionCategory,
            tooltip,
          ),
        }
      : null),
  };

  const apiExperiment = await resolveOwnerEmail(
    await toExperimentApiInterface(context, experiment),
    context,
  );
  return { ...apiExperiment, enhancedStatus };
}
