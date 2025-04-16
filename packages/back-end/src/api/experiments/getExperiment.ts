import {
  DEFAULT_DECISION_CRITERIA,
  getDefaultDecisionCriteriaForOrg,
  getHealthSettings,
  getStatusIndicatorData,
  StatusIndicatorData,
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

    let statusData:
      | Pick<StatusIndicatorData, "status" | "detailedStatus">
      | undefined;

    if (orgHasPremiumFeature(req.context.org, "decision-framework")) {
      const settings = req.context.org.settings;
      const healthSettings = getHealthSettings(settings, true);
      let decisionCriteria = getDefaultDecisionCriteriaForOrg(settings);
      if (settings?.defaultDecisionCriteriaId) {
        try {
          decisionCriteria ||=
            (await req.context.models.decisionCriteria.getById(
              settings!.defaultDecisionCriteriaId!
            )) ?? DEFAULT_DECISION_CRITERIA;
        } catch {
          // Empty catch
        }
      }
      decisionCriteria ||= DEFAULT_DECISION_CRITERIA;

      {
        statusData = (({ status, detailedStatus }) => ({
          status,
          detailedStatus,
        }))(
          getStatusIndicatorData(
            experiment,
            false,
            healthSettings,
            decisionCriteria
          )
        );
      }
    }

    const apiExperiment = await toExperimentApiInterface(
      req.context,
      experiment,
      statusData
    );
    return {
      experiment: apiExperiment,
    };
  }
);
