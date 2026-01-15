import { ConditionInterface, evalCondition } from "@growthbook/growthbook";
import type { ApiReqContext } from "back-end/types/api";
import type { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import type {
  ApprovalEntityType,
  ApprovalFlowInterface,
} from "back-end/src/validators/approval-flows";
import type { ApprovalFlow } from "shared/types/organization";
import { OrganizationSettings } from "back-end/types/organization";
 
// Map entity types to their model names
export const getEntityModel = (context: ReqContext | ApiReqContext, entityType: ApprovalEntityType) => {
    switch (entityType) {
      case "fact-metric":
        return context.models.factMetrics;
      case "fact-table":
        return context.models.factTables;
      default:
        return null;
    }
  };
  
  // Map entity types to approval flow setting keys
  export const getApprovalFlowKey = (entityType: ApprovalEntityType): keyof ApprovalFlow | null => {
    switch (entityType) {
      case "experiment":
        return "experiments";
      case "fact-metric":
      case "metric":
        return "metrics";
      case "fact-table":
        return "factTables";
      default:
        return null;
    }
  };
  // Helper to check if a condition is empty/undefined
  const isEmptyCondition = (
    condition: ConditionInterface | undefined
  ): boolean => {
    if (!condition) return true;
    // Check if the condition object is empty or only has empty values
    if (typeof condition === "object") {
      const keys = Object.keys(condition);
      if (keys.length === 0) return true;
      // Check for common empty condition patterns like { $and: [] } or { $or: [] }
      if (keys.length === 1) {
        const key = keys[0];
        const value = (condition as Record<string, unknown>)[key];
        if (Array.isArray(value) && value.length === 0) return true;
      }
    }
    return false;
  };
  
  // use the approvalflow setting in organization settings to check if approval is required for the entity
  export const checkApprovalIsRequired = async (
    entityType: ApprovalEntityType,
    entityId: string,
    context: ReqContext | ApiReqContext
  ): Promise<boolean> => {
    // Get the approval flow settings key for this entity type
    const approvalFlowKey = getApprovalFlowKey(entityType);
    if (!approvalFlowKey) {
      return false;
    }
  
  const approvalFlowSettings =
    context.org.settings?.approvalFlow?.[approvalFlowKey] as
      | (RequireReview & { officialOnly?: boolean })[]
      | undefined;
    if (!approvalFlowSettings || !Array.isArray(approvalFlowSettings)) {
      return false;
    }
  
    // Check if any setting requires approval (without needing the entity yet)
    const hasAnyRequireReviewOn = approvalFlowSettings.some(
      (setting) => setting.requireReviewOn
    );
    if (!hasAnyRequireReviewOn) {
      return false;
    }
  
    // Get the entity model and fetch the entity
    const model = await getEntityModel(context, entityType);
    if (!model) {
      logger.error(`Entity model not found for entity type: ${entityType}`);
      return false;
    }
  
    const entity = await model.getById(entityId);
    if (!entity) {
      throw new Error(
        `Entity not found for entity type: ${entityType} and entity id: ${entityId}`
      );
    }
  
    // Check each setting to see if approval is required for this specific entity
    return approvalFlowSettings.some((setting) => {
      // Skip settings that don't require review
      if (!setting.requireReviewOn) {
        return false;
      }
      if (setting.officialOnly && entity.managedBy !== "admin") {
        return false;
      }
      // If there's no condition or an empty condition, approval is required for all entities
      if (isEmptyCondition(setting.condition)) {
        return true;
      }
  
        const conditionResult = evalCondition(
          entity,
          setting.condition as ConditionInterface
        );
        return conditionResult;
    });
  };
  
  // Check if a user can review an entity based on approval flow settings
  // This checks both the user's role/team AND that the entity matches the setting's project scope
  export const userCanReviewEntity = (
    entityType: ApprovalEntityType,
    context: ReqContext | ApiReqContext,
    entity: Record<string, unknown>
  ): boolean => {
    const approvalFlowKey = getApprovalFlowKey(entityType);
    if (!approvalFlowKey) {
      return false;
    }
  
    const approvalFlowSettings =
      context.org.settings?.approvalFlow?.[approvalFlowKey];
    if (!approvalFlowSettings) {
      return false;
    }
  
    return approvalFlowSettings.some((setting: ApprovalFlow) => {
      // First check if the user has permission based on approverTeams
      const userHasRolePermission =
        !setting.approverRoles ||
        setting.approverRoles.length === 0 ||
        setting.approverRoles.includes(context?.role || "");
  
      if (!userHasRolePermission) {
        return false;
      }
  
    if (!isEmptyCondition(setting.condition)) {
      const conditionResult = evalCondition(
        entity,
        setting.condition as ConditionInterface
      );
      if (!conditionResult) {
        return false;
      }
    }
    return true;
    });
  };
export const requiresResetReviewOnChange = async (entityType: ApprovalEntityType, entityId: string, context: ReqContext | ApiReqContext): Promise<boolean> => {
  const approvalFlowKey = getApprovalFlowKey(entityType);
  if (!approvalFlowKey) {
    return false;
  } 
  const model = await getEntityModel(context, entityType);
  if (!model) {
    return false;
  }
  const entity = await model.getById(entityId);
  if (!entity) {
    return false;
  }
  const approvalFlowSettings = context.org.settings?.approvalFlow?.[approvalFlowKey];
  if (!approvalFlowSettings) {
    return false;
  }
  return approvalFlowSettings.some((setting: ApprovalFlow) => {
    if (!setting.resetReviewOnChange) return false;
    if (setting.officialOnly && entity.managedBy !== "admin") {
      return false;
    }
    return evalCondition(entity, setting.condition as ConditionInterface);
  });
}
  
  export const adminCanBypassApprovalFlow = (
    context: ReqContext | ApiReqContext,
    approvalFlow: ApprovalFlowInterface,
    entity: Record<string, unknown> 
  ): boolean => {
    if (!context.superAdmin || context?.role !== "admin") {
      return false;
    }
    const approvalFlowKey = getApprovalFlowKey(approvalFlow.entityType);
    if (!approvalFlowKey) {
      throw new Error(`Approval flow key not found for entity type: ${approvalFlow.entityType}`);
    }
    const approvalFlowSettings = context.org.settings?.approvalFlow?.[approvalFlowKey];
    if (!approvalFlowSettings) {
      return false;
    }
    // check if it has conditions and if they are met as well as adminCanBypass is true
  return approvalFlowSettings.some((setting: ApprovalFlow) => {
    if (!setting.adminCanBypass) return false;
    if (!isEmptyCondition(setting.condition)) {
      return evalCondition(
        entity,
        setting.condition as ConditionInterface
      );
    }
    return true;
  });
  }
  