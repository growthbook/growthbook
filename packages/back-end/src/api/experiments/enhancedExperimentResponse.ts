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
  // Remove decision if fetching an experiment to go alongside
  // results from an old phase that doesn't match the current
  // decision
  includeDecision = true,
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

  const { status, detailedStatus, needsAttention, tooltip, resultStatus } =
    getStatusIndicatorData({
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
    ...(resultStatus && includeDecision
      ? { decision: toApiExperimentDecision(resultStatus, tooltip) }
      : null),
  };

  const apiExperiment = await resolveOwnerEmail(
    await toExperimentApiInterface(context, experiment),
    context,
  );
  return { ...apiExperiment, enhancedStatus };
}
