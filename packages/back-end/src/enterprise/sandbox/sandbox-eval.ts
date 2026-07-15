import { CustomHookInterface, CustomHookType } from "shared/validators";
import { getConfigAncestorKeys, getConfigSubtree } from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { SoftWarningError } from "back-end/src/util/errors";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { Context } from "back-end/src/models/BaseModel";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { runInSandbox } from "./sandbox-pool";

// Custom hook orchestration; sandboxed JS runs in the child-process pool (sandbox-pool.ts).

export async function runValidateFeatureHooks({
  context,
  feature,
  original,
}: {
  context: Context;
  feature: FeatureInterface;
  original: FeatureInterface | null;
}): Promise<void> {
  return _runCustomHooks(
    context,
    "validateFeature",
    { feature },
    feature.project,
    feature.id,
    original ? { feature: original } : undefined,
  );
}

export async function runValidateFeatureRevisionHooks({
  context,
  feature,
  revision,
  original,
}: {
  context: Context;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  original: FeatureRevisionInterface;
}): Promise<void> {
  return _runCustomHooks(
    context,
    "validateFeatureRevision",
    { feature, revision },
    feature.project,
    feature.id,
    {
      feature,
      revision: original,
    },
  );
}

// The config being validated, positioned in its lineage — exposed to config
// hooks so they can reason about where "self" sits (root vs leaf, whether it has
// a parent or children, and the full ancestor/descendant key lists).
type ConfigLineage = {
  ancestors: string[];
  descendants: string[];
  hasParent: boolean;
  hasChildren: boolean;
  isRoot: boolean;
  isLeaf: boolean;
};

// Present ONLY when the config being validated is an environment/project-scoped
// override (a "flavor") of another config — so a hook can apply env-specific
// rules (e.g. "the production override must set timeout"). Derived from the base
// config's scopedOverrides (the source of truth); absent for a plain config.
type ScopedConfigHookInfo = {
  parent: string;
  environments?: string[];
  projects?: string[];
};

// A config's publish-time content passed to config hooks. `key`/`project`/
// `parent`/`extends` drive hook scoping (entity-scoped by key, descendant-scoped
// by the staged lineage, project-scoped by project); the rest is the config's
// own fields. `value` is handed to hooks as a parsed JSON object (not the stored
// string) so hook code can read it directly.
type ConfigHookInput = {
  key: string;
  project?: string;
  parent?: string;
  extends?: string[];
  lineage?: ConfigLineage;
  scopedConfig?: ScopedConfigHookInfo;
} & Record<string, unknown>;

// Configs store `value` as a JSON string; hooks get it parsed. A non-JSON /
// unparseable value is passed through unchanged so the hook still sees it.
function parseConfigValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Shape the config args for hooks: parse `value` and attach lineage facts.
// Skipped when hooks won't run anyway (cloud / no premium feature) so we don't
// pay for the config-collection read.
async function prepareConfigHookArgs(
  context: Context,
  config: ConfigHookInput,
  original: ConfigHookInput | null | undefined,
): Promise<{
  config: ConfigHookInput;
  original: ConfigHookInput | null | undefined;
}> {
  if (IS_CLOUD || !context.hasPremiumFeature("custom-hooks")) {
    return { config, original };
  }
  const all = await context.models.configs.getAllForReconcile();
  const byKey = new Map(all.map((c) => [c.key, c]));
  const shape = (c: ConfigHookInput): ConfigHookInput => {
    const ancestors = [...getConfigAncestorKeys(c, byKey)];
    const descendants = getConfigSubtree(c.key, all).filter((k) => k !== c.key);
    // If some other config selects this one via scopedOverrides, it's an
    // environment/project override — surface its scope so hooks can validate
    // per-environment. Source of truth is the base's scopedOverrides.
    let scopedConfig: ScopedConfigHookInfo | undefined;
    for (const base of all) {
      const entry = (base.scopedOverrides ?? []).find(
        (o) => o.config === c.key,
      );
      if (entry) {
        scopedConfig = {
          parent: base.key,
          environments: entry.environments,
          projects: entry.projects,
        };
        break;
      }
    }
    return {
      ...c,
      value: parseConfigValue(c.value),
      lineage: {
        ancestors,
        descendants,
        hasParent: ancestors.length > 0,
        hasChildren: descendants.length > 0,
        isRoot: ancestors.length === 0,
        isLeaf: descendants.length === 0,
      },
      ...(scopedConfig ? { scopedConfig } : {}),
    };
  };
  return {
    config: shape(config),
    original: original ? shape(original) : original,
  };
}

export async function runValidateConfigHooks({
  context,
  config,
  original,
}: {
  context: Context;
  config: ConfigHookInput;
  original: ConfigHookInput | null;
}): Promise<void> {
  const enriched = await prepareConfigHookArgs(context, config, original);
  return _runCustomHooks(
    context,
    "validateConfig",
    { config: enriched.config },
    config.project ?? "",
    config.key,
    enriched.original ? { config: enriched.original } : undefined,
    { parent: config.parent, extends: config.extends },
  );
}

// The publish-time revision metadata passed to validateConfigRevision hooks:
// review verdicts, status, author, and the change comment — enough to gate a
// publish on approval policy (mirrors the feature revision hook's `revision`).
export type ConfigRevisionHookInput = {
  version?: number;
  status: string;
  title?: string;
  comment?: string;
  authorId: string;
  contributors?: string[];
  reviews: {
    userId: string;
    decision: string;
    comment?: string;
    stale?: boolean;
    dateCreated: Date;
  }[];
};

export async function runValidateConfigRevisionHooks({
  context,
  config,
  revision,
  original,
}: {
  context: Context;
  config: ConfigHookInput;
  revision?: ConfigRevisionHookInput;
  original?: ConfigHookInput | null;
}): Promise<void> {
  const enriched = await prepareConfigHookArgs(context, config, original);
  // Args are injected by destructuring, so `revision` must always be bound —
  // an absent key makes `if (revision)` a ReferenceError inside the hook.
  // Direct publishes (REST value update, revert) have no revision → null.
  return _runCustomHooks(
    context,
    "validateConfigRevision",
    { config: enriched.config, revision: revision ?? null },
    config.project ?? "",
    config.key,
    enriched.original
      ? { config: enriched.original, revision: revision ?? null }
      : undefined,
    { parent: config.parent, extends: config.extends },
  );
}

// Per-hook: tell a config hook whether the config being validated is the exact
// config it's pinned to (`isHookTarget`) versus a descendant it also runs on.
// `hookTargetKey` names the pinned config (null for project/global hooks, where
// every in-scope config is a direct target). No-op for non-config args.
function withHookTarget(
  hook: CustomHookInterface,
  args: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!args) return args;
  const config = args.config;
  if (!config || typeof config !== "object") return args;
  const cfg = config as Record<string, unknown>;
  const targetKey =
    hook.entityType === "config" ? (hook.entityId ?? null) : null;
  return {
    ...args,
    config: {
      ...cfg,
      hookTargetKey: targetKey,
      isHookTarget: targetKey === null || targetKey === cfg.key,
    },
  };
}

// Private methods
async function _runCustomHooks(
  context: Context,
  hookType: CustomHookType,
  functionArgs: Record<string, unknown>,
  project: string = "",
  entityId: string = "",
  originalFunctionArgs?: Record<string, unknown>,
  // Staged immediate bases of the target config (config hook types only) —
  // lets family-scoped hooks match descendants of their entityId.
  configBases?: { parent?: string; extends?: string[] },
) {
  // Skip on cloud
  // The V8 Isolates approach we are using is too big of a risk in a multi-tenant environment
  // Should be fine for self-hosting though
  if (IS_CLOUD) return;

  // Skip if org doesn't have the premium feature
  if (!context.hasPremiumFeature("custom-hooks")) {
    return;
  }

  // Admin context has no `req` so must read from original context instead
  const ignoreWarnings = context.ignoreWarnings;

  // Get an admin version of the context
  // We don't want the user's permissions to affect which hooks are executed
  const adminContext = getContextForAgendaJobByOrgObject(context.org);

  const hooks = await adminContext.models.customHooks.getByHook(
    hookType,
    project,
    entityId,
    configBases,
  );

  const allWarnings: string[] = [];
  for (const hook of hooks) {
    const { error, warnings } = await _runCustomHook(
      adminContext,
      hook,
      withHookTarget(hook, functionArgs) ?? functionArgs,
      withHookTarget(hook, originalFunctionArgs),
    );
    if (error) {
      throw new Error(error);
    }
    allWarnings.push(...warnings);
  }

  if (allWarnings.length && !ignoreWarnings) {
    throw new SoftWarningError(allWarnings.join("\n"), allWarnings);
  }
}

async function _runCustomHook(
  context: Context,
  hook: CustomHookInterface,
  functionArgs: Record<string, unknown>,
  originalFunctionArgs?: Record<string, unknown>,
): Promise<{ error?: string; warnings: string[] }> {
  const res = await runInSandbox(hook.code, functionArgs);

  if (res.ok) {
    context.models.customHooks.logSuccess(hook);
  } else {
    context.models.customHooks.logFailure(hook);
  }

  // A thrown error is a hard block and always wins over any warnings.
  if (!res.ok) {
    // Incremental: ignore the hook if this same error already existed before the change.
    if (originalFunctionArgs && hook.incrementalChangesOnly) {
      const originalRes = await runInSandbox(hook.code, originalFunctionArgs);
      if (!originalRes.ok && originalRes.error === res.error) {
        return { warnings: [] };
      }
    }

    const error =
      (res.error || "Custom hook error") + (res.log ? `\n${res.log}` : "");
    return { error, warnings: [] };
  }

  let warnings = res.warnings;

  // Incremental: drop warnings that were already present before this change.
  if (warnings.length && originalFunctionArgs && hook.incrementalChangesOnly) {
    const originalRes = await runInSandbox(hook.code, originalFunctionArgs);
    if (originalRes.ok) {
      warnings = warnings.filter((w) => !originalRes.warnings.includes(w));
    }
  }

  return { warnings };
}
