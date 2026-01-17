import isEqual from "lodash/isEqual";
import { ConditionInterface, evalCondition } from "@growthbook/growthbook";
import type {
  ApprovalEntityType,
  ApprovalFlowEntity,
  ApprovalFlowInterface,
} from "../../validators/approval-flows";
import type { ApprovalFlow } from "shared/types/organization";

/**
 * Conflict information for a field that has been modified in both
 * the live state and the proposed changes
 */
export type Conflict = {
  field: string; // The field name that has a conflict
  baseValue: unknown; // Value at the time approval flow was created
  liveValue: unknown; // Current value in the entity
  proposedValue: unknown; // Value being proposed in this approval flow
};

/**
 * Result of checking for merge conflicts
 */
export type MergeResult = {
  success: boolean;
  conflicts: Conflict[];
  canAutoMerge: boolean;
  fieldsChanged: string[];
  mergedChanges?: Record<string, unknown>;
};

/**
 * Type definitions for approval flow settings
 */
export type RequireReviewSetting = {
  requireReviewOn?: boolean;
  resetReviewOnChange?: boolean;
  adminCanBypass?: boolean;
  approverRoles?: string[];
  condition?: ConditionInterface;
  officialOnly?: boolean;
};

export type ApprovalFlowSettings = {
  [key: string]: RequireReviewSetting[] | undefined;
};

export interface OrgSettingsInterface {
  approvalFlow?: ApprovalFlowSettings;
}

export type UserContextValue = {
  superAdmin?: boolean;
  role?: string | null;
};

/**
 * Map entity types to their approval flow setting keys in the organization settings
 */
export const getApprovalFlowKey = (
  entityType: ApprovalEntityType
): keyof ApprovalFlow | null => {
  switch (entityType) {
    case "fact-metric":
      return "metrics";
    default:
      return null;
  }
};

/**
 * Helper to check if a condition is empty/undefined
 * Empty conditions mean the rule applies to all entities
 */
export const isEmptyCondition = (
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

/**
 * Check if approval is required for an entity based on organization settings
 * @param entityType - The type of entity (fact-metric, fact-table, etc.)
 * @param entity - The entity object
 * @param approvalFlowSettings - The organization's approval flow settings
 * @returns true if approval is required, false otherwise
 */
export const requiresApprovalForEntity = (
  entityType: ApprovalEntityType,
  entity: ApprovalFlowEntity,
  approvalFlowSettings?: ApprovalFlowSettings
): boolean => {
  // Get the approval flow settings key for this entity type
  const approvalFlowKey = getApprovalFlowKey(entityType);
  if (!approvalFlowKey || !approvalFlowSettings) {
    return false;
  }

  const settings = approvalFlowSettings[approvalFlowKey];
  if (!settings || !Array.isArray(settings)) {
    return false;
  }
  const typedSettings = settings as RequireReviewSetting[];

  // Check if any setting requires approval (without needing the entity yet)
  const hasAnyRequireReviewOn = typedSettings.some(
    (setting) => setting.requireReviewOn
  );
  if (!hasAnyRequireReviewOn) {
    return false;
  }

  // Check each setting to see if approval is required for this specific entity
  return typedSettings.some((setting) => {
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

/**
 * Check if a user can review an entity based on approval flow settings
 * This checks both the user's role AND that the entity matches the setting's conditions
 * @param entityType - The type of entity
 * @param entity - The entity object
 * @param approvalFlowSettings - The organization's approval flow settings
 * @param userRole - The user's role in the organization
 * @returns true if user can review, false otherwise
 */
export const canUserReviewEntity = ({
  entityType,
  approvalFlow,
  entity,
  approvalFlowSettings,
  userRole,
  userId,
}: {
  entityType: ApprovalEntityType,
  approvalFlow: ApprovalFlowInterface,
  entity: ApprovalFlowEntity | Record<string, unknown>,
  approvalFlowSettings: ApprovalFlowSettings | undefined,
  userRole: string | null | undefined,
  userId: string,
}): boolean => {
  const approvalFlowKey = getApprovalFlowKey(entityType);
  if (!approvalFlowKey || !approvalFlowSettings) {
    return false;
  }

  const settings = approvalFlowSettings[approvalFlowKey];
  if (!settings || !Array.isArray(settings)) {
    return false;
  }
  const typedSettings = settings as RequireReviewSetting[];
  if(approvalFlow.status === "merged" || approvalFlow.status === "closed" || approvalFlow.author === userId) {
    return false;
  }
  return typedSettings.some((setting) => {
    // First check if the user has permission based on approverRoles
    const userHasRolePermission =
      !setting.approverRoles ||
      setting.approverRoles.length === 0 ||
      setting.approverRoles.includes(userRole || "");

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

/**
 * Check if changes to an entity require resetting the approval status
 * @param entityType - The type of entity
 * @param entity - The entity object
 * @param approvalFlowSettings - The organization's approval flow settings
 * @returns true if changes require reset, false otherwise
 */
export const requiresResetOnChange = (
  entityType: ApprovalEntityType,
  entity: ApprovalFlowEntity | Record<string, unknown>,
  approvalFlowSettings?: ApprovalFlowSettings
): boolean => {
  const approvalFlowKey = getApprovalFlowKey(entityType);
  if (!approvalFlowKey || !approvalFlowSettings) {
    return false;
  }

  const settings = approvalFlowSettings[approvalFlowKey];
  if (!settings || !Array.isArray(settings)) {
    return false;
  }
  const typedSettings = settings as RequireReviewSetting[];

  return typedSettings.some((setting) => {
    if (!setting.resetReviewOnChange) return false;
    if (setting.officialOnly && entity.managedBy !== "admin") {
      return false;
    }
    if (isEmptyCondition(setting.condition)) {
      return true;
    }
    return evalCondition(entity, setting.condition as ConditionInterface);
  });
};

/**
 * Check if an admin user can bypass the approval flow for an entity
 * @param entityType - The type of entity
 * @param entity - The entity object
 * @param approvalFlowSettings - The organization's approval flow settings
 * @param superAdmin - Whether the user is a super admin
 * @param userRole - The user's role in the organization
 * @returns true if admin can bypass, false otherwise
 */
export const canAdminBypassApprovalFlow = (
  entityType: ApprovalEntityType,
  entity: ApprovalFlowEntity,
  approvalFlowSettings: ApprovalFlowSettings | undefined,
  superAdmin: boolean | undefined,
  userRole: string | null | undefined
): boolean => {
  if (!superAdmin || userRole !== "admin") {
    return false;
  }

  const approvalFlowKey = getApprovalFlowKey(entityType);
  if (!approvalFlowKey || !approvalFlowSettings) {
    return false;
  }

  const settings = approvalFlowSettings[approvalFlowKey];
  if (!settings || !Array.isArray(settings)) {
    return false;
  }
  const typedSettings = settings as RequireReviewSetting[];

  // check if it has conditions and if they are met as well as adminCanBypass is true
  return typedSettings.some((setting) => {
    if (!setting.adminCanBypass) return false;
    if (!isEmptyCondition(setting.condition)) {
      return evalCondition(entity, setting.condition as ConditionInterface);
    }
    return true;
  });
};

/**
 * Check for merge conflicts on-the-fly
 * Compares: base (when approval flow was created) vs live (current state) vs proposed
 *
 * @param baseState - Entity state at baseVersion (when approval flow was created)
 * @param liveState - Current entity state
 * @param proposedChanges - Changes proposed in the approval flow
 * @returns MergeResult with conflict information and merged changes if possible
 */
export function checkMergeConflicts(
  baseState: Record<string, unknown>,
  liveState: Record<string, unknown>,
  proposedChanges: Record<string, unknown>
): MergeResult {
  const conflicts: Conflict[] = [];
  const fieldsChanged: string[] = [];
  const mergedChanges: Record<string, unknown> = { ...liveState };

  // Get all fields in proposed changes
  for (const field of Object.keys(proposedChanges)) {
    const baseValue = baseState[field];
    const liveValue = liveState[field];
    const proposedValue = proposedChanges[field];

    // Check if both live and proposed changed the same field from base
    const liveChanged = !isEqual(baseValue, liveValue);
    const proposedChanged = !isEqual(baseValue, proposedValue);

    if (liveChanged && proposedChanged) {
      // Conflict exists if they changed it to different values
      if (!isEqual(liveValue, proposedValue)) {
        conflicts.push({
          field,
          baseValue,
          liveValue,
          proposedValue,
        });
      } else {
        // Both changed to the same value - no conflict
        fieldsChanged.push(field);
      }
    } else if (proposedChanged) {
      // Only proposed changed - can auto-merge
      mergedChanges[field] = proposedValue;
      fieldsChanged.push(field);
    }
    // If only live changed, keep the live value (already in mergedChanges)
  }

  return {
    success: conflicts.length === 0,
    conflicts,
    canAutoMerge: conflicts.length === 0,
    fieldsChanged,
    mergedChanges: conflicts.length === 0 ? mergedChanges : undefined,
  };
};

