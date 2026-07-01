import { CustomHookInterface, CustomHookType } from "shared/validators";
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

// A config's publish-time content passed to config hooks. `key`/`project` drive
// hook scoping (entity-scoped by key, project-scoped by project); the rest is
// the config's own fields + staged value.
type ConfigHookInput = {
  key: string;
  project?: string;
} & Record<string, unknown>;

export async function runValidateConfigHooks({
  context,
  config,
  original,
}: {
  context: Context;
  config: ConfigHookInput;
  original: ConfigHookInput | null;
}): Promise<void> {
  return _runCustomHooks(
    context,
    "validateConfig",
    { config },
    config.project ?? "",
    config.key,
    original ? { config: original } : undefined,
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
  return _runCustomHooks(
    context,
    "validateConfigRevision",
    revision !== undefined ? { config, revision } : { config },
    config.project ?? "",
    config.key,
    original ? { config: original } : undefined,
  );
}

// Private methods
async function _runCustomHooks(
  context: Context,
  hookType: CustomHookType,
  functionArgs: Record<string, unknown>,
  project: string = "",
  entityId: string = "",
  originalFunctionArgs?: Record<string, unknown>,
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
  );

  const allWarnings: string[] = [];
  for (const hook of hooks) {
    const { error, warnings } = await _runCustomHook(
      adminContext,
      hook,
      functionArgs,
      originalFunctionArgs,
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
