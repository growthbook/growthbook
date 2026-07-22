import { unlockConfigValidator } from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

export const unlockConfig = createApiRequestHandler(unlockConfigValidator)(
  async (req) => {
    const config = await req.context.models.configs.getByKey(req.params.key);
    if (!config) {
      throw new NotFoundError(`Unable to locate the config: ${req.params.key}`);
    }

    // Unlocking is the gated action: it requires the elevated bypassApprovalChecks
    // permission (the same trust that skips the review queue), not just edit access.
    if (
      !req.context.permissions.canBypassApprovalChecks({
        project: config.project || "",
      })
    ) {
      req.context.permissions.throwPermissionError();
    }

    // Idempotent. `null` clears the lock (a `$set`, since updates can't `$unset`).
    let result = config;
    if (config.lock) {
      result = await req.context.models.configs.dangerousUpdateBypassPermission(
        config,
        { lock: null },
      );
    }

    return {
      config: await resolveOwnerEmail(
        req.context.models.configs.toApiInterface(result),
        req.context,
      ),
    };
  },
);
