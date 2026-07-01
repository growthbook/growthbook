import { lockConfigValidator } from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { resolveConfigLockTarget } from "back-end/src/services/configLock";

export const lockConfig = createApiRequestHandler(lockConfigValidator)(async (
  req,
) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError(`Unable to locate the config: ${req.params.key}`);
  }

  // Locking only needs normal publish/edit authority (the asymmetry: unlocking
  // is the gated action). Configs have no separate publish permission, so edit
  // authority is publish authority.
  if (!req.context.permissions.canUpdateConfig(config, config)) {
    req.context.permissions.throwPermissionError();
  }

  // Idempotent: keep the existing pin if already locked (re-locking must not
  // silently move the pin to a newer revision). The endpoint gates auth above,
  // so write the lock directly — it lives outside the revision merge allowlist.
  let result = config;
  if (!config.lock) {
    const { revisionId, version } = await resolveConfigLockTarget(
      req.context,
      config,
    );
    result = await req.context.models.configs.dangerousUpdateBypassPermission(
      config,
      {
        lock: {
          revisionId,
          version,
          lockedBy: req.context.userId,
          dateLocked: new Date(),
          ...(req.body.reason ? { reason: req.body.reason } : {}),
        },
      },
    );
  }

  return {
    config: await resolveOwnerEmail(
      req.context.models.configs.toApiInterface(result),
      req.context,
    ),
  };
});
