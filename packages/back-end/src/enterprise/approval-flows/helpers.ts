import type { ApiReqContext } from "back-end/types/api";
import type { ReqContext } from "back-end/types/request";
import type { ApprovalEntityType } from "shared/validators";

// Map entity types to their model names
// This is backend-only as it requires access to the database models
export const getEntityModel = (
  context: ReqContext | ApiReqContext,
  entityType: ApprovalEntityType
) => {
  switch (entityType) {
    case "fact-metric":
      return context.models.factMetrics;
    case "fact-table":
      return context.models.factTables;
    default:
      return null;
  }
};
  