import { ConfigInterface } from "shared/types/config";
import { Revision } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import {
  ConfigKeyImplementation,
  getConfigKeyImplementations,
} from "back-end/src/services/constants";
import {
  SoftWarningError,
  TerminalPublishError,
} from "back-end/src/util/errors";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
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
// running experiment's variation arm. Ancestors and lateral mixins are excluded —
// publishing this config doesn't change their value.
export function computeExperimentGuardConflictKeys(
  implementations: Pick<
    ConfigKeyImplementation,
    "configKey" | "relation" | "experimentStatus" | "state"
  >[],
): Set<string> {
  const keys = new Set<string>();
  for (const impl of implementations) {
    // Only a running experiment's live arm is at risk. A draft feature revision
    // referencing the config isn't serving anything yet.
    if (impl.experimentStatus !== "running") continue;
    if (impl.state !== "live") continue;
    if (impl.relation === "self" || impl.relation === "descendant") {
      keys.add(impl.configKey);
    }
  }
  return keys;
}

// Key-identity comparison of the current conflict set against an acknowledged
// fingerprint. Order-independent, value-independent (keys only) — so re-opening a
// stale-failed publish and editing the values shipped for those keys doesn't
// change the conflict identity.
export function experimentGuardKeySetsEqual(
  a: Set<string>,
  b: Iterable<string> | null | undefined,
): boolean {
  const bSet = b instanceof Set ? b : new Set(b ?? []);
  if (a.size !== bSet.size) return false;
  for (const k of a) if (!bSet.has(k)) return false;
  return true;
}

export type ExperimentGuardDecision =
  // No guard, no conflicts, an explicit synchronous override, or a deferred merge
  // whose acknowledged fingerprint still matches.
  | { action: "allow" }
  // Direct (synchronous) publish hit live conflicts and the caller did not pass
  // ignoreWarnings — surface a soft-block (422) naming the keys so the user can
  // acknowledge and re-submit.
  | { action: "block-immediate"; conflictKeys: string[] }
  // A deferred (armed) merge whose live conflict set no longer matches what was
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
    if (experimentGuardKeySetsEqual(conflictKeys, acknowledgedKeys)) {
      return { action: "allow" };
    }
    return { action: "block-deferred", conflictKeys: [...conflictKeys].sort() };
  }

  if (ignoreWarnings) return { action: "allow" };
  return { action: "block-immediate", conflictKeys: [...conflictKeys].sort() };
}

// ── Service layer (I/O) ─────────────────────────────────────────────────────

// The live conflict set for publishing this config. Empty when the guard is off
// or no running experiment is currently served by an affected config key.
export async function evaluateConfigExperimentGuardConflicts(
  context: Context,
  config: ConfigInterface,
): Promise<Set<string>> {
  if (!config.experimentGuard) return new Set();
  // Scan usage with an org-wide (unfiltered) context: the guard must see a
  // running experiment served by a config-backed feature in ANY project — even
  // one the acting user can't read — or it silently finds no conflict and the
  // publish rewrites that experiment's live arm. (The UI usage table keeps the
  // request context; only this guard path needs global coverage.)
  const scanContext = getContextForAgendaJobByOrgObject(context.org);
  const impl = await getConfigKeyImplementations(scanContext, config.id);
  return computeExperimentGuardConflictKeys(impl?.implementations ?? []);
}

// The acknowledged fingerprint captured on this revision at arm time, if any.
export function getExperimentGuardAcknowledgedKeys(
  revision: Pick<Revision, "experimentGuardAcknowledgedKeys">,
): string[] | null {
  return revision.experimentGuardAcknowledgedKeys ?? null;
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
  revision: Pick<Revision, "experimentGuardAcknowledgedKeys">,
  { armed }: { armed: boolean },
): Promise<void> {
  if (!config.experimentGuard) return;

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
    acknowledgedKeys: getExperimentGuardAcknowledgedKeys(revision),
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

// Capture the arm-time acknowledgment fingerprint when scheduling / auto-arming a
// deferred publish on a guarded config. Returns the sorted conflict keys to store
// on the revision (compared at merge time), or undefined when there is nothing to
// acknowledge (guard off / no live conflict). Throws SoftWarningError when live
// conflicts exist and the armer did not acknowledge them (?ignoreWarnings=true or
// bypassApprovalChecks) — arming must be an explicit, recorded override.
export async function captureConfigExperimentGuardAcknowledgment(
  context: Context,
  config: ConfigInterface,
): Promise<string[] | undefined> {
  if (!config.experimentGuard) return undefined;

  const conflictKeys = await evaluateConfigExperimentGuardConflicts(
    context,
    config,
  );
  if (conflictKeys.size === 0) return undefined;

  const override =
    context.ignoreWarnings ||
    context.permissions.canBypassApprovalChecks({
      project: config.project || "",
    });
  if (!override) {
    throw new SoftWarningError(
      `Scheduling this publish will rewrite the live value served to a running experiment (config keys: ${[
        ...conflictKeys,
      ]
        .sort()
        .join(
          ", ",
        )}). Re-submit with ignoreWarnings to acknowledge and schedule.`,
      [...conflictKeys].sort(),
    );
  }
  return [...conflictKeys].sort();
}
