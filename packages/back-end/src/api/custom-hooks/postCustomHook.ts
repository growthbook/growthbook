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
      includeDescendants,
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
      // Entity-scoped hooks derive their scope from the entity; keep projects empty.
      projects: entityType && entityId ? [] : (projects ?? []),
      ...(entityType !== undefined ? { entityType } : {}),
      ...(entityId !== undefined ? { entityId } : {}),
      ...(includeDescendants !== undefined ? { includeDescendants } : {}),
      ...(incrementalChangesOnly !== undefined
        ? { incrementalChangesOnly }
        : {}),
    });

    return {
      customHook: req.context.models.customHooks.toApiInterface(customHook),
    };
  },
);
