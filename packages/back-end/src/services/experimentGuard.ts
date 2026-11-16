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
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";

// Experiment guard: an opt-in, per-config, computed-live soft-block on publishing
// a config whose value is served to a RUNNING experiment. Publishing rewrites the
// value that experiment's live variation arm resolves to, mid-flight and without
// re-bucketing. The block is computed on demand (never a stored lock), so it
// evaporates on its own once the experiment stops.
//
// This module is the pure decision core — no I/O — so it can be unit-tested hard.
// The service layer feeds it the live usage implementations and the arm-time
// fingerprint; the adapter/handlers act on the returned decision.

// A conflict key names BOTH the served config and the running experiment (or
// contextual bandit) reading it — `<configKey>|exp:<id>` / `<configKey>|cb:<id>`
// — so the arm-time acknowledgment fingerprint goes stale when a DIFFERENT
// experiment starts on an already-acknowledged config between arm and fire.
// (Config-key-only identity let that publish slip through as "acknowledged",
// silently disrupting an experiment the armer never saw.) Falls back to the
// bare config key when the implementation carries no experiment identity.
function experimentGuardConflictKey(
  impl: Pick<
    ConfigKeyImplementation,
    "configKey" | "experimentId" | "contextualBanditId"
  >,
): string {
  const subject = impl.experimentId
    ? `exp:${impl.experimentId}`
    : impl.contextualBanditId
      ? `cb:${impl.contextualBanditId}`
      : null;
  return subject ? `${impl.configKey}|${subject}` : impl.configKey;
}

// What a conflict key stands for, so warnings can name it; the key itself is
// only the arm-time acknowledgment fingerprint.
export type ExperimentGuardConflict = {
  experiment: { id: string; name: string; bandit: boolean } | null;
  // Null when the experiment's rule references the published Constant directly.
  configKey: string | null;
  featureIds: Set<string>;
};
export type ExperimentGuardConflicts = Map<string, ExperimentGuardConflict>;

function addExperimentGuardConflict(
  conflicts: ExperimentGuardConflicts,
  key: string,
  conflict: ExperimentGuardConflict,
): void {
  const existing = conflicts.get(key);
  if (!existing) {
    conflicts.set(key, conflict);
    return;
  }
  for (const id of conflict.featureIds) existing.featureIds.add(id);
}

// Ids the publisher can read; the guard scans org-wide, so anything else stays unnamed.
export type ExperimentGuardReadable = {
  experiments: Set<string>;
  configs: Set<string>;
  features: Set<string>;
};

// MarkdownLinks can't match a label containing square brackets.
const markdownLink = (label: string, href: string): string =>
  `[${label.replace(/\[/g, "(").replace(/]/g, ")")}](${href})`;

// A self-contained line for the "Save anyway" dialog, which renders Markdown links.
export function describeExperimentGuardConflict(
  { experiment, configKey, featureIds }: ExperimentGuardConflict,
  readable: ExperimentGuardReadable,
): string {
  const noun = experiment?.bandit ? "Contextual Bandit" : "experiment";
  const path = experiment?.bandit ? "contextual-bandit" : "experiment";
  const subject = !experiment
    ? "a running experiment"
    : readable.experiments.has(experiment.id)
      ? `running ${noun} ${markdownLink(experiment.name, `/${path}/${experiment.id}`)}`
      : `a running ${noun} you can't access`;
  const source = !configKey
    ? "this Constant"
    : readable.configs.has(configKey)
      ? `Config ${markdownLink(configKey, `/configs/${configKey}`)}`
      : "a Config you can't access";
  const flags = [...featureIds]
    .filter((id) => readable.features.has(id))
    .map((id) => markdownLink(id, `/features/${id}`));
  const via = flags.length
    ? ` via Feature Flag${flags.length > 1 ? "s" : ""} ${flags.join(", ")}`
    : "";
  return `Publishing changes the live value that ${subject} reads from ${source}${via}.`;
}

// Whose read access bounds what a guard warning names.
export function guardWarningReader(context: Context): Context {
  return context.warningReaderContext ?? context;
}

// Why the conflicts matter and what to do instead, closing every guard warning.
const EXPERIMENT_GUARD_CONSEQUENCE =
  "Changing what a running experiment serves partway through can invalidate its results. To avoid this, schedule the publish for after the experiment stops.";

// One line per conflict, in conflict-key order, naming only what the publisher can read, then the consequence.
export async function describeExperimentGuardConflicts(
  context: Context,
  conflicts: ExperimentGuardConflicts,
): Promise<string[]> {
  const values = [...conflicts.values()];
  const refIds = (bandit: boolean) =>
    values.flatMap(({ experiment }) =>
      experiment?.bandit === bandit ? [experiment.id] : [],
    );
  const configKeys = new Set(
    values.flatMap(({ configKey }) => (configKey ? [configKey] : [])),
  );
  const featureIds = new Set(values.flatMap((c) => [...c.featureIds]));
  // Loaded with the publisher's context, so each list holds only what they can read.
  const reader = guardWarningReader(context);
  const [experiments, bandits, configs, features] = await Promise.all([
    getExperimentsByIds(reader, refIds(false)),
    reader.models.contextualBandits.getByIds(refIds(true)),
    Promise.all([...configKeys].map((k) => reader.models.configs.getByKey(k))),
    getFeaturesByIds(reader, [...featureIds]),
  ]);
  const readable: ExperimentGuardReadable = {
    experiments: new Set([...experiments, ...bandits].map((e) => e.id)),
    configs: new Set(configs.flatMap((c) => (c ? [c.key] : []))),
    features: new Set(features.map((f) => f.id)),
  };
  const lines = [...conflicts]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, conflict]) => describeExperimentGuardConflict(conflict, readable));
  // Conflicts the publisher can't read can describe identically.
  return [...new Set(lines), EXPERIMENT_GUARD_CONSEQUENCE];
}

// The conflict set for publishing this config: configs affected by the publish
// (itself or a descendant, via base-wins inheritance) whose LIVE value backs a
// running experiment's variation arm AND that have the guard enabled, keyed per
// (config, experiment). Guarding is a property of the SERVED config, not the
// edited one — so publishing an unguarded ancestor still conflicts when a
// guarded descendant it feeds serves a running experiment. Ancestors and
// lateral mixins are excluded — publishing this config doesn't change their
// value.
export function computeExperimentGuardConflicts(
  implementations: Pick<
    ConfigKeyImplementation,
    | "featureId"
    | "configKey"
    | "relation"
    | "experimentStatus"
    | "state"
    | "experimentId"
    | "contextualBanditId"
    | "experimentName"
  >[],
  guardedConfigKeys: Set<string>,
): ExperimentGuardConflicts {
  const conflicts: ExperimentGuardConflicts = new Map();
  for (const impl of implementations) {
    // Only a running experiment's live arm is at risk. A draft feature revision
    // referencing the config isn't serving anything yet.
    if (impl.experimentStatus !== "running") continue;
    if (impl.state !== "live") continue;
    if (impl.relation !== "self" && impl.relation !== "descendant") continue;
    // Only when the config actually serving the value opted into the guard.
    if (!guardedConfigKeys.has(impl.configKey)) continue;
    const id = impl.experimentId || impl.contextualBanditId;
    addExperimentGuardConflict(conflicts, experimentGuardConflictKey(impl), {
      experiment: id
        ? {
            id,
            name: impl.experimentName || id,
            bandit: !impl.experimentId,
          }
        : null,
      configKey: impl.configKey,
      featureIds: new Set([impl.featureId]),
    });
  }
  return conflicts;
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
): Promise<ExperimentGuardConflicts> {
  const guardedConfigKeys = new Set(
    getConfigSubtree(key, allConfigs).filter(
      (k) => byKey.get(k)?.experimentGuard,
    ),
  );
  if (guardedConfigKeys.size === 0) return new Map();
  const impl = await getConfigKeyImplementations(scanContext, id);
  return computeExperimentGuardConflicts(
    impl?.implementations ?? [],
    guardedConfigKeys,
  );
}

// The live conflict set for publishing this config. Empty when no guarded config
// whose value this publish changes is currently serving a running experiment.
export async function evaluateConfigExperimentGuardConflicts(
  context: Context,
  config: ConfigInterface,
): Promise<ExperimentGuardConflicts> {
  // Scan usage with an org-wide (unfiltered) context: the guard must see a
  // running experiment served by a config-backed feature in ANY project — even
  // one the acting user can't read — or it silently finds no conflict and the
  // publish rewrites that experiment's live arm. (The UI usage table keeps the
  // request context; only this guard path needs global coverage.)
  const scanContext =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  const allConfigs = await scanContext.models.configs.getAllForReconcile();
  const byKey = new Map(allConfigs.map((c) => [c.key, c]));

  // Publishing this config rewrites the resolved value of its own subtree AND of
  // every base that selects it as a flavor (the flavor→base edge). Evaluate each
  // affected root's subtree independently — `getConfigKeyImplementations` scopes
  // its implementations + relation classification to the config it's called on,
  // so a selecting base's usage is only seen when that base is the evaluated
  // root, not by widening the current config's guarded-key set.
  const conflicts: ExperimentGuardConflicts = new Map();
  for (const rootKey of configPublishAffectedRoots(allConfigs, config.key)) {
    const root = byKey.get(rootKey);
    if (!root) continue;
    for (const [k, conflict] of await conflictsForConfigPublish(
      scanContext,
      allConfigs,
      byKey,
      root.key,
      root.id,
    )) {
      addExperimentGuardConflict(conflicts, k, conflict);
    }
  }
  return conflicts;
}

// Enforce the experiment guard for a config publish. `armed` = a deferred merge
// (scheduled publish or auto-publish-on-approval), whose override is the arm-time
// fingerprint on the revision; unarmed = a direct manual publish, which honors an
// explicit synchronous override (`?ignoreWarnings=true` or FlagsBypassApprovals).
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
  const conflicts = await evaluateConfigExperimentGuardConflicts(
    context,
    config,
  );
  const conflictKeys = new Set(conflicts.keys());

  const synchronousOverride =
    context.ignoreWarnings ||
    context.permissions.canBypassFlagApprovalChecks(
      { project: config.project || "" },
      "config",
    );

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

  if (decision.action === "block-immediate") {
    const lines = await describeExperimentGuardConflicts(context, conflicts);
    throw new SoftWarningError(
      `${lines.join(" ")} Re-submit with ignoreWarnings to proceed.`,
      lines,
    );
  }
  // Names nothing: stored on the draft and sent to webhooks, whose readers may differ.
  throw new TerminalPublishError(
    `Config publish blocked by the experiment guard: the running experiments affected have changed since this publish was scheduled. Re-open the draft and re-confirm to publish.`,
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
  const scanContext =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
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
// them (?ignoreWarnings=true or FlagsBypassApprovals) — arming must be an
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

  const conflicts = await evaluateConfigExperimentGuardConflicts(
    context,
    config,
  );
  if (conflicts.size === 0) return undefined;

  const sortedKeys = [...conflicts.keys()].sort();
  const override =
    context.ignoreWarnings ||
    context.permissions.canBypassFlagApprovalChecks(
      { project: config.project || "" },
      "config",
    );
  if (!override) {
    const lines = await describeExperimentGuardConflicts(context, conflicts);
    throw new SoftWarningError(
      `${lines.join(" ")} Re-submit with ignoreWarnings to acknowledge and schedule.`,
      lines,
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
): Promise<ExperimentGuardConflicts> {
  // Org-wide (unfiltered) scan, mirroring the config guard: a running experiment
  // in any project must be seen or the warning silently misses it.
  const scanContext =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);

  const conflicts: ExperimentGuardConflicts = new Map();

  // (A) Direct feature experiment-ref/bandit-ref references (no config between).
  for (const ref of await findRunningExperimentRefsReferencingConstant(
    scanContext,
    constant.key,
  )) {
    // `exp:` for bandits too — retyping would invalidate stored arm-time fingerprints.
    addExperimentGuardConflict(conflicts, `exp:${ref.id}`, {
      experiment: { id: ref.id, name: ref.name || ref.id, bandit: ref.bandit },
      configKey: null,
      featureIds: ref.featureIds,
    });
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
      for (const [k, conflict] of computeExperimentGuardConflicts(
        impl?.implementations ?? [],
        guardedKeys,
      )) {
        addExperimentGuardConflict(conflicts, k, conflict);
      }
    }
  }

  return conflicts;
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
  const conflicts = await evaluateConstantExperimentGuardConflicts(
    context,
    constant,
  );
  const conflictKeys = new Set(conflicts.keys());

  const synchronousOverride =
    context.ignoreWarnings ||
    context.permissions.canBypassFlagApprovalChecks(
      { project: constant.project || "" },
      "constant",
    );

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

  if (decision.action === "block-immediate") {
    const lines = await describeExperimentGuardConflicts(context, conflicts);
    throw new SoftWarningError(
      `${lines.join(" ")} Re-submit with ignoreWarnings to proceed.`,
      lines,
    );
  }
  throw new TerminalPublishError(
    `Constant publish blocked by the experiment guard: the affected running experiments have changed since this publish was scheduled. Re-open the draft and re-confirm to publish.`,
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

  const conflicts = await evaluateConstantExperimentGuardConflicts(
    context,
    constant,
  );
  if (conflicts.size === 0) return undefined;

  const sortedKeys = [...conflicts.keys()].sort();
  const override =
    context.ignoreWarnings ||
    context.permissions.canBypassFlagApprovalChecks(
      { project: constant.project || "" },
      "constant",
    );
  if (!override) {
    const lines = await describeExperimentGuardConflicts(context, conflicts);
    throw new SoftWarningError(
      `${lines.join(" ")} Re-submit with ignoreWarnings to acknowledge and schedule.`,
      lines,
    );
  }
  return sortedKeys;
}
