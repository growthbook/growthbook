import { CustomHookInterface, CustomHookType } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { SavedGroupInterface } from "shared/types/saved-group";
import { SoftWarningError } from "back-end/src/util/errors";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { ReqContextClass } from "back-end/src/services/context";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { runInSandbox } from "./sandbox-pool";

// Custom hook orchestration; sandboxed JS runs in the child-process pool (sandbox-pool.ts).

export async function runValidateFeatureHooks({
  context,
  feature,
  original,
}: {
  context: ReqContextClass;
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
  context: ReqContextClass;
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

export async function runValidateSavedGroupHooks({
  context,
  savedGroup,
  original,
}: {
  context: ReqContextClass;
  savedGroup: SavedGroupInterface;
  original: SavedGroupInterface | null;
}): Promise<void> {
  return _runCustomHooks(
    context,
    "validateSavedGroup",
    { savedGroup },
    // Saved groups belong to zero or more projects; a project-scoped hook
    // applies if it targets any of them (empty hook projects = global).
    savedGroup.projects || [],
    savedGroup.id,
    original ? { savedGroup: original } : undefined,
  );
}

// Private methods
async function _runCustomHooks(
  context: ReqContextClass,
  hookType: CustomHookType,
  functionArgs: Record<string, unknown>,
  // A single project (features) or a list of projects (saved groups) used to
  // resolve project-scoped hooks. Empty = global scope only.
  projects: string | string[] = "",
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
    projects,
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
  context: ReqContextClass,
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
