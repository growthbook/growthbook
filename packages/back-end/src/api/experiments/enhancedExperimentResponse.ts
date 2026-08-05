import { getHealthSettings, getStatusIndicatorData } from "shared/enterprise";
import { ExperimentInterfaceExcludingHoldouts } from "shared/validators";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import {
  getExperimentDecisionCriteria,
  toExperimentApiInterface,
} from "back-end/src/services/experiments";
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
  // Honor the experiment's own decision criteria (falling back to the org
  // default, then the preset) so the enhanced status matches how the scheduler
  // evaluates it.
  const decisionCriteria = await getExperimentDecisionCriteria(
    context,
    experiment,
  );

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
