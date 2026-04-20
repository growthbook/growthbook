import {
  PRESET_DECISION_CRITERIA,
  getPresetDecisionCriteriaForOrg,
  getHealthSettings,
  getStatusIndicatorData,
} from "shared/enterprise";
import {
  ExperimentInterfaceExcludingHoldouts,
  postExperimentStartValidator,
} from "shared/validators";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ReqContext } from "back-end/types/request";
import { startExperiment } from "back-end/src/services/experimentChanges/changeExperimentStatus";

export const postExperimentStart = createApiRequestHandler(
  postExperimentStartValidator,
)(async (req) => {
  const { experiment, updated } = await startExperiment({
    context: req.context as ReqContext,
    experimentId: req.params.id,
    skipChecklist: req.body?.skipChecklist,
  });

  await req.audit({
    event: "experiment.start",
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

