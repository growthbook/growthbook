import {
  apiCreateDecisionCriteriaBody,
  apiDecisionCriteriaValidator,
  apiUpdateDecisionCriteriaBody,
} from "shared/enterprise";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

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
  navDisplayName: "Decision Criteria",
  navDescription:
    "Rules that turn an experiment's results into a ship, rollback, or review recommendation.",
} satisfies OpenApiModelSpec;
export default decisionCriteriaApiSpec;
