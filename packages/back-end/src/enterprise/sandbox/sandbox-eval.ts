import { CustomHookInterface, CustomHookType } from "shared/validators";
import {
  getConfigAncestorKeys,
  getConfigBaseKeys,
  getConfigSubtree,
  withConfigExtends,
} from "shared/util";
import { CONSTANT_EXTENDS_KEY } from "shared/constants";
import {
  buildConstantValueMap,
  resolveConstantRefs,
} from "shared/sdk-versioning";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ConfigInterface } from "shared/types/config";
import { ExperimentInterface } from "shared/types/experiment";
import { SoftWarningError } from "back-end/src/util/errors";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { Context } from "back-end/src/models/BaseModel";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import {
  configToResolvable,
  ResolvableValue,
} from "back-end/src/services/resolvableValues";
import { runInSandbox } from "./sandbox-pool";

// Custom hook orchestration; sandboxed JS runs in the child-process pool (sandbox-pool.ts).

export function customHooksActive(context: Context): boolean {
  return !IS_CLOUD && context.hasPremiumFeature("custom-hooks");
}

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

// Non-throwing variants for the REST publish handler, which surfaces hook
// outcomes as publish gates instead of exceptions (mirrors
// collectValidateConfigRevisionHookResults). Same arg prep as the throwing
// runValidate* wrappers above, but returns the collected results.
export async function collectValidateFeatureHookResults({
  context,
  feature,
  original,
}: {
  context: Context;
  feature: FeatureInterface;
  original: FeatureInterface | null;
}): Promise<CustomHookResults> {
  return collectCustomHookResults(
    context,
    "validateFeature",
    { feature },
    feature.project,
    feature.id,
    original ? { feature: original } : undefined,
  );
}

export async function collectValidateFeatureRevisionHookResults({
  context,
  feature,
  revision,
  original,
}: {
  context: Context;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  original: FeatureRevisionInterface;
}): Promise<CustomHookResults> {
  return collectCustomHookResults(
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
  // Fully-resolved shipping shape (lineage + refs substituted): `resolved` is
  // the env-agnostic base value; `perEnvironment` has one entry per environment
  // the lineage overrides via a flavor. Set only on the config being validated.
  resolved?: unknown;
  perEnvironment?: { environment: string; value: unknown }[];
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

// Resolve the config's shipping shape for hooks. The staged value is
// substituted into the reference universe (like schemaBreakGuard's proposed
// map) so the result reflects the change under validation. Reads are
// unfiltered — lineage/refs can span projects the acting user can't read.
type ResolvedShapes = {
  resolved: unknown;
  perEnvironment: { environment: string; value: unknown }[];
};

async function computeConfigResolvedShapes(
  context: Context,
  all: ConfigInterface[],
  byKey: Map<string, ConfigInterface>,
  config: ConfigHookInput,
  withOriginal: boolean,
): Promise<{ staged: ResolvedShapes; original: ResolvedShapes | null }> {
  const project = config.project ?? byKey.get(config.key)?.project ?? "";
  const scanContext = getContextForAgendaJobByOrgObject(context.org);
  const constants = await scanContext.models.constants.getAll();
  const constantResolvables = constants.map(
    (c): ResolvableValue => ({ ...c, source: "constant" }),
  );

  const stored = byKey.get(config.key);
  const rawValue =
    typeof config.value === "string"
      ? config.value
      : JSON.stringify(config.value ?? {});
  const stagedResolvable = {
    ...(stored ?? {}),
    key: config.key,
    project,
    type: "json",
    source: "config",
    value: withConfigExtends(
      rawValue,
      getConfigBaseKeys({ parent: config.parent, extends: config.extends }),
    ),
    scopedOverrides: stored?.scopedOverrides,
  } as ResolvableValue;

  const stagedResolvables: ResolvableValue[] = [
    ...constantResolvables,
    ...all.map((c) =>
      c.key === config.key ? stagedResolvable : configToResolvable(c),
    ),
  ];
  if (!stored) stagedResolvables.push(stagedResolvable);

  // Only environments the lineage overrides via a flavor can differ from the
  // base value, so resolve just those (plus the env-agnostic base). A wildcard/
  // project-only entry (no `environments`) applies in every named environment.
  const lineageKeys = [config.key, ...getConfigAncestorKeys(config, byKey)];
  const environments = new Set<string>();
  for (const key of lineageKeys) {
    for (const o of byKey.get(key)?.scopedOverrides ?? []) {
      if (!o.environments?.length) {
        getEnvironmentIdsFromOrg(context.org).forEach((e) =>
          environments.add(e),
        );
      } else {
        o.environments.forEach((e) => environments.add(e));
      }
    }
  }

  const shapesFor = (resolvables: ResolvableValue[]): ResolvedShapes => {
    const resolveFor = (environment: string | undefined): unknown =>
      resolveConstantRefs(
        { [CONSTANT_EXTENDS_KEY]: [`@config:${config.key}`] },
        buildConstantValueMap(resolvables, environment ?? ""),
        new Set(),
        undefined,
        project,
        environment,
      );
    return {
      resolved: resolveFor(undefined),
      perEnvironment: [...environments].map((environment) => ({
        environment,
        value: resolveFor(environment),
      })),
    };
  };

  return {
    staged: shapesFor(stagedResolvables),
    // The original resolves against the STORED universe (no substitution) so
    // incrementalChangesOnly hooks can diff resolved shapes symmetrically.
    original:
      withOriginal && stored
        ? shapesFor([...constantResolvables, ...all.map(configToResolvable)])
        : null,
  };
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
  const shapes = await computeConfigResolvedShapes(
    context,
    all,
    byKey,
    config,
    !!original,
  );
  const attach = (c: ConfigHookInput, s: ResolvedShapes): ConfigHookInput => ({
    ...c,
    resolved: s.resolved,
    ...(s.perEnvironment.length ? { perEnvironment: s.perEnvironment } : {}),
  });
  return {
    config: attach(shape(config), shapes.staged),
    original:
      original && shapes.original
        ? attach(shape(original), shapes.original)
        : original
          ? shape(original)
          : original,
  };
}

// Whether any hook would run for this entity — probed BEFORE the arg
// enrichment so configless orgs don't pay the config/constant collection reads
// and reference resolution on every write.
async function anyHooksToRun(
  context: Context,
  hookType: CustomHookType,
  config: ConfigHookInput,
): Promise<boolean> {
  if (IS_CLOUD || !context.hasPremiumFeature("custom-hooks")) return false;
  const adminContext = getContextForAgendaJobByOrgObject(context.org);
  const hooks = await adminContext.models.customHooks.getByHook(
    hookType,
    config.project ?? "",
    config.key,
    { parent: config.parent, extends: config.extends },
  );
  return hooks.length > 0;
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
  if (!(await anyHooksToRun(context, "validateConfig", config))) return;
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

type ConfigRevisionHookArgs = {
  context: Context;
  config: ConfigHookInput;
  revision?: ConfigRevisionHookInput;
  original?: ConfigHookInput | null;
};

// Shared arg prep for the config-revision hook call; null when no hooks match.
async function prepareConfigRevisionHookCall({
  context,
  config,
  revision,
  original,
}: ConfigRevisionHookArgs): Promise<Parameters<
  typeof collectCustomHookResults
> | null> {
  if (!(await anyHooksToRun(context, "validateConfigRevision", config))) {
    return null;
  }
  const enriched = await prepareConfigHookArgs(context, config, original);
  // Args are injected by destructuring, so `revision` must always be bound —
  // an absent key makes `if (revision)` a ReferenceError inside the hook.
  // Direct publishes (REST value update, revert) have no revision → null.
  return [
    context,
    "validateConfigRevision",
    { config: enriched.config, revision: revision ?? null },
    config.project ?? "",
    config.key,
    enriched.original
      ? { config: enriched.original, revision: revision ?? null }
      : undefined,
    { parent: config.parent, extends: config.extends },
  ];
}

export async function runValidateConfigRevisionHooks(
  args: ConfigRevisionHookArgs,
): Promise<void> {
  const call = await prepareConfigRevisionHookCall(args);
  if (!call) return;
  return _runCustomHooks(...call);
}

// Non-throwing variant for the REST publish handlers, which surface hook
// outcomes as publish gates instead of exceptions.
export async function collectValidateConfigRevisionHookResults(
  args: ConfigRevisionHookArgs,
): Promise<CustomHookResults> {
  const call = await prepareConfigRevisionHookCall(args);
  if (!call) return { hardErrors: [], warnings: [] };
  return collectCustomHookResults(...call);
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

export async function runValidateExperimentHooks({
  context,
  experiment,
  original,
}: {
  context: Context;
  experiment: ExperimentInterface;
  original: ExperimentInterface | null;
}): Promise<void> {
  return _runCustomHooks(
    context,
    "validateExperiment",
    { experiment },
    experiment.project || "",
    experiment.id,
    original ? { experiment: original } : undefined,
  );
}

// The aggregated custom-hook outcome for one entity change: hard errors (a hook
// threw — validation-class) and soft warnings (a hook called addWarning —
// acknowledge-class). Non-throwing so the caller can either throw (the assert
// wrappers) or emit gates (the REST publish handlers).
export type CustomHookResults = {
  hardErrors: string[];
  warnings: string[];
};

// Run every matching hook and collect the results without throwing. All hard
// errors are collected (not short-circuited on the first), so a gate can list them.
export async function collectCustomHookResults(
  context: Context,
  hookType: CustomHookType,
  functionArgs: Record<string, unknown>,
  project: string = "",
  entityId: string = "",
  originalFunctionArgs?: Record<string, unknown>,
  configBases?: { parent?: string; extends?: string[] },
): Promise<CustomHookResults> {
  if (!customHooksActive(context)) return { hardErrors: [], warnings: [] };

  // Get an admin version of the context: the user's permissions must not affect
  // which hooks execute (admin context has no `req`, so the caller's disposition
  // — ignoreWarnings/skipSchemaValidation — is read from the original context).
  const adminContext = getContextForAgendaJobByOrgObject(context.org);

  const hooks = await adminContext.models.customHooks.getByHook(
    hookType,
    project,
    entityId,
    configBases,
  );

  const hardErrors: string[] = [];
  const warnings: string[] = [];
  for (const hook of hooks) {
    const { error, warnings: hookWarnings } = await _runCustomHook(
      adminContext,
      hook,
      withHookTarget(hook, functionArgs) ?? functionArgs,
      withHookTarget(hook, originalFunctionArgs),
    );
    if (error) hardErrors.push(error);
    warnings.push(...hookWarnings);
  }
  return { hardErrors, warnings };
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
  const { hardErrors, warnings } = await collectCustomHookResults(
    context,
    hookType,
    functionArgs,
    project,
    entityId,
    originalFunctionArgs,
    configBases,
  );

  // A hard hook error (a hook threw) blocks unless the caller passes the
  // privileged skipHooks (which already requires the bypassApprovalChecks
  // permission). Its own flag, not skipSchemaValidation — a hook failure isn't a
  // schema error. This is the assert-path equivalent of the custom-hook gate the
  // REST publish handlers emit.
  if (hardErrors.length && !context.skipHooks) {
    throw new Error(hardErrors.join("\n"));
  }

  // Hook warnings are acknowledge-class: bypassable by ignoreWarnings (anyone).
  if (warnings.length && !context.ignoreWarnings) {
    throw new SoftWarningError(warnings.join("\n"), warnings);
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
