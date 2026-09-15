import { postCustomHookValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { assertCustomHooksAvailable } from "./validations";

export const postCustomHook = createApiRequestHandler(postCustomHookValidator)(
  async (req) => {
    assertCustomHooksAvailable(req.context);

    const {
      name,
      hook,
      code,
      enabled,
      projects,
      entityType,
      entityId,
      incrementalChangesOnly,
    } = req.body;

    // Spread optional fields only when provided — explicit `undefined` values
    // would be stored as nulls, unlike internally-created hooks which omit the
    // keys. One-sided entityType/entityId still reaches the model's validation.
    const customHook = await req.context.models.customHooks.create({
      name,
      hook,
      code,
      enabled: enabled ?? true,
      // Pass through as-is; the model rejects entity-scoped hooks with projects.
      projects: projects ?? [],
      ...(entityType !== undefined ? { entityType } : {}),
      ...(entityId !== undefined ? { entityId } : {}),
      ...(incrementalChangesOnly !== undefined
        ? { incrementalChangesOnly }
        : {}),
    });

    return {
      customHook: req.context.models.customHooks.toApiInterface(customHook),
    };
  },
);
