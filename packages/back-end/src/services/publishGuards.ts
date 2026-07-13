import { ConfigInterface } from "shared/types/config";
import { ConstantInterface } from "shared/types/constant";
import { Revision } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import {
  assertConfigExperimentGuard,
  assertConstantExperimentGuard,
} from "back-end/src/services/experimentGuard";
import { assertConfigLockGuard } from "back-end/src/services/configLockGuard";

// Every deferred-publish guard for a config/constant publish, orchestrated in one
// place so each choke point (REST publish/update/revert handlers, the internal
// controllers, and the revision adapters) stays in lockstep as guards are added.
// Callers gate on a value-affecting change before invoking — a metadata-only
// publish can't disrupt any guard. Guards run sequentially: a synchronous
// ignoreWarnings/bypass clears all of them at once, and any armed (deferred)
// fingerprint mismatch is terminal regardless of order.

export async function assertConfigPublishGuards(
  context: Context,
  config: ConfigInterface,
  revision: Pick<Revision, "armAcknowledgments">,
  opts: { armed: boolean },
): Promise<void> {
  await assertConfigExperimentGuard(context, config, revision, opts);
  await assertConfigLockGuard(
    context,
    { source: "config", key: config.key, project: config.project },
    revision,
    opts,
  );
}

export async function assertConstantPublishGuards(
  context: Context,
  constant: ConstantInterface,
  revision: Pick<Revision, "armAcknowledgments">,
  opts: { armed: boolean },
): Promise<void> {
  await assertConstantExperimentGuard(context, constant, revision, opts);
  await assertConfigLockGuard(
    context,
    { source: "constant", key: constant.key, project: constant.project },
    revision,
    opts,
  );
}
