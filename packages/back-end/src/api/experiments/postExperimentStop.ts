import {
  PRESET_DECISION_CRITERIA,
  getPresetDecisionCriteriaForOrg,
  getHealthSettings,
  getStatusIndicatorData,
} from "shared/enterprise";
import {
  ExperimentInterfaceExcludingHoldouts,
  postExperimentStopValidator,
} from "shared/validators";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { stopExperiment } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { ReqContext } from "back-end/types/request";

export const postExperimentStop = createApiRequestHandler(
  postExperimentStopValidator,
)(async (req) => {
  const { experiment, updated, isEnding } = await stopExperiment({
    context: req.context as ReqContext,
    input: {
      experimentId: req.params.id,
      results: req.body.results,
      winnerVariationId: req.body.winnerVariationId,
      releasedVariationId: req.body.releasedVariationId,
      enableTemporaryRollout: req.body.enableTemporaryRollout,
      reason: req.body.reason,
      analysis: req.body.analysis,
      dateEnded: req.body.dateEnded,
    },
  });

  await req.audit({
    event: isEnding ? "experiment.stop" : "experiment.results",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

  const settings = req.context.org.settings;
  const healthSettings = getHealthSettings(
    settings,
    orgHasPremiumFeature(req.context.org, "decision-framework"),
  );
  let decisionCriteria = getPresetDecisionCriteriaForOrg(settings);
  if (settings?.defaultDecisionCriteriaId) {
    try {
      decisionCriteria ||=
        (await req.context.models.decisionCriteria.getById(
          settings.defaultDecisionCriteriaId,
        )) ?? PRESET_DECISION_CRITERIA;
    } catch {
      // Empty catch - we fall back to the default below if the query failed.
    }
  }
  decisionCriteria ||= PRESET_DECISION_CRITERIA;

  const { status, detailedStatus } = getStatusIndicatorData(
    updated,
    false,
    healthSettings,
    decisionCriteria,
  );
  const enhancedStatus = { status, detailedStatus };

  const apiExperiment = await toExperimentApiInterface(
    req.context,
    updated as ExperimentInterfaceExcludingHoldouts,
  );
  return {
    experiment: { ...apiExperiment, enhancedStatus },
  };
});
