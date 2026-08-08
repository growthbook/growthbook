import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import { deleteConstantValidator } from "shared/validators";
import { archiveServeFootprint } from "back-end/src/revisions/revisionPublishEnvironments";
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
        `Unable to delete - could not find Constant with key ${req.params.key}`,
      );
    }

    // Deleting a LIVE Constant takes its value out of every environment it serves, so
    // the delete atom must hold in all of them — the same footprint archiving uses,
    // and deleting is strictly stronger than archiving. The unbound sentinel skipped
    // the environment check rather than narrowing it, so with the REST bypass enabled
    // a dev-limited deleter could delete a Constant serving production. An archived
    // Constant is already out of service, so there the atom alone covers it.
    if (
      !req.context.permissions.canDeleteConstant(
        constant,
        constant.archived
          ? NO_ENVIRONMENT_BINDING
          : archiveServeFootprint(req.context, constant),
      )
    ) {
      req.context.permissions.throwPermissionError();
    }

    // Deleting a live (non-archived) constant is a production-affecting action
    // (its references would start resolving verbatim). Mirror features: allow it
    // only when the org has opted into unrestricted REST writes; otherwise
    // require archiving first.
    if (!constant.archived && !canUseRestApiBypassSetting(req)) {
      throw new BadRequestError(
        "Cannot delete a live Constant via the REST API when 'REST API always bypasses approval requirements' is disabled. " +
          "Archive the Constant first, or enable the bypass setting in organization settings.",
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
