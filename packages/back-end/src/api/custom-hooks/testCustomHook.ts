import { testCustomHookValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import { getFeature } from "back-end/src/models/FeatureModel";
import { assertCustomHooksAvailable } from "./validations";

export const testCustomHook = createApiRequestHandler(testCustomHookValidator)(
  async (req) => {
    assertCustomHooksAvailable(req.context);

    const { functionBody, functionArgs, entityType, entityId } = req.body;

    // Feature-scoped tests are authorized against the target feature instead
    // of the org-level manageCustomHooks permission (mirrors the internal
    // controller). Config-scoped tests fall through to the org-level check.
    if (entityType === "feature" && entityId) {
      const feature = await getFeature(req.context, entityId);
      if (
        !feature ||
        !req.context.permissions.canManageFeatureCustomHooks(feature)
      ) {
        req.context.permissions.throwPermissionError();
      }
    } else if (!req.context.permissions.canCreateCustomHook({ projects: [] })) {
      req.context.permissions.throwPermissionError();
    }

    const result = await runInSandbox(functionBody, functionArgs ?? {});

    if (!result.ok) {
      return {
        success: false,
        error: result.error || "Unknown error",
        warnings: result.warnings,
        log: result.log,
      };
    }

    return {
      success: true,
      returnVal: result.returnVal
        ? JSON.stringify(result.returnVal, null, 2)
        : undefined,
      warnings: result.warnings,
      log: result.log,
    };
  },
);
