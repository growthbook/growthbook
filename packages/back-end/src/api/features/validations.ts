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
import { findStoredRuleCounterpart, validateCondition } from "shared/util";
import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import { getSavedGroupMap } from "back-end/src/services/features";
import { normalizeRampPlanForceValues } from "back-end/src/services/rampSchedule";
import { assertRegisteredAttributes } from "back-end/src/services/attributes";
import {
  assertValidExperimentPrerequisites,
  assertValidPrerequisiteParents,
} from "back-end/src/services/prerequisiteParents";
import {
  createRevision,
  discardRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { validateCustomFieldsForSection } from "back-end/src/util/custom-fields";
import type { ReqContext } from "back-end/types/request";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { resolveRampTarget } from "back-end/src/util/flattenRules";
import { ApiReqContext } from "back-end/types/api";

export { inlineRampScheduleInput };

type InlineRampScheduleInput = z.infer<typeof inlineRampScheduleInput>;

type RampForceFeature = Pick<FeatureInterface, "valueType">;

// targetId is a placeholder — real UUID is injected at publish time. `force`
// values are brought to the string form rule values use (and validated against
// the feature when given) so a draft plan reads back the way it will apply.
function normalizeRevisionRampCreateAction(
  input: z.infer<typeof apiRevisionRampCreateAction>,
  feature?: RampForceFeature,
  opts?: { validateStartActions?: boolean },
): RevisionRampCreateAction {
  input = normalizeRampPlanForceValues(input, feature, opts);
  const normalizeAction = (a: {
    targetId?: string;
    patch: Record<string, unknown>;
  }) => ({
    targetType: "feature-rule" as const,
    targetId: a.targetId ?? "",
    patch: a.patch as FeatureRulePatch,
  });
  // Omitted startActions/endActions stay omitted: an `undefined` value would be
  // persisted as `null` (rampActions is a Mixed array).
  const { startActions, endActions, ...rest } = input;
  return {
    ...rest,
    steps: (input.steps ?? []).map((s) => ({
      interval: s.interval,
      actions: (s.actions ?? []).map(normalizeAction),
      approvalNotes: s.approvalNotes ?? undefined,
      monitored: !!s.monitored,
      holdConditions: s.holdConditions ?? undefined,
    })),
    ...(startActions !== undefined
      ? { startActions: startActions.map(normalizeAction) }
      : {}),
    ...(endActions !== undefined
      ? { endActions: endActions.map(normalizeAction) }
      : {}),
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
  feature?: RampForceFeature,
  opts?: { validateStartActions?: boolean },
): RevisionRampCreateAction {
  return normalizeRevisionRampCreateAction(
    {
      ...input,
      mode: "create" as const,
      ruleId,
      steps: input.steps ?? [],
    },
    feature,
    opts,
  );
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
  context: ReqContext | ApiReqContext,
  rules: { allEnvironments?: boolean; environments?: string[] }[],
): void {
  for (const rule of rules) {
    if (rule.allEnvironments === true) continue;
    for (const environment of rule.environments ?? []) {
      assertValidEnvironment(context, environment);
    }
  }
}

// The targeting fields a ramp schedule patch (step, start or end action, or
// `startState`) may carry. The ramp engine writes them onto the live rule when
// the step fires, so they get the same checks a rule write gets.
export type RampPatchTargetingInput = {
  ruleId?: string | null;
  condition?: string | null;
  savedGroups?: FeatureRule["savedGroups"] | null;
  prerequisites?: FeaturePrerequisite[] | null;
  allEnvironments?: boolean | null;
  environments?: string[] | null;
};

type RampPlanAction = { targetId?: string; patch?: unknown };

type RampPlanInput = {
  steps?: { actions?: RampPlanAction[] | null }[] | null;
  startActions?: RampPlanAction[] | null;
  endActions?: RampPlanAction[] | null;
  startState?: unknown;
};

// Every action in a ramp plan body, stored schedule or revision ramp action
// that carries a patch, in plan order.
export function collectRampPlanActions(plan: unknown): RampPlanAction[] {
  if (!plan || typeof plan !== "object") return [];
  const { steps, startActions, endActions } = plan as RampPlanInput;
  return [
    ...(startActions ?? []),
    ...(steps ?? []).flatMap((s) => s?.actions ?? []),
    ...(endActions ?? []),
  ].filter((a) => !!a?.patch && typeof a.patch === "object");
}

// The patches of those actions plus `startState`. Start actions derived from
// the rule's current state are not caller-supplied and must not be passed here.
export function collectRampPlanPatches(
  plan: unknown,
): RampPatchTargetingInput[] {
  const patches = collectRampPlanActions(plan).map((a) => a.patch);
  const startState = (plan as RampPlanInput | null | undefined)?.startState;
  if (startState && typeof startState === "object") patches.push(startState);
  return patches as RampPatchTargetingInput[];
}

type RuleScope = Pick<
  RampPatchTargetingInput,
  "allEnvironments" | "environments" | "prerequisites"
> & { id?: string };

// One patch and where it lands: the flag whose rule it targets, and that
// rule's current environment scope when the caller could resolve it.
export type RampPatchEntry = {
  patch: RampPatchTargetingInput;
  feature: FeatureInterface | null;
  rule?: RuleScope | null;
};

export type RampPatchTarget = {
  id: string;
  entityId: string;
  ruleId?: string | null;
  environment?: string | null;
};

// Multi-target plans (the generated update, the dashboard schedule routes,
// the executor): each action lands on the rule its target names. The
// executor applies a patch by its own `ruleId`, falling back to the target's.
export function rampPatchEntriesForTargets(
  actions: RampPlanAction[],
  targets: RampPatchTarget[],
  featureById: (id: string) => FeatureInterface | null | undefined,
): RampPatchEntry[] {
  const targetsById = new Map(targets.map((t) => [t.id, t]));
  return collectRampPlanActions({ steps: [{ actions }] }).map((a) => {
    const patch = a.patch as RampPatchTargetingInput;
    const target = a.targetId ? targetsById.get(a.targetId) : undefined;
    const feature = (target && featureById(target.entityId)) || null;
    const ruleId = patch.ruleId ?? target?.ruleId;
    const rule =
      feature && ruleId
        ? resolveRampTarget(
            { ruleId, environment: target?.environment ?? null },
            feature.rules ?? [],
          )
        : null;
    return { patch, feature, rule };
  });
}

// Single-target plans (every route but the generated update): all patches
// land on the same rule of the same flag.
export function rampPatchEntries(
  patches: RampPatchTargetingInput[],
  feature: FeatureInterface | null,
  rule?: RuleScope | null,
): RampPatchEntry[] {
  return patches.map((patch) => ({ patch, feature, rule }));
}

function hasRampPatchTargeting(p: RampPatchTargetingInput): boolean {
  return (
    (p.condition ?? null) !== null ||
    (p.savedGroups ?? null) !== null ||
    (p.prerequisites ?? null) !== null ||
    (p.allEnvironments ?? null) !== null ||
    (p.environments ?? null) !== null
  );
}

// The fields of `patch` that no stored patch for the same rule already holds
// with an equal value; fields that merely echo stored content come back unset.
// Environment scope is compared as the (allEnvironments, environments) pair and
// kept whole, since it also scopes the prerequisite check.
function changedRampPatchTargeting(
  patch: RampPatchTargetingInput,
  stored: RampPatchTargetingInput[],
): RampPatchTargetingInput {
  const prior = stored.filter(
    (s) => (s.ruleId ?? null) === (patch.ruleId ?? null),
  );
  const echoed = <K extends keyof RampPatchTargetingInput>(...keys: K[]) =>
    prior.some((s) =>
      keys.every((k) => isEqual(s[k] ?? null, patch[k] ?? null)),
    );
  return {
    ruleId: patch.ruleId,
    ...(echoed("condition") ? {} : { condition: patch.condition }),
    ...(echoed("savedGroups") ? {} : { savedGroups: patch.savedGroups }),
    ...(echoed("prerequisites") ? {} : { prerequisites: patch.prerequisites }),
    ...(echoed("allEnvironments", "environments")
      ? {}
      : {
          allEnvironments: patch.allEnvironments,
          environments: patch.environments,
        }),
  };
}

const RAMP_PATCH_ERROR_PREFIX = "Invalid ramp schedule patch: ";

// The rule endpoints' checks (`assertValidRuleEnvironments`,
// `validateRulesReferences`, `assertValidPrerequisiteParents`) applied to ramp
// patch targeting. `stored` are the plans this write replaces; as with
// `validateChangedRuleReferences`, a field a stored patch for the same rule
// already holds unchanged is not re-checked, so echoing a plan that names a
// since-deleted group still succeeds.
export async function validateRampPlanPatches(
  context: ReqContext | ApiReqContext,
  entries: RampPatchEntry[],
  { stored = [] }: { stored?: unknown[] } = {},
): Promise<void> {
  const storedPatches = stored.flatMap((plan) => collectRampPlanPatches(plan));
  const checked = entries
    .filter(({ patch }) => hasRampPatchTargeting(patch))
    .map((entry) => ({
      ...entry,
      changed: changedRampPatchTargeting(entry.patch, storedPatches),
    }))
    .filter(({ changed }) => hasRampPatchTargeting(changed));
  if (!checked.length) return;

  try {
    assertValidRuleEnvironments(
      context,
      checked.map(({ changed }) => ({
        allEnvironments: changed.allEnvironments ?? undefined,
        environments: changed.environments ?? undefined,
      })),
    );

    await validateRulesReferences(
      checked
        .filter(
          ({ changed }) =>
            (changed.condition ?? null) !== null ||
            (changed.savedGroups ?? null) !== null ||
            (changed.prerequisites ?? null) !== null,
        )
        .map(({ changed }) => ({
          condition: changed.condition ?? undefined,
          savedGroups: changed.savedGroups ?? undefined,
          prerequisites: changed.prerequisites ?? undefined,
        })),
      context,
    );

    for (const { patch, changed, feature, rule } of checked) {
      // A scope change carries the rule's existing gates into new
      // environments: walk with those, with the target rule removed from the
      // stored graph so they count as new edges.
      const scopeChanged =
        changed.environments !== undefined ||
        (changed.allEnvironments ?? null) !== null;
      const prerequisites =
        changed.prerequisites ??
        (scopeChanged
          ? (patch.prerequisites ?? rule?.prerequisites ?? [])
          : []);
      if (!prerequisites.length) continue;
      if (!feature) {
        // No flag to walk (a target-less schedule, or a target the caller
        // cannot read): the new parents must at least exist and be live.
        await assertValidExperimentPrerequisites(context, prerequisites);
        continue;
      }
      // Judged as one more rule on the flag, in the scope the patch sets, else
      // the target rule's, else every environment. A missing `environments`
      // list means every environment (`ruleAppliesToEnv`), so it stays unset.
      const patchSetsScope =
        patch.environments !== undefined ||
        (patch.allEnvironments ?? null) !== null;
      const scope: RuleScope = patchSetsScope
        ? patch
        : (rule ?? { allEnvironments: true });
      const environments = scope.environments ?? undefined;
      const patched: FeatureRule = {
        type: "force",
        id: "ramp-schedule-patch",
        description: "",
        value: "",
        enabled: true,
        allEnvironments: scope.allEnvironments === true,
        ...(scope.allEnvironments === true || environments === undefined
          ? {}
          : { environments }),
        prerequisites,
      };
      const others = (feature.rules ?? []).filter(
        (r) => !scopeChanged || !rule?.id || r.id !== rule.id,
      );
      await assertValidPrerequisiteParents(
        context,
        { ...feature, rules: [...others, patched] },
        { ...feature, rules: others },
      );
    }
  } catch (e) {
    if (e instanceof NotFoundError) {
      throw new NotFoundError(RAMP_PATCH_ERROR_PREFIX + e.message);
    }
    if (e instanceof BadRequestError) {
      throw new BadRequestError(RAMP_PATCH_ERROR_PREFIX + e.message);
    }
    throw e;
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
  context: ReqContext | ApiReqContext,
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
type RuleAttributeParts = Partial<Pick<FeatureRule, "condition">> & {
  hashAttribute?: string;
  fallbackAttribute?: string;
};

// With `existing`, only attributes the write changes are checked, so a rule
// that predates a stricter scope does not block unrelated edits.
export function validateRuleAttributes(
  rule: RuleAttributeParts,
  context: ApiReqContext,
  project?: string | string[],
  existing?: RuleAttributeParts,
): void {
  const parts = (r: RuleAttributeParts) => ({
    hashAttribute: r.hashAttribute,
    fallbackAttribute: r.fallbackAttribute,
    condition: r.condition,
  });
  assertRegisteredAttributes(
    context,
    parts(rule),
    "rule",
    existing ? parts(existing) : undefined,
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
