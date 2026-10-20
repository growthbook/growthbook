import {
  apiCreateDecisionCriteriaBody,
  apiDecisionCriteriaValidator,
  apiUpdateDecisionCriteriaBody,
} from "shared/enterprise";
import { OpenApiModelSpec } from "shared/api-model";

export const decisionCriteriaApiSpec = {
  modelSingular: "decisionCriteria",
  modelPlural: "decisionCriteria",
  pathBase: "/decision-criteria",
  apiInterface: apiDecisionCriteriaValidator,
  schemas: {
    createBody: apiCreateDecisionCriteriaBody,
    updateBody: apiUpdateDecisionCriteriaBody,
  },
  includeDefaultCrud: true,
  confirmation: {
    create: ["settings.other"],
    update: ["settings.other"],
    delete: ["settings.other"],
  },
  navDisplayName: "Decision Criteria",
  navDescription:
    "Rules that turn an experiment's results into a ship, rollback, or review recommendation.",
} satisfies OpenApiModelSpec;
export default decisionCriteriaApiSpec;
