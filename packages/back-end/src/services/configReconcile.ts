import {
  getConfigSubtree,
  getAncestorSchemaKeys,
  stripAncestorOwnedFields,
  findSiblingSchemaConflicts,
  computeConfigSchemaChangeImpact,
  ConfigSchemaChangeImpact,
  isConfigLocked,
} from "shared/util";
import { ConfigInterface } from "shared/types/config";
import { CasConflictError } from "back-end/src/models/BaseModel";
import {
  BadRequestError,
  SoftWarningError,
  TerminalPublishError,
} from "back-end/src/util/errors";
import type { Context } from "back-end/src/models/BaseModel";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { logger } from "back-end/src/util/logger";

// Throw if any descendant of `rootKey` (via ANY base edge — `parent` or
// `extends`) would inherit the same field from two sibling branches. A
// strip-based reconcile can't resolve that (no single owner), so it's surfaced
// as a hard error. Pure read over the supplied `byKey` snapshot — no mutation.
function assertNoSiblingConflictsInSubtree(
  byKey: Map<string, ConfigInterface>,
  rootKey: string,
): void {
  const subtree = getConfigSubtree(rootKey, [...byKey.values()]);
  for (const key of subtree) {
    if (key === rootKey) continue;
    const node = byKey.get(key);
    if (!node) continue;
    const conflicts = findSiblingSchemaConflicts(node, byKey);
    if (conflicts.length) {
      const detail = conflicts
        .map((c) => `"${c.key}" (declared by ${c.owners.join(" and ")})`)
        .join(", ");
      throw new BadRequestError(
        `This change makes Config "${key}" inherit the same field from two ` +
          `separate branches, with no single owner: ${detail}. Remove the ` +
          `duplicate declaration from one branch before publishing.`,
      );
    }
  }
}

// Dry run of the descendant sibling-conflict check, evaluated against the
// PROPOSED root (a not-yet-persisted `{ ...existing, ...changes }` doc). Call
// this BEFORE the live root write so a publish that would create an unresolvable
// sibling conflict at a descendant is rejected with nothing persisted — instead
// of committing the root and then throwing from `reconcileConfigDescendants`
// (which would leave the root changed while a descendant carries an at-rest
// conflict).
//
// ACCEPTED RACE (TOCTOU): this validates a snapshot read here, but a concurrent
// write to another family member between this check and the live write could
// still introduce a conflict the dry run didn't see. We accept that residual
// race rather than locking the whole config family across the read→validate→
// write window (the contention isn't worth it for a rare, self-healing case).
// The hit is minimized by:
// - the CAS-guarded revision merge (a concurrent merge of the same revision
// can't double-apply), which keeps the vulnerable window to the gap between
// this check and the immediately-following write; and
// - the post-write `reconcileConfigDescendants` net, which still runs and will
// surface/normalize anything that slipped through (at the cost of the
// documented partial-write only in that rare interleaving).
export async function assertConfigDescendantsReconcilable(
  context: Context,
  proposedRoot: ConfigInterface,
): Promise<void> {
  const all = await context.models.configs.getAllForReconcile();
  const byKey = new Map(all.map((c) => [c.key, c]));
  // Substitute the proposed (unwritten) root so the conflict walk sees the
  // change's effect on descendants.
  byKey.set(proposedRoot.key, proposedRoot);
  assertNoSiblingConflictsInSubtree(byKey, proposedRoot.key);
}

function formatImpactLine(impact: ConfigSchemaChangeImpact): string {
  const quote = (keys: string[]) => keys.map((k) => `"${k}"`).join(", ");
  const parts: string[] = [];
  if (impact.orphanedKeys.length) {
    parts.push(`overrides removed field(s) ${quote(impact.orphanedKeys)}`);
  }
  if (impact.newlyIncompatibleKeys.length) {
    parts.push(
      `has value(s) that no longer match retyped field(s) ` +
        quote(impact.newlyIncompatibleKeys),
    );
  }
  if (impact.conflictingStripKeys.length) {
    parts.push(
      `declares conflicting field(s) ${quote(impact.conflictingStripKeys)} ` +
        `that would be dropped`,
    );
  }
  for (const ref of impact.invariantRefs) {
    parts.push(
      `validation rule "${ref.name}" references removed field(s) ` +
        quote(ref.keys),
    );
  }
  const name = impact.configName
    ? `"${impact.configName}" (${impact.configKey})`
    : `"${impact.configKey}"`;
  return `${name}: ${parts.join("; ")}`;
}

// Soft publish gate: warn when a proposed root schema/lineage change removes or
// retypes fields that descendants still override or reference, or would drop a
// descendant's contract-differing declaration via the cascade. Bypassable with
// `?ignoreWarnings=true`. Always soft on a synchronous publish, regardless of
// `blockPublishOnSchemaError`: the warning is about OTHER configs' state, not
// the written value, so it must never hard-block an ancestor's own legitimate
// publish — and for the same reason it ignores `skipSchemaValidation`.
//
// On a DEFERRED merge (scheduled poller / auto-publish-on-approval) there is no
// user to warn and request-less contexts force `ignoreWarnings=true`, which says
// nothing about intent — so instead of silently skipping, a tripped warning is a
// TERMINAL failure: the publish is rejected, the draft stays open, and the
// `revision.publishFailed` webhook fires. The publisher re-publishes manually
// with `ignoreWarnings` to push through.
export async function assertConfigSchemaChangeSafeForDescendants(
  context: Context,
  proposedRoot: ConfigInterface,
  opts?: { deferred?: boolean },
): Promise<void> {
  if (!opts?.deferred && context.ignoreWarnings) return;
  const before = await context.models.configs.getAllForReconcile();
  const after = before.map((c) =>
    c.key === proposedRoot.key ? proposedRoot : c,
  );
  const impacts = computeConfigSchemaChangeImpact({
    rootKey: proposedRoot.key,
    before,
    after,
  });
  if (!impacts.length) return;
  const lines = impacts.map(formatImpactLine);
  const message =
    `This change removes, retypes, or takes over fields that ` +
    `${impacts.length} descendant Config(s) still use:\n` +
    lines.join("\n");
  if (opts?.deferred) {
    throw new TerminalPublishError(message);
  }
  throw new SoftWarningError(message, lines);
}

// The gate form of the schema-change-impact warning above, evaluated at plan
// time (the read context decides the baseline — under the bulk publisher's
// per-item overlay, `before` already reflects the other items' proposals).
// Cleared by ignoreWarnings alone, matching the assert.
export async function collectConfigSchemaChangeImpactGates(
  context: Context,
  proposedRoot: ConfigInterface,
): Promise<PublishGate[]> {
  const before = await context.models.configs.getAllForReconcile();
  const after = before.map((c) =>
    c.key === proposedRoot.key ? proposedRoot : c,
  );
  const impacts = computeConfigSchemaChangeImpact({
    rootKey: proposedRoot.key,
    before,
    after,
  });
  if (!impacts.length) return [];
  return [
    {
      type: "schema-change-impact",
      severity: "warning",
      messages: [
        `This change removes, retypes, or takes over fields that ${impacts.length} descendant Config(s) still use:`,
        ...impacts.map(formatImpactLine),
      ],
      override: "ignoreWarnings",
      requiresPermission: null,
      resolution: null,
    },
  ];
}

// Re-run "base wins" normalization across every descendant of `rootKey` after
// that config's schema changes.
//
// When a base (ancestor) config publishes a new field, any descendant that had
// already declared that key must drop its own definition: the ancestor now owns
// it, and the descendant keeps only a value override. We walk the subtree base
// → leaf so each node is reconciled against an already-normalized ancestor set,
// and apply each strip as a system write (`dangerousUpdateBypassPermission`) so
// the cascade isn't blocked by per-config/per-project edit permissions — the
// acting user only published the base.
//
// The root itself is skipped: it's normalized against its own ancestors on its
// primary write (see ConfigModel.normalizeSchemaAgainstAncestors).
//
// Reconcile-or-error: where an ancestor legitimately owns a descendant's field
// we strip it (base wins). But a base's new field can also collide with a
// SIBLING base at a shared (composing) descendant — there's no valid field to
// strip there, since neither base is the other's ancestor. That's a structural
// composition error, so we detect it up front and throw before mutating any
// descendant.
/**
 * One descendant write the cascade performed: the doc it wrote against, and the
 * fields it wrote. Compensation needs the PRE-IMAGE because
 * `stripAncestorOwnedFields` can only REMOVE keys — re-running the cascade against
 * a restored root can never un-strip one, so a root-only rollback silently deletes
 * a field from a config the user never touched.
 */
export type ConfigCascadeWrite = {
  before: ConfigInterface;
  written: Record<string, unknown>;
};

export async function reconcileConfigDescendants(
  context: Context,
  rootKey: string,
  // Called as each descendant write LANDS, before its audit and afterUpdate hooks.
  // The cascade is the one entity write in a compensated landing that used to
  // persist silently.
  onDescendantWritten?: (write: ConfigCascadeWrite) => void,
): Promise<void> {
  const all = await context.models.configs.getAllForReconcile();
  const byKey = new Map(all.map((c) => [c.key, c]));

  const subtree = getConfigSubtree(rootKey, all);

  // Pre-check: a composing descendant may now have two sibling bases declaring
  // the same field. Strip-based reconciliation can't resolve that (no winner),
  // so surface it before touching any descendant. (The publish paths also run
  // this as a dry run BEFORE the root write — see
  // assertConfigDescendantsReconcilable — so reaching it here means a concurrent
  // write slipped a conflict in; we still refuse to corrupt descendants.)
  assertNoSiblingConflictsInSubtree(byKey, rootKey);

  for (const key of subtree) {
    if (key === rootKey) continue;
    const node = byKey.get(key);
    if (!node) continue;

    // A locked descendant is pinned at its published revision — never rewrite its
    // stored schema as a side effect of an ancestor's publish (the lock is what
    // makes the pin trustworthy for reproducible builds). Skipping, not erroring:
    // this runs post-merge, so throwing would strand the root as published with a
    // half-applied cascade; and base-wins resolution already serves the locked
    // descendant correctly with its (now-redundant, identical-contract) declaration
    // left in place. It re-normalizes on the descendant's own next publish.
    if (isConfigLocked(node)) {
      logger.info(
        { rootKey, lockedDescendant: node.key },
        "Config reconcile skipped a locked descendant (schema left pinned)",
      );
      continue;
    }

    // Guarded read-decide-write per descendant, retried: the walk computes from
    // its snapshot, and a descendant PUBLISH landing between that snapshot and
    // an unguarded write would be replaced by stale reconciliation output. On a
    // loss, re-read the descendant and recompute against ITS new schema — the
    // publish that beat us already normalized against the current ancestors, so
    // a second loss usually means nothing is left to strip.
    let current = node;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const ancestorKeys = getAncestorSchemaKeys(current, byKey);
      const kept = stripAncestorOwnedFields(current.schema, ancestorKeys);
      if (!kept) {
        byKey.set(current.key, current);
        break;
      }

      const newSchema = {
        ...current.schema,
        type: current.schema?.type ?? ("object" as const),
        fields: kept,
      };
      try {
        const preImage = current;
        const updated = await context.models.configs.updateIfUnchanged(
          current,
          { schema: newSchema },
          undefined,
          // Same authority contract as the bypass write this replaces: the
          // cascade acts under the ancestor publish already authorized.
          {
            dangerouslyBypassCanUpdate: true,
            // Reported from inside the write, so a later descendant's failure can
            // put THIS one back. `preImage` is the doc this attempt wrote against —
            // after a CAS retry that is the refreshed row, which is what ownership
            // has to be judged against.
            onWritten: () =>
              onDescendantWritten?.({
                before: preImage,
                written: { schema: newSchema },
              }),
          },
        );
        // Keep the working map current so a deeper descendant sees the parent's
        // post-strip schema when computing its own ancestor-owned keys.
        byKey.set(updated.key, updated);
        break;
      } catch (e) {
        if (e instanceof CasConflictError && attempt < 3) {
          const fresh = await context.models.configs.getById(current.id);
          if (!fresh) break;
          current = fresh;
          continue;
        }
        throw e;
      }
    }
  }
}
