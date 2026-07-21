import { deleteConstantValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { assertConstantArchivable } from "back-end/src/services/constants";

export const deleteConstant = createApiRequestHandler(deleteConstantValidator)(
  async (req) => {
    const constant = await req.context.models.constants.getByKey(
      req.params.key,
    );
    if (!constant) {
      throw new NotFoundError(
        `Unable to delete - could not find constant with key ${req.params.key}`,
      );
    }

    if (!req.context.permissions.canDeleteConstant(constant)) {
      req.context.permissions.throwPermissionError();
    }

    // Deleting a live (non-archived) constant is a production-affecting action
    // (its references would start resolving verbatim). Mirror features: allow it
    // only when the org has opted into unrestricted REST writes; otherwise
    // require archiving first.
    if (!constant.archived && !canUseRestApiBypassSetting(req)) {
      throw new BadRequestError(
        "Cannot delete a live constant via the REST API when 'REST API always bypasses approval requirements' is disabled. " +
          "Archive the constant first, or enable the bypass setting in organization settings.",
      );
    }

    // Deleting a still-referenced constant makes its `@const:` refs resolve
    // verbatim. The archive-first gate normally enforces this (archive runs the
    // same check), but the REST bypass skips that gate — so check unconditionally
    // (mirrors deleteConfig).
    await assertConstantArchivable(req.context, constant.id);

    await req.context.models.constants.delete(constant);

    return { deletedId: constant.id };
  },
);
