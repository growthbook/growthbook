import {
  PRESET_DECISION_CRITERIA,
  getPresetDecisionCriteriaForOrg,
  getHealthSettings,
  getStatusIndicatorData,
} from "shared/enterprise";
import { GetExperimentResponse } from "back-end/types/openapi";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getExperimentValidator } from "back-end/src/validators/openapi";
import { orgHasPremiumFeature } from "back-end/src/enterprise";

export const getExperiment = createApiRequestHandler(getExperimentValidator)(
  async (req): Promise<GetExperimentResponse> => {
    const experiment = await getExperimentById(req.context, req.params.id);
    if (!experiment) {
      throw new Error("Could not find experiment with that id");
    }

    const settings = req.context.org.settings;
    const healthSettings = getHealthSettings(
      settings,
      orgHasPremiumFeature(req.context.org, "decision-framework")
    );
    let decisionCriteria = getPresetDecisionCriteriaForOrg(settings);
    if (settings?.defaultDecisionCriteriaId) {
      try {
        decisionCriteria ||=
          (await req.context.models.decisionCriteria.getById(
            settings.defaultDecisionCriteriaId
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
      decisionCriteria
    );
    const enhancedStatus = { status, detailedStatus };

    const apiExperiment = await toExperimentApiInterface(
      req.context,
      experiment
    );
    return {
      experiment: { ...apiExperiment, enhancedStatus },
    };
  }
);
