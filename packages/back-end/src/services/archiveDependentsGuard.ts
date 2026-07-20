import { getConfigParentKey } from "shared/util";
import { Revision } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  getArmAcknowledgment,
  type ArmGuardId,
} from "back-end/src/services/armGuards";
import {
  getDependentConfigs,
  isEmptyConfigPatch,
  loadConstantReferences,
  totalConstantReferences,
} from "back-end/src/services/constants";
import { getFeaturesDependingOnAsPrerequisite } from "back-end/src/services/features";
import {
  loadSavedGroupReferences,
  totalSavedGroupReferences,
} from "back-end/src/services/savedGroups";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { getAllExperimentsForStaleGraph } from "back-end/src/models/ExperimentModel";
import {
  SoftWarningError,
  TerminalPublishError,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

// A uniform, soft (acknowledgeable) guard for archiving an entity that still has
// live dependents. Archiving is never a hard block here — it is a bypassable
// warning, cleared by `ignoreWarnings` (any caller allowed to archive; no
// elevated permission) or the bypass-approval permission. Mirrors the
// schema-break guard's shape exactly: a direct-publish soft assert, an arm-time
// fingerprint capture, and an armed-fire re-check that is terminal only on a NEW
// dependent introduced since arming. Only the archive direction
// (unarchived -> archived) is guarded; unarchiving is never guarded.

const ARCHIVE_DEPENDENTS: ArmGuardId = "archive-dependents";

// The dependents an archive would affect, collected as stable namespaced ids for
// fingerprinting plus count-only messaging info. `featureFlagCount` drives the
// elevated config message (a config consumed by live feature flags). Ids are
// namespaced (`feature:...`, `config:...`) so a key shared across namespaces
// isn't conflated and so a NEW dependent of a different kind still re-contends.
export type ArchiveDependents = {
  ids: string[];
  // Live feature-flag dependents — surfaced only for configs (elevated message).
  featureFlagCount: number;
  // Count-only human parts, e.g. ["3 feature(s)", "2 config(s)"] — never names
  // cross-project resources (the scan is org-wide, so ids could disclose
  // resources in unreadable projects).
  parts: string[];
};

const EMPTY_DEPENDENTS: ArchiveDependents = {
  ids: [],
  featureFlagCount: 0,
  parts: [],
};

function pluralParts(counts: [number, string][]): string[] {
  return counts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
}

// ---------------------------------------------------------------------------
// Per-entity collectors. Each scans org-wide (getContextForAgendaJobByOrgObject)
// so a dependent in a project the actor can't read still counts (fail-safe),
// matching assertFeatureDeletable / assertConstantArchivable.
// ---------------------------------------------------------------------------

// Feature: live features that gate on it as a prerequisite + experiments that
// list it as a prerequisite in their latest phase.
export async function collectFeatureArchiveDependents(
  context: ReqContext | ApiReqContext,
  featureId: string,
): Promise<ArchiveDependents> {
  const scanContext =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  const [dependentFeatureIds, allExperiments] = await Promise.all([
    getFeaturesDependingOnAsPrerequisite(scanContext, featureId),
    // Projected loader (id/status/phases.prerequisites only) — avoids
    // materializing every experiment's analysis blob just to read prerequisites.
    getAllExperimentsForStaleGraph(scanContext),
  ]);
  const dependentExperimentIds = allExperiments
    .filter((e) => {
      const phase = e.phases.slice(-1)?.[0] ?? null;
      return !!phase?.prerequisites?.some((p) => p.id === featureId);
    })
    .map((e) => e.id);

  const ids = [
    ...dependentFeatureIds.map((id) => `feature:${id}`),
    ...dependentExperimentIds.map((id) => `experiment:${id}`),
  ];
  return {
    ids,
    featureFlagCount: dependentFeatureIds.length,
    parts: pluralParts([
      [dependentFeatureIds.length, "feature flag(s)"],
      [dependentExperimentIds.length, "experiment(s)"],
    ]),
  };
}

// Constant: features and constants/configs that reference `@const:key`.
export async function collectConstantArchiveDependents(
  context: ReqContext | ApiReqContext,
  constantId: string,
): Promise<ArchiveDependents> {
  const scanContext =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  const refs = await loadConstantReferences(scanContext, constantId);
  if (!refs || totalConstantReferences(refs) === 0) return EMPTY_DEPENDENTS;
  const ids = [
    ...refs.features.map((f) => `feature:${f.id}`),
    ...refs.constants.map(
      (c) => `${c.isConfig ? "config" : "constant"}:${c.id}`,
    ),
  ];
  return {
    ids,
    featureFlagCount: refs.features.length,
    parts: pluralParts([
      [refs.features.length, "feature(s)"],
      [refs.constants.length, "other constant(s)/config(s)"],
    ]),
  };
}

// Config: live configs that inherit from it (lineage) plus features/configs that
// reference `@config:key` — mirrors assertConfigArchivable's impact decision, but
// returns the dependents as ids instead of throwing. A child config whose live
// value is an empty patch (a no-op) or that nothing serves affects nothing, so it
// reports no dependents (archiving it is silent). TAGS feature-flag consumers via
// featureFlagCount for the elevated message.
export async function collectConfigArchiveDependents(
  context: ReqContext | ApiReqContext,
  config: {
    id: string;
    key: string;
    value?: string;
    parent?: string;
    extends?: string[];
  },
): Promise<ArchiveDependents> {
  const scanContext =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);

  // Cheap, request-memoized reads first (config reconcile snapshot) so the
  // common harmless case can short-circuit BEFORE the expensive feature scan.
  // Live configs depending on this one as a base (parent spine / extends mixin) —
  // archiving dangles their lineage. Always counts.
  const liveLineageDeps = (
    await getDependentConfigs(scanContext, config.key)
  ).filter((c) => !c.archived);

  const allConfigs = await scanContext.models.configs.getAllForReconcile();
  const selectingBases = allConfigs.filter((c) =>
    (c.scopedOverrides ?? []).some((o) => o.config === config.key),
  );
  const isChild =
    (getConfigParentKey(config) ?? null) !== null ||
    (config.extends ?? []).length > 0 ||
    selectingBases.length > 0;

  // Early-out: a child/override whose live patch is empty strips no served value,
  // so with no live lineage dependents it affects nothing — skip the org-wide
  // feature reference scan entirely (the common "archive an unused override" path).
  if (
    isChild &&
    isEmptyConfigPatch(config.value) &&
    liveLineageDeps.length === 0
  ) {
    return EMPTY_DEPENDENTS;
  }

  const refs = await loadConstantReferences(scanContext, config.id);
  const refFeatureIds = refs?.features.map((f) => f.id) ?? [];
  const refConfigIds = refs?.constants.map((c) => c.id) ?? [];

  // Whether archiving would actually strip a served value from its references.
  // A root strips its own value from everything referencing it. A child only
  // matters when its live patch is non-empty AND something serves it (directly,
  // or via a referenced selecting base).
  let referencesCount = false;
  if (!isChild) {
    referencesCount = (refs && totalConstantReferences(refs) > 0) || false;
  } else if (!isEmptyConfigPatch(config.value)) {
    if (refs && totalConstantReferences(refs) > 0) {
      referencesCount = true;
    } else {
      for (const base of selectingBases) {
        const baseRefs = await loadConstantReferences(scanContext, base.id);
        if (baseRefs && totalConstantReferences(baseRefs) > 0) {
          referencesCount = true;
          break;
        }
      }
    }
  }

  const lineageIds = liveLineageDeps.map((c) => `config:${c.id}`);
  const referenceIds = referencesCount
    ? [
        ...refFeatureIds.map((id) => `feature:${id}`),
        ...refConfigIds.map((id) => `config:${id}`),
      ]
    : [];
  const ids = [...new Set([...lineageIds, ...referenceIds])];
  if (!ids.length) return EMPTY_DEPENDENTS;

  return {
    ids,
    featureFlagCount: referencesCount ? refFeatureIds.length : 0,
    parts: pluralParts([
      [referencesCount ? refFeatureIds.length : 0, "feature(s)"],
      [
        liveLineageDeps.length + (referencesCount ? refConfigIds.length : 0),
        "config(s)",
      ],
    ]),
  };
}

// Saved group: features + experiments + other saved groups referencing it.
export async function collectSavedGroupArchiveDependents(
  context: ReqContext | ApiReqContext,
  savedGroupId: string,
): Promise<ArchiveDependents> {
  const scanContext =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  const refs = await loadSavedGroupReferences(scanContext, savedGroupId);
  if (!refs || totalSavedGroupReferences(refs) === 0) return EMPTY_DEPENDENTS;
  const ids = [
    ...refs.features.map((f) => `feature:${f.id}`),
    ...refs.experiments.map((e) => `experiment:${e.id}`),
    ...refs.savedGroups.map((g) => `savedGroup:${g.id}`),
  ];
  return {
    ids,
    featureFlagCount: refs.features.length,
    parts: pluralParts([
      [refs.features.length, "feature(s)"],
      [refs.experiments.length, "experiment(s)"],
      [refs.savedGroups.length, "other Saved Group(s)"],
    ]),
  };
}

// ---------------------------------------------------------------------------
// Uniform enforcement primitives (shared across every entity).
// ---------------------------------------------------------------------------

function isOverridden(context: Context, project: string | undefined): boolean {
  return (
    context.ignoreWarnings ||
    context.permissions.canBypassApprovalChecks({ project: project || "" })
  );
}

// One-line message. `noun` is the archived entity's user-facing noun. When the
// config case has live feature-flag consumers the message is ELEVATED — archiving
// will break running flags — so the front-end can render a stronger confirmation.
function archiveMessage(
  noun: string,
  dependents: ArchiveDependents,
  { elevated }: { elevated: boolean },
): string {
  if (elevated && dependents.featureFlagCount > 0) {
    return `This config is consumed by ${dependents.featureFlagCount} live feature flag(s) — archiving it will break them.`;
  }
  return `Archiving this ${noun} affects ${dependents.parts.join(", ")}.`;
}

// The dependents present at a deferred fire that weren't acknowledged when the
// publish was scheduled — i.e. NEW dependents introduced since arming.
// Membership, so order/dedup doesn't matter. Pure (exported for tests).
export function unacknowledgedArchiveDependents(
  currentIds: string[],
  acknowledged: string[] | null | undefined,
): string[] {
  const ack = new Set(acknowledged ?? []);
  return currentIds.filter((id) => !ack.has(id));
}

// Resolve a direct (unarmed) archive publish: clear when no dependents, bypass on
// ignoreWarnings / approval-bypass (logged), else a bypassable soft warning.
function resolveDirectArchiveDependents(
  context: Context,
  dependents: ArchiveDependents,
  project: string | undefined,
  logKey: Record<string, unknown>,
  message: string,
): void {
  if (!dependents.ids.length) return;
  if (isOverridden(context, project)) {
    logger.info(
      { ...logKey, userId: context.userId, dependents: dependents.ids },
      "Archive-dependents guard overridden on a direct publish",
    );
    return;
  }
  throw new SoftWarningError(
    `${message} Re-submit with ignoreWarnings to archive anyway.`,
    dependents.parts,
  );
}

// Decide an ARMED (deferred) fire against the arm-time fingerprint: a dependent
// not acknowledged when scheduling is a NEW dependent introduced since — the
// deferred publish is terminal (re-open + re-confirm). Acknowledged dependents
// stand (the armer already accepted them); a dependent that went away is a
// covered subset and never blocks.
function assertArmedArchiveAcknowledged(
  dependents: ArchiveDependents,
  revision: Pick<Revision, "armAcknowledgments"> | undefined,
  entityMessage: string,
): void {
  const unacknowledged = unacknowledgedArchiveDependents(
    dependents.ids,
    revision && getArmAcknowledgment(revision, ARCHIVE_DEPENDENTS),
  );
  if (!unacknowledged.length) return;
  throw new TerminalPublishError(
    `${entityMessage} since this publish was scheduled. Re-open the draft and re-confirm to publish.`,
  );
}

// Arm-time fingerprint (sorted, deduped dependent ids) for a deferred archive
// publish. The armer must acknowledge (bypassably) to schedule; the deferred fire
// re-checks against this. Returns undefined when nothing depends on the entity.
function captureArchiveDependentsAcknowledgment(
  context: Context,
  dependents: ArchiveDependents,
  project: string | undefined,
  message: string,
): string[] | undefined {
  if (!dependents.ids.length) return undefined;
  if (!isOverridden(context, project)) {
    throw new SoftWarningError(
      `${message} Re-submit with ignoreWarnings to acknowledge and schedule.`,
      dependents.parts,
    );
  }
  return [...new Set(dependents.ids)].sort();
}

// ---------------------------------------------------------------------------
// Per-entity guard wrappers (direct assert + arm capture), mirroring the
// schema-break guard's assert*/capture* pairs.
// ---------------------------------------------------------------------------

export async function assertConfigArchiveDependentsGuard(
  context: Context,
  config: {
    id: string;
    key: string;
    project?: string;
    value?: string;
    parent?: string;
    extends?: string[];
  },
  { armed }: { armed: boolean },
  revision?: Pick<Revision, "armAcknowledgments">,
): Promise<void> {
  const dependents = await collectConfigArchiveDependents(context, config);
  if (armed) {
    assertArmedArchiveAcknowledged(
      dependents,
      revision,
      "Archiving this config would newly break dependent config, feature, or experiment(s)",
    );
    return;
  }
  resolveDirectArchiveDependents(
    context,
    dependents,
    config.project,
    { configKey: config.key },
    archiveMessage("config", dependents, { elevated: true }),
  );
}

export async function captureConfigArchiveDependentsAcknowledgment(
  context: Context,
  config: {
    id: string;
    key: string;
    project?: string;
    value?: string;
    parent?: string;
    extends?: string[];
  },
): Promise<string[] | undefined> {
  const dependents = await collectConfigArchiveDependents(context, config);
  return captureArchiveDependentsAcknowledgment(
    context,
    dependents,
    config.project,
    `Scheduling this config archive affects ${dependents.parts.join(", ")}.`,
  );
}

export async function assertConstantArchiveDependentsGuard(
  context: Context,
  constant: { id: string; key: string; project?: string },
  { armed }: { armed: boolean },
  revision?: Pick<Revision, "armAcknowledgments">,
): Promise<void> {
  const dependents = await collectConstantArchiveDependents(
    context,
    constant.id,
  );
  if (armed) {
    assertArmedArchiveAcknowledged(
      dependents,
      revision,
      "Archiving this constant would newly break dependent feature or constant/config(s)",
    );
    return;
  }
  resolveDirectArchiveDependents(
    context,
    dependents,
    constant.project,
    { constantKey: constant.key },
    archiveMessage("constant", dependents, { elevated: false }),
  );
}

export async function captureConstantArchiveDependentsAcknowledgment(
  context: Context,
  constant: { id: string; key: string; project?: string },
): Promise<string[] | undefined> {
  const dependents = await collectConstantArchiveDependents(
    context,
    constant.id,
  );
  return captureArchiveDependentsAcknowledgment(
    context,
    dependents,
    constant.project,
    `Scheduling this constant archive affects ${dependents.parts.join(", ")}.`,
  );
}

// Feature archive: a publish-time soft gate (features have no arm-acknowledgment
// machinery — see below), so this is direct-only. Callers gate on the archive
// transition (revision sets archived true && !feature.archived).
export async function assertFeatureArchiveDependentsGuard(
  context: Context,
  feature: { id: string; project?: string },
): Promise<void> {
  const dependents = await collectFeatureArchiveDependents(context, feature.id);
  resolveDirectArchiveDependents(
    context,
    dependents,
    feature.project,
    { featureId: feature.id },
    archiveMessage("feature flag", dependents, { elevated: false }),
  );
}

export async function assertSavedGroupArchiveDependentsGuard(
  context: Context,
  savedGroup: { id: string },
  { armed }: { armed: boolean },
  revision?: Pick<Revision, "armAcknowledgments">,
): Promise<void> {
  const dependents = await collectSavedGroupArchiveDependents(
    context,
    savedGroup.id,
  );
  if (armed) {
    assertArmedArchiveAcknowledged(
      dependents,
      revision,
      "Archiving this Saved Group would newly break dependent feature, experiment, or Saved Group(s)",
    );
    return;
  }
  resolveDirectArchiveDependents(
    context,
    dependents,
    undefined,
    { savedGroupId: savedGroup.id },
    archiveMessage("Saved Group", dependents, { elevated: false }),
  );
}

export async function captureSavedGroupArchiveDependentsAcknowledgment(
  context: Context,
  savedGroup: { id: string },
): Promise<string[] | undefined> {
  const dependents = await collectSavedGroupArchiveDependents(
    context,
    savedGroup.id,
  );
  return captureArchiveDependentsAcknowledgment(
    context,
    dependents,
    undefined,
    `Scheduling this Saved Group archive affects ${dependents.parts.join(
      ", ",
    )}.`,
  );
}

// Whether a config archive has any live feature-flag consumers, for the elevated
// gate message. Exposed so the adapter's collectPublishGates can build the same
// elevated wording as the direct assert without re-collecting twice.
export function archiveDependentsGateMessage(
  noun: "config" | "constant" | "feature flag" | "Saved Group",
  dependents: ArchiveDependents,
): string {
  return archiveMessage(noun, dependents, { elevated: noun === "config" });
}
