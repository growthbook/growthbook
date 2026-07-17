import { deleteConfigValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { assertConfigNotLocked } from "back-end/src/services/configLock";
import {
  assertConfigDeletable,
  assertConstantArchivable,
} from "back-end/src/services/constants";

export const deleteConfig = createApiRequestHandler(deleteConfigValidator)(
  async (req) => {
    const config = await req.context.models.configs.getByKey(req.params.key);
    if (!config) {
      throw new NotFoundError(
        `Unable to delete - could not find config with key ${req.params.key}`,
      );
    }

    if (!req.context.permissions.canDeleteConfig(config)) {
      req.context.permissions.throwPermissionError();
    }

    assertConfigNotLocked(config);

    // Deleting a live config is production-affecting (dependents lose their
    // backing), so require archiving first unless the org opted into bypass.
    if (!config.archived && !canUseRestApiBypassSetting(req)) {
      throw new BadRequestError(
        "Cannot delete a live config via the REST API when 'REST API always bypasses approval requirements' is disabled. " +
          "Archive the config first (POST /configs/{key}/archive), or enable the bypass setting in organization settings.",
      );
    }

    // Deleting a config that others inherit from would dangle their parent
    // pointer; require those children be removed or re-parented first.
    await assertConfigDeletable(req.context, config);

    // Deleting a config still referenced by features/other values breaks their
    // resolution. The "archive first" gate normally enforces this (archive runs
    // the same check), but the REST bypass skips that gate — so check here too,
    // unconditionally, so a bypassed live delete can't orphan referencers.
    await assertConstantArchivable(req.context, config.id, "config");

    await req.context.models.configs.delete(config);

    return { deletedId: config.id };
  },
);
