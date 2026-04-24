import type { FeatureRule, FeaturePrerequisite } from "shared/validators";
import {
  apiRevisionRampCreateAction,
  RevisionRampCreateAction,
  ACTIVE_DRAFT_STATUSES,
  inlineRampScheduleInput,
} from "shared/validators";
import { z } from "zod";
import { validateCondition } from "shared/util";
import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import { getSavedGroupMap } from "back-end/src/services/features";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  createRevision,
  discardRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { validateCustomFieldsForSection } from "back-end/src/util/custom-fields";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { ApiReqContext } from "back-end/types/api";

export { inlineRampScheduleInput };

type InlineRampScheduleInput = z.infer<typeof inlineRampScheduleInput>;

// targetId is a placeholder — real UUID is injected at publish time.
function normalizeRevisionRampCreateAction(
  input: z.infer<typeof apiRevisionRampCreateAction>,
): RevisionRampCreateAction {
  return {
    ...input,
    steps: (input.steps ?? []).map((s) => ({
      trigger: s.trigger,
      actions: (s.actions ?? []).map((a) => ({
        targetType: a.targetType ?? ("feature-rule" as const),
        targetId: a.targetId ?? "",
        patch:
          a.patch as RevisionRampCreateAction["steps"][number]["actions"][number]["patch"],
      })),
      approvalNotes: s.approvalNotes ?? undefined,
    })),
    endActions: input.endActions?.map((a) => ({
      targetType: a.targetType ?? ("feature-rule" as const),
      targetId: a.targetId ?? "",
      patch:
        a.patch as RevisionRampCreateAction["steps"][number]["actions"][number]["patch"],
    })),
  };
}

export const DRAFT_STATUSES = ACTIVE_DRAFT_STATUSES;

// Build a RevisionRampCreateAction from an inline ramp schedule input.
export function normalizeInlineRampSchedule(
  input: InlineRampScheduleInput,
  ruleId: string,
  environment: string,
): RevisionRampCreateAction {
  return normalizeRevisionRampCreateAction({
    ...input,
    mode: "create" as const,
    ruleId,
    environment,
    steps: input.steps ?? [],
  });
}

export function isDraftStatus(status: string): boolean {
  return (DRAFT_STATUSES as readonly string[]).includes(status);
}

// Resolves an existing revision, or creates a blank draft on `version: "new"`.
// `created` is true when a draft was just created — pair with
// `discardIfJustCreated` on downstream failure.
export async function resolveOrCreateRevision(
  context: ApiReqContext,
  organizationId: string,
  feature: FeatureInterface,
  version: number | "new",
  options: { title?: string; comment?: string } = {},
): Promise<{ revision: FeatureRevisionInterface; created: boolean }> {
  if (version === "new") {
    const revision = await createRevision({
      context,
      feature,
      user: context.auditUser,
      baseVersion: feature.version,
      comment: options.comment ?? "",
      title: options.title,
      environments: getEnvironmentIdsFromOrg(context.org),
      publish: false,
      changes: {},
      org: context.org,
      canBypassApprovalChecks: false,
    });
    return { revision, created: true };
  }
  const revision = await getRevision({
    context,
    organization: organizationId,
    featureId: feature.id,
    version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");
  return { revision, created: false };
}

// Best-effort discard; never throws so it can't mask the original error.
export async function discardIfJustCreated(
  context: ApiReqContext,
  revision: FeatureRevisionInterface,
  created: boolean,
): Promise<void> {
  if (!created) return;
  try {
    await discardRevision(context, revision, context.auditUser);
  } catch (err) {
    logger.warn(
      { err, featureId: revision.featureId, version: revision.version },
      "Failed to discard orphaned draft after downstream failure",
    );
  }
}

// Throws if `environment` isn't configured on the org. Call before
// `resolveOrCreateRevision` so `version: "new"` can't orphan an empty draft.
export function assertValidEnvironment(
  context: ApiReqContext,
  environment: string,
): void {
  const envIds = getEnvironmentIdsFromOrg(context.org);
  if (!envIds.includes(environment)) {
    throw new BadRequestError(`Invalid environment: "${environment}"`);
  }
}

// Build a RevisionRampCreateAction from start/end dates (enable/disable).
export function buildScheduleRampAction(
  ruleId: string,
  environment: string,
  startDate?: string | null,
  endDate?: string | null,
): RevisionRampCreateAction {
  // targetId is overwritten at publish time in createRampSchedulesForRevision.
  const steps: RevisionRampCreateAction["steps"] = startDate
    ? [
        {
          trigger: { type: "scheduled", at: new Date(startDate) },
          actions: [
            {
              targetType: "feature-rule",
              targetId: "",
              patch: { ruleId, enabled: true },
            },
          ],
        },
      ]
    : [];

  const action: RevisionRampCreateAction = {
    mode: "create",
    name: "Rule schedule",
    ruleId,
    environment,
    steps,
  };

  if (endDate) {
    action.endCondition = {
      trigger: { type: "scheduled", at: new Date(endDate) },
    };
    action.endActions = [
      {
        targetType: "feature-rule",
        targetId: "",
        patch: { ruleId, enabled: false },
      },
    ];
  }

  return action;
}

export const validateCustomFields = async (
  customFieldValues: Record<string, unknown> | undefined,
  context: ApiReqContext,
  project?: string,
) => {
  await validateCustomFieldsForSection({
    customFieldValues,
    customFieldsModel: context.models.customFields,
    section: "feature",
    project,
  });
};

// Verify saved-group and prerequisite references in a rule exist. Call on
// the final rule — saved groups are loaded once.
export async function validateRuleReferences(
  rule: Pick<FeatureRule, "condition" | "savedGroups" | "prerequisites">,
  context: ApiReqContext,
): Promise<void> {
  const allSavedGroups = await context.models.savedGroups.getAll();
  const groupMap = await getSavedGroupMap(context, allSavedGroups);
  const savedGroupIds = new Set(allSavedGroups.map((sg) => sg.id));

  for (const sg of rule.savedGroups ?? []) {
    for (const id of sg.ids) {
      if (!savedGroupIds.has(id)) {
        throw new NotFoundError(`Saved group "${id}" not found`);
      }
    }
  }

  if (rule.condition && rule.condition !== "{}") {
    const condRes = validateCondition(rule.condition, groupMap);
    if (!condRes.success) {
      throw new BadRequestError(`Invalid rule condition: ${condRes.error}`);
    }
    const inGroupError = findInvalidInGroupId(
      JSON.parse(rule.condition),
      savedGroupIds,
    );
    if (inGroupError)
      throw new BadRequestError(`Invalid rule condition: ${inGroupError}`);
  }

  for (const prereq of rule.prerequisites ?? []) {
    const prereqFeature = await getFeature(context, prereq.id);
    if (!prereqFeature) {
      throw new NotFoundError(`Prerequisite feature "${prereq.id}" not found`);
    }
  }
}

// Reference checks for a feature-level prerequisites list.
export async function validatePrerequisiteReferences(
  prerequisites: FeaturePrerequisite[],
  context: ApiReqContext,
): Promise<void> {
  const savedGroupIds = new Set(
    (await context.models.savedGroups.getAll()).map((sg) => sg.id),
  );
  for (const prereq of prerequisites) {
    if (prereq.condition && prereq.condition !== "{}") {
      const inGroupError = findInvalidInGroupId(
        JSON.parse(prereq.condition),
        savedGroupIds,
      );
      if (inGroupError) {
        throw new BadRequestError(
          `Invalid condition on prerequisite "${prereq.id}": ${inGroupError}`,
        );
      }
    }
    const prereqFeature = await getFeature(context, prereq.id);
    if (!prereqFeature) {
      throw new NotFoundError(`Prerequisite feature "${prereq.id}" not found`);
    }
  }
}

// Returns an error string if any $inGroup/$notInGroup refs an unknown group.
function findInvalidInGroupId(
  obj: unknown,
  validIds: Set<string>,
): string | null {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const err = findInvalidInGroupId(item, validIds);
      if (err) return err;
    }
    return null;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === "$inGroup" || key === "$notInGroup") {
      if (typeof value === "string" && !validIds.has(value)) {
        return `saved group "${value}" referenced in ${key} not found`;
      }
    } else {
      const err = findInvalidInGroupId(value, validIds);
      if (err) return err;
    }
  }
  return null;
}

// Validate rule + per-prerequisite conditions; throws on the first invalid.
export function validateRuleConditions(
  rule: Pick<FeatureRule, "condition" | "prerequisites">,
): void {
  if (rule.condition) {
    const res = validateCondition(rule.condition);
    if (!res.success) {
      throw new BadRequestError(`Invalid rule condition: ${res.error}`);
    }
  }
  validatePrerequisiteConditions(rule.prerequisites ?? []);
}

export function validatePrerequisiteConditions(
  prerequisites: FeaturePrerequisite[],
): void {
  for (const prereq of prerequisites) {
    if (prereq.condition) {
      const res = validateCondition(prereq.condition);
      if (!res.success) {
        throw new BadRequestError(
          `Invalid condition on prerequisite "${prereq.id}": ${res.error}`,
        );
      }
      const semanticError = checkPrerequisiteConditionKeys(
        JSON.parse(prereq.condition),
      );
      if (semanticError) {
        throw new BadRequestError(
          `Invalid condition on prerequisite "${prereq.id}": ${semanticError}`,
        );
      }
    }
  }
}

// Logical operators that wrap sub-conditions (arrays or single object).
const LOGICAL_OPS = new Set(["$and", "$or", "$nor", "$not"]);

// Prereq conditions run against { value: <flag_value> }; any non-operator
// key other than "value" silently never matches — flag those at validation.
function checkPrerequisiteConditionKeys(
  obj: Record<string, unknown>,
): string | null {
  for (const key of Object.keys(obj)) {
    if (LOGICAL_OPS.has(key)) {
      const sub = obj[key];
      const subs = Array.isArray(sub) ? sub : [sub];
      for (const s of subs) {
        if (s && typeof s === "object" && !Array.isArray(s)) {
          const err = checkPrerequisiteConditionKeys(
            s as Record<string, unknown>,
          );
          if (err) return err;
        }
      }
    } else if (key !== "value" && !key.startsWith("$")) {
      return (
        `field "${key}" will never match — prerequisite conditions are ` +
        `evaluated against {"value": <flag_value>}. Use "value" as the field key.`
      );
    }
  }
  return null;
}
