import { ConstantSource } from "shared/sdk-versioning";
import { Revision } from "shared/enterprise";
import { isConfigLocked } from "shared/util";
import type { Context } from "back-end/src/models/BaseModel";
import { resolvableDependencyClosure } from "back-end/src/services/constants";
import { getResolvableValues } from "back-end/src/services/resolvableValues";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { getArmAcknowledgment } from "back-end/src/services/armGuards";
import {
  decideExperimentGuard,
  guardWarningReader,
} from "back-end/src/services/experimentGuard";
import {
  SoftWarningError,
  TerminalPublishError,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

// The published resolvable whose value change could ripple into a locked config.
export type GuardedResolvable = {
  source: ConstantSource; // "constant" | "config"
  key: string;
  project?: string;
};

// User-facing noun per the copy glossary — both sources are named resources.
const displaySource = (source: ConstantSource): string =>
  source === "config" ? "Config" : "Constant";

// One line per locked Config for the "Save anyway" dialog, naming only those the publisher can read.
export async function describeLockedConfigs(
  context: Context,
  keys: string[],
): Promise<string[]> {
  const reader = guardWarningReader(context);
  const configs = await Promise.all(
    keys.map((k) => reader.models.configs.getByKey(k)),
  );
  const lines = keys.map((key, i) =>
    configs[i]
      ? `Config [${key}](/configs/${key}) is locked to a pinned revision, and publishing changes its resolved value.`
      : "A Config you can't access is locked to a pinned revision, and publishing changes its resolved value.",
  );
  return [...new Set(lines)];
}

// Config-lock guard: locking a config pins ITS OWN revision (assertConfigNotLocked
// hard-blocks re-publishing it), but a locked config that `@const:`/`@config:`-
// extends an external value is NOT frozen — changing that upstream constant/config
// still rewrites the locked config's resolved SDK value at the next payload build.
// This guard warns (bypassably) when publishing a constant/config that a LOCKED
// config transitively depends on, mirroring the experiment guard's soft-block +
// arm-time fingerprint so deferred publishes are covered too.

// Pure: from a dependency closure's tokens, the LOCKED config keys that depend on
// the published resolvable. Excludes the published config itself (its own lock is
// a separate hard block via assertConfigNotLocked). Exported for testing.
export function lockedDependentConfigKeys(
  affected: Set<string>,
  isLocked: (configKey: string) => boolean,
  self?: { source: ConstantSource; key: string },
): Set<string> {
  const out = new Set<string>();
  const CONFIG_PREFIX = "config:";
  for (const token of affected) {
    if (!token.startsWith(CONFIG_PREFIX)) continue;
    const key = token.slice(CONFIG_PREFIX.length);
    if (self?.source === "config" && key === self.key) continue;
    if (isLocked(key)) out.add(key);
  }
  return out;
}

// Locked configs whose resolved value would shift because publishing this
// constant/config changes what they resolve to. Org-wide scan (a locked config in
// any project must be seen).
export async function evaluateConfigLockConflicts(
  context: Context,
  resolvable: GuardedResolvable,
): Promise<Set<string>> {
  const scanContext =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  const [resolvables, allConfigs] = await Promise.all([
    getResolvableValues(scanContext),
    scanContext.models.configs.getAllForReconcile(),
  ]);
  const affected = resolvableDependencyClosure(
    resolvables,
    resolvable.source,
    resolvable.key,
  );
  const byKey = new Map(allConfigs.map((c) => [c.key, c]));
  return lockedDependentConfigKeys(
    affected,
    (k) => {
      const c = byKey.get(k);
      return !!c && isConfigLocked(c);
    },
    resolvable,
  );
}

// Enforce the config-lock guard. `armed` = deferred publish (arm-time fingerprint
// governs); unarmed = direct publish (synchronous ignoreWarnings/bypass governs).
export async function assertConfigLockGuard(
  context: Context,
  resolvable: GuardedResolvable,
  revision: Pick<Revision, "armAcknowledgments">,
  { armed }: { armed: boolean },
): Promise<void> {
  const conflictKeys = await evaluateConfigLockConflicts(context, resolvable);

  const synchronousOverride =
    context.ignoreWarnings ||
    context.permissions.canBypassFlagApprovalChecks(
      { project: resolvable.project || "" },
      resolvable.source,
    );

  const decision = decideExperimentGuard({
    guardEnabled: true,
    conflictKeys,
    armed,
    ignoreWarnings: synchronousOverride,
    acknowledgedKeys: getArmAcknowledgment(revision, "config-lock"),
  });

  if (decision.action === "allow") {
    if (!armed && conflictKeys.size > 0) {
      logger.info(
        {
          source: resolvable.source,
          key: resolvable.key,
          userId: context.userId,
          conflictKeys: [...conflictKeys].sort(),
        },
        "Config-lock guard overridden on a direct publish",
      );
    }
    return;
  }

  if (decision.action === "block-immediate") {
    const lines = await describeLockedConfigs(context, decision.conflictKeys);
    throw new SoftWarningError(
      `${lines.join(" ")} Unlock them, or re-submit with ignoreWarnings to proceed.`,
      lines,
    );
  }
  // Names nothing: stored on the draft and sent to webhooks, whose readers may differ.
  throw new TerminalPublishError(
    `Publish blocked by the config-lock guard: the locked Configs depending on this ${displaySource(
      resolvable.source,
    )} changed since this publish was scheduled. Re-open the draft and re-confirm to publish.`,
  );
}

// Snapshot the config-lock fingerprint when ARMING a deferred publish; throws
// (bypassably) on unacknowledged locked dependents. Returns the sorted keys.
// Caller (adapter) gates on a value-affecting change before invoking.
export async function captureConfigLockAcknowledgment(
  context: Context,
  resolvable: GuardedResolvable,
): Promise<string[] | undefined> {
  const conflictKeys = await evaluateConfigLockConflicts(context, resolvable);
  if (conflictKeys.size === 0) return undefined;

  const sortedKeys = [...conflictKeys].sort();
  const override =
    context.ignoreWarnings ||
    context.permissions.canBypassFlagApprovalChecks(
      { project: resolvable.project || "" },
      resolvable.source,
    );
  if (!override) {
    const lines = await describeLockedConfigs(context, sortedKeys);
    throw new SoftWarningError(
      `${lines.join(" ")} Re-submit with ignoreWarnings to acknowledge and schedule.`,
      lines,
    );
  }
  return sortedKeys;
}
