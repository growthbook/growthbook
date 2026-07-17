import { ConfigInterface } from "shared/types/config";
import { ConstantInterface } from "shared/types/constant";
import { Revision, normalizeProposedChanges } from "shared/enterprise";
import {
  getConfigSubtree,
  parsePlainJSONObject,
  ScopedOverrideEntry,
} from "shared/util";
import { isEqual } from "lodash";
import type { Context } from "back-end/src/models/BaseModel";
import {
  ConfigKeyImplementation,
  findRunningExperimentRefsReferencingConstant,
  getConfigKeyImplementations,
  resolvableDependencyClosure,
} from "back-end/src/services/constants";
import { getResolvableValues } from "back-end/src/services/resolvableValues";
import {
  SoftWarningError,
  TerminalPublishError,
} from "back-end/src/util/errors";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { getArmAcknowledgment } from "back-end/src/services/armGuards";
import { logger } from "back-end/src/util/logger";

// Experiment guard: an opt-in, per-config, computed-live soft-block on publishing
// a config whose value is served to a RUNNING experiment. Publishing rewrites the
// value that experiment's live variation arm resolves to, mid-flight and without
// re-bucketing. The block is computed on demand (never a stored lock), so it
// evaporates on its own once the experiment stops.
//
// This module is the pure decision core — no I/O — so it can be unit-tested hard.
// The service layer feeds it the live usage implementations and the arm-time
// fingerprint; the adapter/handlers act on the returned decision.

// The config keys in the conflict set: configs affected by publishing this config
// (itself or a descendant, via base-wins inheritance) whose LIVE value backs a
// running experiment's variation arm AND that have the guard enabled. Guarding is
// a property of the SERVED config, not the edited one — so publishing an unguarded
// ancestor still conflicts when a guarded descendant it feeds serves a running
// experiment. Ancestors and lateral mixins are excluded — publishing this config
// doesn't change their value.
export function computeExperimentGuardConflictKeys(
  implementations: Pick<
    ConfigKeyImplementation,
    "configKey" | "relation" | "experimentStatus" | "state"
  >[],
  guardedConfigKeys: Set<string>,
): Set<string> {
  const keys = new Set<string>();
  for (const impl of implementations) {
    // Only a running experiment's live arm is at risk. A draft feature revision
    // referencing the config isn't serving anything yet.
    if (impl.experimentStatus !== "running") continue;
    if (impl.state !== "live") continue;
    if (impl.relation !== "self" && impl.relation !== "descendant") continue;
    // Only when the config actually serving the value opted into the guard.
    if (!guardedConfigKeys.has(impl.configKey)) continue;
    keys.add(impl.configKey);
  }
  return keys;
}

// Whether every current conflict key was already acknowledged at arm time.
// Key-identity only (order- and value-independent) — so re-opening a stale-failed
// publish and editing the values shipped for those keys doesn't change the
// identity. A SUBSET counts as acknowledged: if an acknowledged experiment
// stopped between arm and fire, the live set shrinks, which is strictly less
// disruption than was acknowledged. Only a conflict key that was NOT in the
// fingerprint is a new, unacknowledged risk.
export function experimentGuardConflictsAcknowledged(
  conflictKeys: Set<string>,
  acknowledgedKeys: Iterable<string> | null | undefined,
): boolean {
  const acknowledged =
    acknowledgedKeys instanceof Set
      ? acknowledgedKeys
      : new Set(acknowledgedKeys ?? []);
  for (const k of conflictKeys) if (!acknowledged.has(k)) return false;
  return true;
}

// Config fields whose change can alter a served (resolved) value — the only
// publishes that can disrupt a running experiment. A metadata-only publish
// (name/description/owner) can't, so the guard must be skipped for it (else a
// rename soft-blocks with a false "rewrites the live value" warning).
export const VALUE_AFFECTING_CONFIG_FIELDS = [
  "value",
  "schema",
  "parent",
  "extends",
  "extensible",
  // Which env/project flavors apply (and their order) changes served values.
  "scopedOverrides",
  // Resolution SCRUBS cross-project and archived refs, so moving a config to a
  // different project or archiving/unarchiving it rewrites the value served to
  // every consumer the ref stops (or starts) resolving for.
  "project",
  "archived",
] as const;
const VALUE_AFFECTING_CONFIG_FIELD_SET = new Set<string>(
  VALUE_AFFECTING_CONFIG_FIELDS,
);

// Whether a set of changed config field names includes any value-affecting one.
export function configChangeAffectsServedValue(
  changedFields: Iterable<string>,
): boolean {
  for (const f of changedFields)
    if (VALUE_AFFECTING_CONFIG_FIELD_SET.has(f)) return true;
  return false;
}

// Constant analog of VALUE_AFFECTING_CONFIG_FIELDS: `project`/`archived` are
// value-affecting for the same scrubbing reason. Note this classifies GUARD
// applicability only — the review/approval model keeps its own field scoping
// (CONSTANT_METADATA_FIELDS), which still treats project/archived as metadata.
export const VALUE_AFFECTING_CONSTANT_FIELDS = [
  "value",
  "environmentValues",
  "project",
  "archived",
] as const;
const VALUE_AFFECTING_CONSTANT_FIELD_SET = new Set<string>(
  VALUE_AFFECTING_CONSTANT_FIELDS,
);

// Whether a set of changed constant field names includes any value-affecting one.
export function constantChangeAffectsServedValue(
  changedFields: Iterable<string>,
): boolean {
  for (const f of changedFields)
    if (VALUE_AFFECTING_CONSTANT_FIELD_SET.has(f)) return true;
  return false;
}

// Top-level field per JSON-Patch op — how the revision-side checks derive
// changed field names when callers hold proposedChanges rather than a merged
// desired-state diff.
function topLevelPatchFields(proposedChanges: unknown): string[] {
  return normalizeProposedChanges(proposedChanges)
    .map((op) => op.path.split("/")[1])
    .filter(Boolean);
}

// Same checks from a revision's proposed JSON-Patch ops — used at arm time.
export function configRevisionAffectsServedValue(
  proposedChanges: unknown,
): boolean {
  return configChangeAffectsServedValue(topLevelPatchFields(proposedChanges));
}

export function constantRevisionAffectsServedValue(
  proposedChanges: unknown,
): boolean {
  return constantChangeAffectsServedValue(topLevelPatchFields(proposedChanges));
}

export type ExperimentGuardDecision =
  // No guard, no conflicts, an explicit synchronous override, or a deferred merge
  // whose acknowledged fingerprint still matches.
  | { action: "allow" }
  // Direct (synchronous) publish hit live conflicts and the caller did not pass
  // ignoreWarnings — surface a soft-block (422) naming the keys so the user can
  // acknowledge and re-submit.
  | { action: "block-immediate"; conflictKeys: string[] }
  // A deferred (armed) merge whose live conflict set contains a key that was NOT
  // acknowledged at arm time — terminal, so the publish is rejected and the draft
  // left open for a human to re-contend.
  | { action: "block-deferred"; conflictKeys: string[] };

// Decide the guard outcome. `armed` = the publish was deferred (scheduled or
// auto-publish-on-approval) and its override is an arm-time snapshot, so the
// acknowledged fingerprint governs — NOT the request's blanket ignoreWarnings
// (background jobs always ignore warnings, which is exactly why a deferred merge
// can't rely on it). A direct manual publish instead honors an explicit
// ignoreWarnings override.
export function decideExperimentGuard({
  guardEnabled,
  conflictKeys,
  armed,
  ignoreWarnings,
  acknowledgedKeys,
}: {
  guardEnabled: boolean;
  conflictKeys: Set<string>;
  armed: boolean;
  ignoreWarnings: boolean;
  acknowledgedKeys?: string[] | null;
}): ExperimentGuardDecision {
  if (!guardEnabled) return { action: "allow" };
  // Empty means the experiment(s) stopped — the block evaporated on its own.
  if (conflictKeys.size === 0) return { action: "allow" };

  if (armed) {
    if (experimentGuardConflictsAcknowledged(conflictKeys, acknowledgedKeys)) {
      return { action: "allow" };
    }
    return { action: "block-deferred", conflictKeys: [...conflictKeys].sort() };
  }

  if (ignoreWarnings) return { action: "allow" };
  return { action: "block-immediate", conflictKeys: [...conflictKeys].sort() };
}

// ── Service layer (I/O) ─────────────────────────────────────────────────────

// Every config key whose RESOLVED value a publish of `configKey` changes: the
// config itself, plus (transitively, cycle-safe) every base that selects it as a
// scoped-override flavor — publishing a flavor rewrites its selecting base's
// per-environment resolved value. That flavor→base edge is NOT a lineage edge,
// so each affected config's own subtree must be evaluated separately (the
// lineage subtree walk can't cross it). Mirrors the reverse-scopedOverrides edge
// the lock/refresh dependency closure already follows. Pure; exported for tests.
export function configPublishAffectedRoots(
  allConfigs: Pick<ConfigInterface, "key" | "scopedOverrides">[],
  configKey: string,
): string[] {
  const visited = new Set<string>([configKey]);
  const queue = [configKey];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const c of allConfigs) {
      if (visited.has(c.key)) continue;
      if ((c.scopedOverrides ?? []).some((o) => o.config === cur)) {
        visited.add(c.key);
        queue.push(c.key);
      }
    }
  }
  return [...visited];
}

// Conflicts from publishing a single config `key`: guarded configs in its subtree
// (itself + descendants, base-wins) whose live value backs a running experiment.
// Empty (cheap, no usage scan) when nothing guarded is in the subtree.
async function conflictsForConfigPublish(
  scanContext: Context,
  allConfigs: ConfigInterface[],
  byKey: Map<string, ConfigInterface>,
  key: string,
  id: string,
): Promise<Set<string>> {
  const guardedConfigKeys = new Set(
    getConfigSubtree(key, allConfigs).filter(
      (k) => byKey.get(k)?.experimentGuard,
    ),
  );
  if (guardedConfigKeys.size === 0) return new Set<string>();
  const impl = await getConfigKeyImplementations(scanContext, id);
  return computeExperimentGuardConflictKeys(
    impl?.implementations ?? [],
    guardedConfigKeys,
  );
}

// The live conflict set for publishing this config. Empty when no guarded config
// whose value this publish changes is currently serving a running experiment.
export async function evaluateConfigExperimentGuardConflicts(
  context: Context,
  config: ConfigInterface,
): Promise<Set<string>> {
  // Scan usage with an org-wide (unfiltered) context: the guard must see a
  // running experiment served by a config-backed feature in ANY project — even
  // one the acting user can't read — or it silently finds no conflict and the
  // publish rewrites that experiment's live arm. (The UI usage table keeps the
  // request context; only this guard path needs global coverage.)
  const scanContext = getContextForAgendaJobByOrgObject(context.org);
  const allConfigs = await scanContext.models.configs.getAllForReconcile();
  const byKey = new Map(allConfigs.map((c) => [c.key, c]));

  // Publishing this config rewrites the resolved value of its own subtree AND of
  // every base that selects it as a flavor (the flavor→base edge). Evaluate each
  // affected root's subtree independently — `getConfigKeyImplementations` scopes
  // its implementations + relation classification to the config it's called on,
  // so a selecting base's usage is only seen when that base is the evaluated
  // root, not by widening the current config's guarded-key set.
  const conflicts = new Set<string>();
  for (const rootKey of configPublishAffectedRoots(allConfigs, config.key)) {
    const root = byKey.get(rootKey);
    if (!root) continue;
    for (const k of await conflictsForConfigPublish(
      scanContext,
      allConfigs,
      byKey,
      root.key,
      root.id,
    )) {
      conflicts.add(k);
    }
  }
  return conflicts;
}

// Enforce the experiment guard for a config publish. `armed` = a deferred merge
// (scheduled publish or auto-publish-on-approval), whose override is the arm-time
// fingerprint on the revision; unarmed = a direct manual publish, which honors an
// explicit synchronous override (`?ignoreWarnings=true` or bypassApprovalChecks).
// Throws SoftWarningError (422) for an un-acknowledged direct publish, or
// TerminalPublishError for a deferred merge whose fingerprint has diverged.
export async function assertConfigExperimentGuard(
  context: Context,
  config: ConfigInterface,
  revision: Pick<Revision, "armAcknowledgments">,
  { armed }: { armed: boolean },
): Promise<void> {
  // No early-out on `config.experimentGuard`: the conflict evaluation gates on
  // the whole subtree's guard flags, so publishing an unguarded config that
  // feeds a guarded descendant is still enforced.
  const conflictKeys = await evaluateConfigExperimentGuardConflicts(
    context,
    config,
  );

  const synchronousOverride =
    context.ignoreWarnings ||
    context.permissions.canBypassApprovalChecks({
      project: config.project || "",
    });

  const decision = decideExperimentGuard({
    guardEnabled: true,
    conflictKeys,
    armed,
    ignoreWarnings: synchronousOverride,
    acknowledgedKeys: getArmAcknowledgment(revision, "experiment"),
  });

  if (decision.action === "allow") {
    // Record a synchronous override of live conflicts (the publish itself is
    // audited; this makes the guard bypass explicit in the logs). Armed merges
    // that pass via a matching fingerprint were already acknowledged at arm time.
    if (!armed && conflictKeys.size > 0) {
      logger.info(
        {
          configId: config.id,
          userId: context.userId,
          conflictKeys: [...conflictKeys].sort(),
        },
        "Config experiment guard overridden on a direct publish",
      );
    }
    return;
  }

  const keyList = decision.conflictKeys.join(", ");
  if (decision.action === "block-immediate") {
    throw new SoftWarningError(
      `Publishing this config rewrites the live value served to a running experiment (config keys: ${keyList}). Re-submit with ignoreWarnings to proceed.`,
      decision.conflictKeys,
    );
  }
  throw new TerminalPublishError(
    `Config publish blocked by the experiment guard: the running experiments affected have changed since this publish was scheduled (config keys now: ${keyList}). Re-open the draft and re-confirm to publish.`,
  );
}

// Experiment guard for the IMMEDIATE (non-revision) scopedOverrides write.
// Attaching/detaching/re-scoping a value-bearing flavor changes what a
// config-backed feature serves per environment, same as publishing a value.
// Skipped when the change is provably value-neutral — the UI's create-override
// flow attaches a brand-new empty-patch flavor, which must not trip the guard.
export async function assertScopedOverridesExperimentGuard(
  context: Context,
  config: ConfigInterface,
  prevOverrides: ScopedOverrideEntry[],
  nextOverrides: ScopedOverrideEntry[],
): Promise<void> {
  const scanContext = getContextForAgendaJobByOrgObject(context.org);
  const all = await scanContext.models.configs.getAllForReconcile();
  const byKey = new Map(all.map((c) => [c.key, c]));
  // An entry can affect served values only if its flavor exists, is live, and
  // carries a non-empty patch (a non-object value replaces wholesale).
  const impactful = (list: ScopedOverrideEntry[]) =>
    list.filter((o) => {
      const flavor = byKey.get(o.config);
      if (!flavor || flavor.archived) return false;
      const obj = parsePlainJSONObject(flavor.value ?? "");
      return !obj || Object.keys(obj).length > 0;
    });
  if (isEqual(impactful(prevOverrides), impactful(nextOverrides))) return;

  await assertConfigExperimentGuard(
    context,
    config,
    { armAcknowledgments: undefined },
    { armed: false },
  );
}

// Capture the arm-time acknowledgment fingerprint when scheduling / auto-arming a
// deferred publish on a guarded config. Returns the sorted conflict keys to store
// on the revision (compared at merge time), or undefined when there is nothing to
// acknowledge (guard off / no live conflict / metadata-only revision). Throws
// SoftWarningError when live conflicts exist and the armer did not acknowledge
// them (?ignoreWarnings=true or bypassApprovalChecks) — arming must be an
// explicit, recorded override. `proposedChanges` (the revision's staged ops, when
// known) lets a metadata-only revision skip the guard, matching the merge-time
// gate so a rename doesn't need acknowledgment to be scheduled.
export async function captureConfigExperimentGuardAcknowledgment(
  context: Context,
  config: ConfigInterface,
  proposedChanges?: unknown,
): Promise<string[] | undefined> {
  // A metadata-only revision can't rewrite a served value (matches the merge
  // gate). Otherwise fall through — the conflict evaluation gates on the whole
  // subtree's guard flags, not this config's own.
  if (
    proposedChanges !== undefined &&
    !configRevisionAffectsServedValue(proposedChanges)
  ) {
    return undefined;
  }

  const conflictKeys = await evaluateConfigExperimentGuardConflicts(
    context,
    config,
  );
  if (conflictKeys.size === 0) return undefined;

  const sortedKeys = [...conflictKeys].sort();
  const override =
    context.ignoreWarnings ||
    context.permissions.canBypassApprovalChecks({
      project: config.project || "",
    });
  if (!override) {
    throw new SoftWarningError(
      `Scheduling this publish will rewrite the live value served to a running experiment (config keys: ${sortedKeys.join(
        ", ",
      )}). Re-submit with ignoreWarnings to acknowledge and schedule.`,
      sortedKeys,
    );
  }
  return sortedKeys;
}

// The conflict set for publishing `constant`: running experiments whose live
// served value would shift because the constant feeds them. Two paths, unioned:
//   (A) DIRECT — a feature's experiment-ref/bandit-ref rule interpolates
//       `@const:key` straight in an arm value (keys: `exp:<id>`).
//   (B) CONFIG-BACKED — a GUARDED config that (transitively) references the
//       constant serves a running experiment (keys: the config keys). The
//       resolvable graph folds in `@const:` chains and descendant lineage.
// Path (B) is what the config guard covers transitively; path (A) closes the gap
// where no config sits between the constant and the experiment.
export async function evaluateConstantExperimentGuardConflicts(
  context: Context,
  constant: Pick<ConstantInterface, "key" | "project">,
): Promise<Set<string>> {
  // Org-wide (unfiltered) scan, mirroring the config guard: a running experiment
  // in any project must be seen or the warning silently misses it.
  const scanContext = getContextForAgendaJobByOrgObject(context.org);

  const conflicts = new Set<string>();

  // (A) Direct feature experiment-ref/bandit-ref references (no config between).
  for (const k of await findRunningExperimentRefsReferencingConstant(
    scanContext,
    constant.key,
  )) {
    conflicts.add(k);
  }

  // (B) Config-backed path.
  const resolvables = await getResolvableValues(scanContext);
  const affected = resolvableDependencyClosure(
    resolvables,
    "constant",
    constant.key,
  );
  const CONFIG_PREFIX = "config:";
  const affectedConfigKeys = [...affected]
    .filter((t) => t.startsWith(CONFIG_PREFIX))
    .map((t) => t.slice(CONFIG_PREFIX.length));

  if (affectedConfigKeys.length) {
    const allConfigs = await scanContext.models.configs.getAllForReconcile();
    const byKey = new Map(allConfigs.map((c) => [c.key, c]));
    const guardedKeys = new Set(
      affectedConfigKeys.filter((k) => byKey.get(k)?.experimentGuard),
    );
    for (const key of guardedKeys) {
      const cfg = byKey.get(key);
      if (!cfg) continue;
      const impl = await getConfigKeyImplementations(scanContext, cfg.id);
      for (const k of computeExperimentGuardConflictKeys(
        impl?.implementations ?? [],
        guardedKeys,
      )) {
        conflicts.add(k);
      }
    }
  }

  return conflicts;
}

// Human-readable rendering of the mixed constant conflict-key set — config keys
// (config-backed path) and `exp:<id>` tokens (direct experiment-ref path) — for
// the warning message.
function describeConstantConflictKeys(keys: string[]): string {
  return keys
    .map((k) =>
      k.startsWith("exp:") ? `experiment ${k.slice(4)}` : `config "${k}"`,
    )
    .join(", ");
}

// Warn (never hard-block) when publishing a constant would rewrite the live
// value served to a running experiment — either through a guarded config or via a
// feature experiment-ref rule that references the constant directly. Mirrors
// assertConfigExperimentGuard: a bypassable soft-warning on a direct publish, a
// re-confirm gate on a deferred (scheduled / auto-publish-on-approval) fire.
export async function assertConstantExperimentGuard(
  context: Context,
  constant: Pick<ConstantInterface, "key" | "project">,
  revision: Pick<Revision, "armAcknowledgments">,
  { armed }: { armed: boolean },
): Promise<void> {
  const conflictKeys = await evaluateConstantExperimentGuardConflicts(
    context,
    constant,
  );

  const synchronousOverride =
    context.ignoreWarnings ||
    context.permissions.canBypassApprovalChecks({
      project: constant.project || "",
    });

  const decision = decideExperimentGuard({
    guardEnabled: true,
    conflictKeys,
    armed,
    ignoreWarnings: synchronousOverride,
    acknowledgedKeys: getArmAcknowledgment(revision, "experiment"),
  });

  if (decision.action === "allow") {
    if (!armed && conflictKeys.size > 0) {
      logger.info(
        {
          constantKey: constant.key,
          userId: context.userId,
          conflictKeys: [...conflictKeys].sort(),
        },
        "Constant experiment guard overridden on a direct publish",
      );
    }
    return;
  }

  const keyList = describeConstantConflictKeys(decision.conflictKeys);
  if (decision.action === "block-immediate") {
    throw new SoftWarningError(
      `Publishing this constant rewrites the live value served to a running experiment (${keyList}). Re-submit with ignoreWarnings to proceed.`,
      decision.conflictKeys,
    );
  }
  throw new TerminalPublishError(
    `Constant publish blocked by the experiment guard: the affected running experiments have changed since this publish was scheduled (now: ${keyList}). Re-open the draft and re-confirm to publish.`,
  );
}

// Snapshot the constant experiment-guard fingerprint when ARMING a deferred
// publish (schedule / auto-publish-on-approval), throwing (bypassably) if live
// conflicts aren't acknowledged. Mirrors captureConfigExperimentGuardAcknowledgment;
// the returned keys are stored on the revision so a later matching fire proceeds.
export async function captureConstantExperimentGuardAcknowledgment(
  context: Context,
  constant: Pick<
    ConstantInterface,
    "key" | "project" | "value" | "environmentValues"
  >,
  proposedChanges?: unknown,
): Promise<string[] | undefined> {
  // A metadata-only revision can't rewrite a served value — nothing to ack.
  if (
    proposedChanges !== undefined &&
    !constantRevisionAffectsServedValue(proposedChanges)
  ) {
    return undefined;
  }

  const conflictKeys = await evaluateConstantExperimentGuardConflicts(
    context,
    constant,
  );
  if (conflictKeys.size === 0) return undefined;

  const sortedKeys = [...conflictKeys].sort();
  const override =
    context.ignoreWarnings ||
    context.permissions.canBypassApprovalChecks({
      project: constant.project || "",
    });
  if (!override) {
    throw new SoftWarningError(
      `Scheduling this publish will rewrite the live value served to a running experiment (${describeConstantConflictKeys(
        sortedKeys,
      )}). Re-submit with ignoreWarnings to acknowledge and schedule.`,
      sortedKeys,
    );
  }
  return sortedKeys;
}
