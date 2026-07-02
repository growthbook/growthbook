import {
  CustomHookInterface,
  updateCustomHookValidator,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { assertCustomHooksAvailable } from "./validations";

export const updateCustomHook = createApiRequestHandler(
  updateCustomHookValidator,
)(async (req) => {
  assertCustomHooksAvailable(req.context);

  const customHook = await req.context.models.customHooks.getById(
    req.params.id,
  );
  if (!customHook) {
    throw new NotFoundError(
      `Could not find custom hook with id ${req.params.id}`,
    );
  }

  // Scope is editable: entityType/entityId retarget the hook (null clears both,
  // making it global/project-scoped). Cross-field consistency (pairing, hook
  // type, target existence) is enforced by the model's validation.
  const updates: UpdateProps<CustomHookInterface> = { ...req.body };

  const nextEntityType =
    req.body.entityType === undefined
      ? (customHook.entityType ?? null)
      : req.body.entityType;

  if (nextEntityType !== null) {
    // Entity-scoped hooks derive their scope from the entity; projects stays empty.
    if (req.body.projects?.length) {
      throw new BadRequestError(
        "Cannot set projects on an entity-scoped custom hook",
      );
    }
    if (customHook.projects.length) updates.projects = [];
  }

  // Family matching is config-only; drop a stale flag when the scope moves away
  // from a config (unless the caller set it explicitly, which the model rejects).
  if (
    nextEntityType !== "config" &&
    req.body.includeDescendants === undefined &&
    customHook.includeDescendants
  ) {
    updates.includeDescendants = false;
  }

  const updated = await req.context.models.customHooks.update(
    customHook,
    updates,
  );

  return {
    customHook: req.context.models.customHooks.toApiInterface(updated),
  };
});
