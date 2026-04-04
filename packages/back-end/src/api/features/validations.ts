import type {
  RevisionRampCreateAction,
  RampStep,
  RampStepAction,
  FeatureRule,
  FeaturePrerequisite,
} from "shared/validators";
import { validateCondition } from "shared/util";
import { getSavedGroupMap } from "back-end/src/services/features";
import { getFeature } from "back-end/src/models/FeatureModel";
import { validateCustomFieldsForSection } from "back-end/src/util/custom-fields";
import { ApiReqContext } from "back-end/types/api";

export const DRAFT_STATUSES = [
  "draft",
  "pending-review",
  "changes-requested",
  "approved",
] as const;

export function isDraftStatus(status: string): boolean {
  return (DRAFT_STATUSES as readonly string[]).includes(status);
}

/**
 * Build a RevisionRampCreateAction from simple startDate / endDate inputs.
 * - startDate → adds a scheduled step that enables the rule
 * - endDate   → adds an endCondition + endAction that disables the rule
 * ruleId and environment are inferred from the calling context.
 */
export function buildScheduleRampAction(
  ruleId: string,
  environment: string,
  startDate?: string | null,
  endDate?: string | null,
): RevisionRampCreateAction {
  const enableAction: RampStepAction = {
    targetType: "feature-rule",
    targetId: ruleId,
    patch: { ruleId, enabled: true },
  };
  const disableAction: RampStepAction = {
    targetType: "feature-rule",
    targetId: ruleId,
    patch: { ruleId, enabled: false },
  };

  const steps: RampStep[] = startDate
    ? [
        {
          trigger: { type: "scheduled", at: new Date(startDate) },
          actions: [enableAction],
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
    action.endActions = [disableAction];
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

/**
 * Validate that all entity references in a rule exist:
 * - savedGroups[].ids  → saved group IDs must exist
 * - condition ($inGroup / $notInGroup / $savedGroups) → saved group IDs must exist
 * - prerequisites[].id → feature must exist in this org
 *
 * Loads saved groups and builds the groupMap once, so call this after building
 * the final rule rather than per-field.
 */
export async function validateRuleReferences(
  rule: Pick<FeatureRule, "condition" | "savedGroups" | "prerequisites">,
  context: ApiReqContext,
): Promise<void> {
  const allSavedGroups = await context.models.savedGroups.getAll();
  const groupMap = await getSavedGroupMap(context, allSavedGroups);
  const savedGroupIds = new Set(allSavedGroups.map((sg) => sg.id));

  // 1. savedGroups[] targeting array
  for (const sg of rule.savedGroups ?? []) {
    for (const id of sg.ids) {
      if (!savedGroupIds.has(id)) {
        throw new Error(`Saved group "${id}" not found`);
      }
    }
  }

  // 2. Condition string — pass groupMap so $savedGroups refs are validated,
  //    then additionally walk for bare $inGroup/$notInGroup IDs.
  if (rule.condition && rule.condition !== "{}") {
    const condRes = validateCondition(rule.condition, groupMap);
    if (!condRes.success) {
      throw new Error(`Invalid rule condition: ${condRes.error}`);
    }
    const inGroupError = findInvalidInGroupId(
      JSON.parse(rule.condition),
      savedGroupIds,
    );
    if (inGroupError)
      throw new Error(`Invalid rule condition: ${inGroupError}`);
  }

  // 3. Prerequisite feature IDs
  for (const prereq of rule.prerequisites ?? []) {
    const prereqFeature = await getFeature(context, prereq.id);
    if (!prereqFeature) {
      throw new Error(`Prerequisite feature "${prereq.id}" not found`);
    }
  }
}

/**
 * Same reference checks for a feature-level prerequisites list
 * (used by putFeatureRevisionPrerequisites).
 */
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
        throw new Error(
          `Invalid condition on prerequisite "${prereq.id}": ${inGroupError}`,
        );
      }
    }
    const prereqFeature = await getFeature(context, prereq.id);
    if (!prereqFeature) {
      throw new Error(`Prerequisite feature "${prereq.id}" not found`);
    }
  }
}

/**
 * Recursively walk a parsed condition object and return an error string if any
 * $inGroup / $notInGroup value references a non-existent saved group ID.
 */
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

/**
 * Validate all condition strings (rule condition + per-prerequisite conditions).
 * Throws with a descriptive message on the first invalid condition found.
 */
export function validateRuleConditions(
  rule: Pick<FeatureRule, "condition" | "prerequisites">,
): void {
  if (rule.condition) {
    const res = validateCondition(rule.condition);
    if (!res.success) {
      throw new Error(`Invalid rule condition: ${res.error}`);
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
        throw new Error(
          `Invalid condition on prerequisite "${prereq.id}": ${res.error}`,
        );
      }
      // Semantic check: prereq conditions are evaluated against {"value": <flag_value>}
      // so any non-operator key other than "value" will silently never match.
      const semanticError = checkPrerequisiteConditionKeys(
        JSON.parse(prereq.condition),
      );
      if (semanticError) {
        throw new Error(
          `Invalid condition on prerequisite "${prereq.id}": ${semanticError}`,
        );
      }
    }
  }
}

// Logical operators that wrap sub-conditions (arrays or single object).
const LOGICAL_OPS = new Set(["$and", "$or", "$nor", "$not"]);

/**
 * Recursively verify that every non-operator key in a parsed prerequisite
 * condition is "value". Any other field name (e.g. "country") will silently
 * never match because the SDK evaluates prereqs against { value: <flag_value> }.
 */
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
