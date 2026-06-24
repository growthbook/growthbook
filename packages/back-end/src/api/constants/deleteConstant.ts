import { deleteConstantValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";

export const deleteConstant = createApiRequestHandler(deleteConstantValidator)(
  async (req) => {
    const constant = await req.context.models.constants.getById(req.params.id);
    if (!constant) {
      throw new NotFoundError(
        `Unable to delete - could not find constant ID ${req.params.id}`,
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

    await req.context.models.constants.delete(constant);

    return { deletedId: req.params.id };
  },
);
