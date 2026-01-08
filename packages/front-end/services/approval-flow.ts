import { ApprovalFlow, OrganizationSettings } from "back-end/types/organization";
import { ApprovalFlowInterface } from "@/types/approval-flow";
import { UserContextValue } from "./UserContext";

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

// Check if admin can bypass approval flow
// Returns true if:
// 1. User is an admin
// 2. At least one approval flow setting has adminCanBypass enabled for this entity type
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
  if (!Array.isArray(approvalFlowSettings) || approvalFlowSettings.length === 0) {
    return false;
  }

  // Check if any setting has adminCanBypass enabled
  // Admin bypass is a global setting for the entity type, not condition-specific
  return approvalFlowSettings.some((setting) => setting.adminCanBypass === true);
};
