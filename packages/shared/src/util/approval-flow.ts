import isEqual from "lodash/isEqual";
import { ConditionInterface, evalCondition } from "@growthbook/growthbook";
import type {
  ApprovalEntityType,
  ApprovalFlowInterface,
} from "../validators/approval-flows";
import { EntityType } from "back-end/src/types/Audit";

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

export type RequireReviewSetting = {
  requireReviewOn: boolean;
  resetReviewOnChange: boolean;
  adminCanBypass?: boolean;
  approverRoles?: string[];
  condition?: ConditionInterface;
  officialOnly?: boolean;
};

export type ApprovalFlowSettings = {
  experiments?: RequireReviewSetting[];
  metrics?: RequireReviewSetting[];
  factTables?: RequireReviewSetting[];
};

export interface OrgSettingsInterface {
  approvalFlow?: ApprovalFlowSettings;
}

export type UserContextValue = {
  superAdmin?: boolean;
  role?: string | null;
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
}

const approvalFlowKeyMap: Record<
  ApprovalEntityType,
  keyof ApprovalFlowSettings
> = {
  experiment: "experiments",
  metric: "metrics",
  "fact-metric": "metrics",
  "fact-table": "factTables",
};

const getApprovalFlowKey = (
  entityType: ApprovalEntityType
): keyof ApprovalFlowSettings | null => {
  return approvalFlowKeyMap[entityType] ?? null;
};

const isEmptyCondition = (condition?: ConditionInterface): boolean => {
  if (!condition) return true;
  if (typeof condition === "object") {
    const keys = Object.keys(condition);
    if (keys.length === 0) return true;
    if (keys.length === 1) {
      const key = keys[0];
      const value = (condition as Record<string, unknown>)[key];
      if (Array.isArray(value) && value.length === 0) return true;
    }
  }
  return false;
};

export const canUserBypassApprovalFlow = (
  settings: OrgSettingsInterface,
  entityType: ApprovalEntityType,
  entity: Record<string, unknown>,
  userContext: UserContextValue
) => {
  if (!userContext?.superAdmin || userContext?.role !== "admin") {
    return false;
  }

  const approvalFlowKey = getApprovalFlowKey(entityType);
  if (!approvalFlowKey) {
    return false;
  }

  const approvalFlowSettings = settings?.approvalFlow?.[approvalFlowKey];
  if (!approvalFlowSettings || !approvalFlowSettings.length) {
    return false;
  }

  // Admins can bypass when the organization has enabled it and any
  // optional condition matches the original entity.
  return approvalFlowSettings.some((setting) => {
    if (!setting.adminCanBypass) return false;
    if (setting.officialOnly && !entity?.verified) return false;
    if (isEmptyCondition(setting.condition)) return true;

    return evalCondition(
      entity || {},
      setting.condition as ConditionInterface
    );
  });
};

export const requiresReview = (
  settings: OrgSettingsInterface,
  entity: Record<string, unknown>,
  entityType: ApprovalEntityType,
) => {

  const approvalFlowKey = getApprovalFlowKey(entityType);
  if (!approvalFlowKey) {
    return false;
  }

  const approvalFlowSettings = settings?.approvalFlow?.[approvalFlowKey];
  if (!approvalFlowSettings || !approvalFlowSettings.length) {
    return false;
  }

  // Admins can bypass when the organization has enabled it and any
  // optional condition matches the original entity.
  return approvalFlowSettings.some((setting) => {
    if (setting.officialOnly && !entity?.verified) return false;
    if (isEmptyCondition(setting.condition)) return true;
     
      const conditionResult = evalCondition(
        entity || {},
        setting.condition as ConditionInterface
      );
      return conditionResult;

  });
}