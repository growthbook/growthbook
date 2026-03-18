import { RevisionTargetType } from "shared/enterprise";
import type { ApiReqContext } from "back-end/types/api";
import type { ReqContext } from "back-end/types/request";

// Map entity types to their model names
// This is backend-only as it requires access to the database models
export const getEntityModel = (
  context: ReqContext | ApiReqContext,
  entityType: RevisionTargetType,
) => {
  switch (entityType) {
    case "saved-group":
      return context.models.savedGroups;
    default: {
      // Exhaustiveness check: TypeScript will error if a new RevisionTargetType is added
      // without updating this switch statement
      const _exhaustive: never = entityType;
      return null;
    }
  }
};
