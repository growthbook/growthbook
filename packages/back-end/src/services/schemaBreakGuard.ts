import { CONSTANT_EXTENDS_KEY } from "shared/constants";
import {
  collectResolvedConfigValueViolations,
  configIsExtensible,
  getConfigSpineRootKey,
} from "shared/util";
import {
  buildConstantValueMap,
  resolveConstantRefs,
  ConstantValueMap,
} from "shared/sdk-versioning";
import { ConstantInterface } from "shared/types/constant";
import type { Context } from "back-end/src/models/BaseModel";
import { getResolvableValues } from "back-end/src/services/resolvableValues";
import { resolvableDependencyClosure } from "back-end/src/services/constants";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { SoftWarningError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

const CONFIG_PREFIX = "config:";

// Resolve a config to its concrete, fully-substituted value under `map` by
// resolving a synthetic `$extends` reference to it — the same config-layer
// resolution the SDK payload build uses (lineage + `@const:`/`@config:`
// substitution). Env-agnostic (no scoped-override flavors) — a base-value sanity
// check, not a per-environment payload. Returns null for a non-object result
// (nothing to schema-check).
function resolveConfigConcreteValue(
  configKey: string,
  map: ConstantValueMap,
  project: string,
): Record<string, unknown> | null {
  const resolved = resolveConstantRefs(
    { [CONSTANT_EXTENDS_KEY]: [`@config:${configKey}`] },
    map,
    new Set(),
    undefined,
    project,
    undefined,
  );
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? (resolved as Record<string, unknown>)
    : null;
}

// The schema/invariant violations a proposed constant value would INTRODUCE into
// the configs that (transitively) reference it — diffed against the current
// value so a pre-existing break never blocks an unrelated publish. Each affected
// config's resolved value is recomputed with the proposed constant substituted,
// then validated against its effective schema + invariants. This is where a
// config field backed by `@const:` finally gets checked against a concrete
// value (the ordinary config collectors exempt reference-backed fields).
//
// Configs only, env-agnostic (base value). Config-backed FEATURE values and
// per-environment constant values are a documented follow-on.
export async function evaluateConstantSchemaBreakConflicts(
  context: Context,
  constant: Pick<ConstantInterface, "key" | "project">,
  proposedValue: string | undefined,
): Promise<string[]> {
  // Org-wide scan (mirrors the other constant guards): a dependent config in any
  // project must be seen, even one the acting user can't read.
  const scanContext = getContextForAgendaJobByOrgObject(context.org);
  const resolvables = await getResolvableValues(scanContext);

  const affectedConfigKeys = [
    ...resolvableDependencyClosure(resolvables, "constant", constant.key),
  ]
    .filter((t) => t.startsWith(CONFIG_PREFIX))
    .map((t) => t.slice(CONFIG_PREFIX.length));
  if (!affectedConfigKeys.length) return [];

  const allConfigs = await scanContext.models.configs.getAllForReconcile();
  const byKey = new Map(allConfigs.map((c) => [c.key, c]));
  const extensibleDefault = context.org.settings?.configsExtensibleByDefault;

  // Current vs proposed constant maps (env-agnostic). The proposed map swaps only
  // the changed constant's base value; everything else resolves identically, so
  // the diff isolates violations this change introduces.
  const mapCurrent = buildConstantValueMap(resolvables, "");
  const proposedResolvables = resolvables.map((r) =>
    r.source === "constant" && r.key === constant.key
      ? { ...r, value: proposedValue ?? "" }
      : r,
  );
  const mapProposed = buildConstantValueMap(proposedResolvables, "");

  const introduced: string[] = [];
  for (const key of affectedConfigKeys) {
    const cfg = byKey.get(key);
    if (!cfg) continue;
    const additionalProperties = configIsExtensible(
      byKey.get(getConfigSpineRootKey(key, byKey)),
      extensibleDefault,
    );
    const project = cfg.project || "";

    const current = resolveConfigConcreteValue(key, mapCurrent, project);
    const proposed = resolveConfigConcreteValue(key, mapProposed, project);
    if (!proposed) continue;

    const currentViolations = new Set(
      current
        ? collectResolvedConfigValueViolations({
            configKey: key,
            value: current,
            byKey,
            additionalProperties,
          })
        : [],
    );
    for (const v of collectResolvedConfigValueViolations({
      configKey: key,
      value: proposed,
      byKey,
      additionalProperties,
    })) {
      if (!currentViolations.has(v)) {
        introduced.push(`config "${key}": ${v}`);
      }
    }
  }
  return introduced;
}

// Warn (never hard-block) when publishing a constant would make a dependent
// config's resolved value violate its schema or invariants. Bypassable soft
// warning on a direct publish (?ignoreWarnings=true or bypassApprovalChecks).
//
// Deferred (armed) publishes are intentionally skipped in this first cut: a
// scheduled / auto-publish-on-approval fire has no request to acknowledge
// against, and blocking it terminally would strand schedules. Arm-time capture +
// deferred re-check (mirroring the experiment guard) is a documented follow-on.
export async function assertConstantSchemaBreakGuard(
  context: Context,
  constant: Pick<ConstantInterface, "key" | "project">,
  proposedValue: string | undefined,
  { armed }: { armed: boolean },
): Promise<void> {
  if (armed) return;
  // Without the proposed value there's nothing to resolve-and-check; fail open
  // (this is a soft advisory, not a correctness gate).
  if (proposedValue === undefined) return;

  const violations = await evaluateConstantSchemaBreakConflicts(
    context,
    constant,
    proposedValue,
  );
  if (!violations.length) return;

  const override =
    context.ignoreWarnings ||
    context.permissions.canBypassApprovalChecks({
      project: constant.project || "",
    });
  if (override) {
    logger.info(
      { constantKey: constant.key, userId: context.userId, violations },
      "Constant schema-break guard overridden on a direct publish",
    );
    return;
  }

  throw new SoftWarningError(
    "Publishing this constant would make dependent config value(s) violate their schema or validation rules:\n" +
      violations.join("\n"),
    violations,
  );
}
