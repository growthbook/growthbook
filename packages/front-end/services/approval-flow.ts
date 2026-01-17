import { ApprovalFlow, OrganizationSettings } from "shared/types/organization";
import { ApprovalFlowInterface } from "shared/validators";
import { UserContextValue } from "./UserContext";
import { ConditionInterface,
evalCondition } from "@growthbook/growthbook";

// Entity types that can have approval flows
// This matches the frontend ApprovalEntityType
export type ApprovalEntityType = "experiment" | "fact-metric" | "fact-table" | "saved-groups";

// Map entity types to approval flow setting keys
export const getApprovalFlowKey = (
  entityType: ApprovalEntityType
): keyof ApprovalFlow | null => {
  switch (entityType) {
    case "experiment":
      return "experiments";
    case "fact-metric":
      return "metrics";
    case "fact-table":
      return "factTables";
    case "saved-groups":
      return null; // Not supported yet
    default:
      return null;
  }
};


export const canBypassApprovalFlow = (
  settings: OrganizationSettings | undefined,
  approvalFlow: ApprovalFlowInterface,
  userContext?: UserContextValue | null
): boolean => {
  // Only admins can bypass approval flows
  if (!userContext || userContext.user?.role !== "admin") {
    return false;
  }

  const approvalFlowKey = getApprovalFlowKey(approvalFlow.entityType as ApprovalEntityType);
  if (!approvalFlowKey) {
    return false;
  }

  const approvalFlowSettings = settings?.approvalFlow?.[approvalFlowKey];
  if (!Array.isArray(approvalFlowSettings)) {
    return false;
  }

  // Get the entity from originalEntity (the entity state when approval flow was created)
  const entity = approvalFlow.originalEntity;
  if (!entity) {
    return false;
  }

  // Find the matching setting and check if adminCanBypass is enabled
  return approvalFlowSettings.some((setting) => {
    // Check if adminCanBypass is enabled for this setting
    if (setting.adminCanBypass !== true) {
      return false;
    }

    // Check if approval is enabled for this setting
    if (!setting.requireReviewOn) {
      return false;
    }

    // If there's a condition, evaluate it using the GrowthBook SDK
    if (setting.condition) {
      const matches = evalCondition(entity, setting.condition as ConditionInterface);
      return matches;
    }
  });
};
