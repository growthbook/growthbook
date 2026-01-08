import { z } from "zod";
import { ConditionInterface,
evalCondition } from "@growthbook/growthbook";
import { baseSchema } from "back-end/src/models/BaseModel";
import { ReqContext, ApprovalFlow } from "back-end/types/organization";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";
import { findAllSdkWebhooksByConnectionIds } from "../models/WebhookModel";

// Approval flow statuses (similar to GitHub PR states)
export const approvalFlowStatusArray = [
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
  "merged",
  "closed",
] as const;
export type ApprovalFlowStatus = (typeof approvalFlowStatusArray)[number];

// Review decision types
export const reviewDecisionArray = [
  "approve",
  "request-changes",
  "comment",
] as const;
export type ReviewDecision = (typeof reviewDecisionArray)[number];

// Entity types that can have approval flows
export const approvalEntityTypeArray = [
  "experiment",
  "fact-metric",
  "fact-table",
  "metric",
] as const;
export type ApprovalEntityType = (typeof approvalEntityTypeArray)[number];

// Review/Comment validator
export const reviewValidator = z.object({
  id: z.string(),
  userId: z.string(),
  decision: z.enum(reviewDecisionArray),
  comment: z.string(),
  createdAt: z.date(),
});

// The actual changes being proposed
// This is a flexible object that can contain different fields based on the entity type
export const proposedChangesValidator = z.record(z.unknown());

// Activity log entry (for timeline/history)
export const activityLogEntryValidator = z.object({
  id: z.string(),
  userId: z.string(),
  action: z.enum([
    "created",
    "updated",
    "reviewed",
    "approved",
    "requested-changes",
    "commented",
    "merged",
    "closed",
    "reopened",
  ]),
  details: z.string().optional(),
  createdAt: z.date(),
});



export const approvalFlowCreateValidator = z.object({
  entityType: z.enum(approvalEntityTypeArray),
  entityId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  proposedChanges: proposedChangesValidator,
});
export type ApprovalFlowCreateInterface = z.infer<typeof approvalFlowCreateValidator>;

// Main approval flow schema
const approvalFlowBaseValidator = approvalFlowCreateValidator.extend({
  status: z.enum(approvalFlowStatusArray).default("pending-review"),
  author: z.string(),
  reviews: z.array(reviewValidator),
  activityLog: z.array(activityLogEntryValidator),
  mergedAt: z.date().optional(),
  closedAt: z.date().optional(),
  mergedBy: z.string().optional(),
  closedBy: z.string().optional(),
  originalEntity: z.record(z.unknown()),

});

export const approvalFlowValidator = baseSchema
  .extend(approvalFlowBaseValidator.shape)
  .strict();

export type ApprovalFlowInterface = z.infer<typeof approvalFlowValidator>;
export type Review = z.infer<typeof reviewValidator>;
export type ProposedChanges = z.infer<typeof proposedChangesValidator>;
export type ActivityLogEntry = z.infer<typeof activityLogEntryValidator>;

// Conflict information computed on-the-fly (not stored)
export type Conflict = {
  field: string; // The field name that has a conflict
  baseValue: unknown; // Value at the time approval flow was created
  liveValue: unknown; // Current value in the entity
  proposedValue: unknown; // Value being proposed in this approval flow
};

// Merge result computed on-the-fly
export type MergeResult = {
  success: boolean;
  conflicts: Conflict[];
  canAutoMerge: boolean;
  fieldsChanged: string[];
  mergedChanges?: Record<string, unknown>;
};

// Map entity types to their model names
export const getEntityModel = (context: ReqContext | ApiReqContext, entityType: ApprovalEntityType) => {
  switch (entityType) {
    case "experiment":
      return context.models.experiment;
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
    context.org.settings?.approvalFlow?.[approvalFlowKey];
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

    // If there's no condition or an empty condition, approval is required for all entities
    if (isEmptyCondition(setting.condition)) {
      return true;
    }

    // Evaluate the condition against the entity
    // We've already checked that the condition is not empty above
    try {
      const conditionResult = evalCondition(
        entity,
        setting.condition as ConditionInterface
      );
      return conditionResult;
    } catch (error) {
      // If condition evaluation fails, log and skip this rule (don't require approval)
      logger.error(
        `Error evaluating condition for entity type: ${entityType} and entity id: ${entityId}`,
        error
      );
      return false;
    }
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

  // Get the entity's project (entities typically have a 'project' field)
  const entityProject = entity?.project as string | undefined;

  return approvalFlowSettings.some((setting) => {
    // First check if the user has permission based on approverTeams
    const userHasTeamPermission =
      !setting.approverTeams ||
      setting.approverTeams.length === 0 ||
      setting.approverTeams.includes(context.role || "");

    if (!userHasTeamPermission) {
      return false;
    }


    if (setting.projects && setting.projects.length > 0) {

      if (!entityProject || !setting.projects.includes(entityProject)) {
        return false;
      }
    }

    // Check condition-based scoping (advanced targeting)
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

export const adminCanBypassApprovalFlow = (
  context: ReqContext | ApiReqContext,
  approvalFlow: ApprovalFlowInterface
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
  return approvalFlowSettings.some((setting) => setting.adminCanBypass === true && ( !setting.condition || (setting.condition && evalCondition(approvalFlow.originalEntity, setting.condition))));
}
