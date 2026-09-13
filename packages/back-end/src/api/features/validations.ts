import type {
  FeatureRule,
  FeaturePrerequisite,
  FeatureRulePatch,
} from "shared/validators";
import {
  apiRevisionRampCreateAction,
  RevisionRampCreateAction,
  ACTIVE_DRAFT_STATUSES,
  inlineRampScheduleInput,
} from "shared/validators";
import isEqual from "lodash/isEqual";
import { z } from "zod";
import {
  findStoredRuleCounterpart,
  isFeatureCyclic,
  validateCondition,
} from "shared/util";
import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import { getSavedGroupMap } from "back-end/src/services/features";
import { assertRegisteredAttributes } from "back-end/src/services/attributes";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
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
  const normalizeAction = (a: {
    targetId?: string;
    patch: Record<string, unknown>;
  }) => ({
    targetType: "feature-rule" as const,
    targetId: a.targetId ?? "",
    patch: a.patch as FeatureRulePatch,
  });
  return {
    ...input,
    steps: (input.steps ?? []).map((s) => ({
      interval: s.interval,
      actions: (s.actions ?? []).map(normalizeAction),
      approvalNotes: s.approvalNotes ?? undefined,
      monitored: !!s.monitored,
      holdConditions: s.holdConditions ?? undefined,
    })),
    startActions: input.startActions?.map(normalizeAction),
    endActions: input.endActions?.map(normalizeAction),
  };
}

export const DRAFT_STATUSES = ACTIVE_DRAFT_STATUSES;

// Build a RevisionRampCreateAction from an inline ramp schedule input.
// `environment` is intentionally omitted — v2 ramp actions target by
// `ruleId` alone.  Legacy stored actions may still carry an `environment`
// field that the resolver handles, but new emissions must not set it.
export function normalizeInlineRampSchedule(
  input: InlineRampScheduleInput,
  ruleId: string,
): RevisionRampCreateAction {
  return normalizeRevisionRampCreateAction({
    ...input,
    mode: "create" as const,
    ruleId,
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
    feature,
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
    // Only ever discards a draft it just created, which can't be the live version.
    await discardRevision(context, revision, context.auditUser, null);
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

// Same check for the `environments` list a v2 rule is scoped to. A rule with
// `allEnvironments: true` is skipped, since its list is discarded.
export function assertValidRuleEnvironments(
  context: ApiReqContext,
  rules: { allEnvironments?: boolean; environments?: string[] }[],
): void {
  for (const rule of rules) {
    if (rule.allEnvironments === true) continue;
    for (const environment of rule.environments ?? []) {
      assertValidEnvironment(context, environment);
    }
  }
}

// Build a RevisionRampCreateAction from start/end dates (enable/disable).
// `environment` is intentionally absent — new actions target by `ruleId` only.
//
// startDate is set at the ramp level — `applyRampStartActions` auto-enables
// the rule when the schedule starts. cutoffDate disables the rule at the
// end. No explicit step is needed for either gate; an empty `steps` array is
// valid as long as startDate or cutoffDate is present.
export function buildScheduleRampAction(
  ruleId: string,
  startDate?: string | null,
  endDate?: string | null,
): RevisionRampCreateAction {
  const action: RevisionRampCreateAction = {
    mode: "create",
    name: "Rule schedule",
    ruleId,
    steps: [],
  };

  if (startDate) {
    action.startDate = startDate;
  }

  if (endDate) {
    action.cutoffDate = endDate;
    action.endActions = [
      {
        targetType: "feature-rule" as const,
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
  existingCustomFieldValues?: Record<string, unknown>,
) => {
  await validateCustomFieldsForSection({
    customFieldValues,
    existingCustomFieldValues,
    customFieldsModel: context.models.customFields,
    section: "feature",
    project,
  });
};

type SavedGroupMap = Awaited<ReturnType<typeof getSavedGroupMap>>;

// Verify the saved-group references in a rule exist. Call on the final rule —
// saved groups are loaded once. Prerequisite parents are checked separately
// by assertValidPrerequisiteParents.
export async function validateRuleReferences(
  rule: Pick<FeatureRule, "condition" | "savedGroups">,
  context: ApiReqContext,
): Promise<void> {
  validateRuleReferencesWithGroups(rule, await getSavedGroupMap(context));
}

// Bulk form for endpoints that take a whole rules array (feature create /
// update, v1 and v2): the per-rule checks, with saved groups loaded once.
export async function validateRulesReferences(
  rules: Pick<FeatureRule, "condition" | "savedGroups" | "prerequisites">[],
  context: ApiReqContext,
): Promise<void> {
  if (!rules.length) return;
  const groupMap = await getSavedGroupMap(context);
  for (const rule of rules) {
    validatePrerequisiteConditions(rule.prerequisites ?? []);
    validateRuleReferencesWithGroups(rule, groupMap);
  }
}

// Update form: a bulk write replaces the rules array, but only fields that
// differ from the stored rule with the same id are checked, so resending a
// stored rule unchanged never re-validates references the caller cannot read
// (saved groups and features are read-filtered).
export async function validateChangedRuleReferences(
  inbound: FeatureRule[],
  stored: FeatureRule[],
  context: ApiReqContext,
): Promise<void> {
  await validateRulesReferences(
    inbound.flatMap((rule) => {
      const prior = findStoredRuleCounterpart(stored, rule);
      const conditionChanged =
        !prior || (prior.condition || "{}") !== (rule.condition || "{}");
      const savedGroupsChanged =
        !prior || !isEqual(prior.savedGroups ?? [], rule.savedGroups ?? []);
      const prerequisitesChanged =
        !prior || !isEqual(prior.prerequisites ?? [], rule.prerequisites ?? []);
      if (!conditionChanged && !savedGroupsChanged && !prerequisitesChanged) {
        return [];
      }
      return [
        {
          condition: conditionChanged ? rule.condition : undefined,
          savedGroups: savedGroupsChanged ? rule.savedGroups : [],
          prerequisites: prerequisitesChanged ? rule.prerequisites : undefined,
        },
      ];
    }),
    context,
  );
}

function validateRuleReferencesWithGroups(
  rule: Pick<FeatureRule, "condition" | "savedGroups">,
  groupMap: SavedGroupMap,
): void {
  const savedGroupIds = new Set(groupMap.keys());
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
}

// Saved-group references inside a feature-level prerequisites list; the
// parents themselves are checked by assertValidPrerequisiteParents.
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
  }
}

function prerequisiteIdsOf(
  feature: Pick<FeatureInterface, "prerequisites" | "rules">,
): Set<string> {
  const ids = new Set<string>();
  (feature.prerequisites ?? []).forEach((p) => ids.add(p.id));
  (feature.rules ?? []).forEach((rule) =>
    (rule.prerequisites ?? []).forEach((p) => ids.add(p.id)),
  );
  return ids;
}

// One query per hop; a real prerequisite chain is a handful deep, so a walk
// still open after this many hops is refused rather than left unchecked.
const MAX_PREREQUISITE_DEPTH = 50;

// Every ancestor of `seeds`. Loaded through the org-wide scan context (as the
// delete guard does) so an ancestor in a project the caller cannot read still
// contributes its edges; the caller never sees these documents. Follows
// disabled rules too, matching isFeatureCyclic.
async function loadPrerequisiteAncestors(
  context: ApiReqContext,
  seeds: FeatureInterface[],
): Promise<Map<string, FeatureInterface>> {
  const scanContext =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  const loaded = new Map(seeds.map((f) => [f.id, f]));
  let frontier = seeds;
  for (let depth = 0; ; depth++) {
    const wanted = [
      ...new Set(frontier.flatMap((f) => [...prerequisiteIdsOf(f)])),
    ].filter((id) => !loaded.has(id));
    if (!wanted.length) return loaded;
    if (depth >= MAX_PREREQUISITE_DEPTH) {
      throw new BadRequestError("Prerequisite chain is too deep to validate");
    }
    frontier = await getAllFeaturesWithoutEditorFields(scanContext, {
      ids: wanted,
      includeArchived: true,
    });
    frontier.forEach((f) => loaded.set(f.id, f));
  }
}

// A prerequisite may point only at an existing, unarchived boolean flag that
// does not itself depend on the feature being written — the same constraints
// the dashboard's prerequisite picker applies. Only parents this write
// introduces (present in `candidate`, absent from `stored`) are checked, so a
// feature already pointing at a since-archived parent still posts back
// unchanged, and the cycle walk loads just the new parents' ancestor chains.
export async function assertValidPrerequisiteParents(
  context: ApiReqContext,
  candidate: FeatureInterface,
  stored?: Pick<FeatureInterface, "prerequisites" | "rules">,
): Promise<void> {
  const prior = stored ? prerequisiteIdsOf(stored) : new Set<string>();
  const added = [...prerequisiteIdsOf(candidate)].filter(
    (id) => !prior.has(id),
  );
  if (!added.length) return;
  if (added.includes(candidate.id)) {
    throw new BadRequestError(
      `Feature "${candidate.id}" cannot be its own prerequisite`,
    );
  }

  const parents = await getAllFeaturesWithoutEditorFields(context, {
    ids: added,
    includeArchived: true,
  });
  const byId = new Map(parents.map((f) => [f.id, f]));
  for (const id of added) {
    const parent = byId.get(id);
    if (!parent) {
      throw new NotFoundError(`Prerequisite feature "${id}" not found`);
    }
    if (parent.archived) {
      throw new BadRequestError(`Prerequisite feature "${id}" is archived`);
    }
    if (parent.valueType !== "boolean") {
      throw new BadRequestError(
        `Prerequisite feature "${id}" must be a boolean feature, not ${parent.valueType}`,
      );
    }
  }

  const graph = await loadPrerequisiteAncestors(context, parents);
  graph.set(candidate.id, candidate);
  if (isFeatureCyclic(candidate, graph)[0]) {
    const names = added.map((id) => `"${id}"`).join(", ");
    throw new BadRequestError(
      `Prerequisite ${names} would create a circular dependency`,
    );
  }
}

// Per-rule endpoints: the revision's rules before and after the change, with
// the revision's own prerequisites list when it has one.
export async function assertValidRevisionRulePrerequisites(
  context: ApiReqContext,
  feature: FeatureInterface,
  revision: Pick<FeatureRevisionInterface, "prerequisites">,
  rules: { before: FeatureRule[]; after: FeatureRule[] },
): Promise<void> {
  const prerequisites = revision.prerequisites ?? feature.prerequisites;
  await assertValidPrerequisiteParents(
    context,
    { ...feature, rules: rules.after, prerequisites },
    { rules: rules.before, prerequisites },
  );
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

// Opt-in check (org setting `requireRegisteredAttributes`): rejects rules
// whose hashAttribute, fallbackAttribute, or condition field names aren't
// declared in the org's attributeSchema. Prevents typo'd attributes from
// silently shipping dead targeting.
export function validateRuleAttributes(
  rule: Partial<Pick<FeatureRule, "condition">> & {
    hashAttribute?: string;
    fallbackAttribute?: string;
  },
  context: ApiReqContext,
  project?: string | string[],
): void {
  assertRegisteredAttributes(
    context,
    {
      hashAttribute: rule.hashAttribute,
      fallbackAttribute: rule.fallbackAttribute,
      condition: rule.condition,
    },
    "rule",
    undefined,
    project,
  );
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
