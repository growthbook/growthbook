import { Revision } from "shared/enterprise";
import {
  archiveConfigValidator,
  unarchiveConfigValidator,
} from "shared/validators";
import { ConfigInterface } from "shared/types/config";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { ApiReqContext, ApiRequestLocals } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { assertConfigArchivable } from "back-end/src/services/constants";
import { assertConfigNotLocked } from "back-end/src/services/configLock";
import { assertConfigPublishGuards } from "back-end/src/services/publishGuards";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";

async function buildResponse(context: ApiReqContext, config: ConfigInterface) {
  return {
    config: await resolveOwnerEmail(
      context.models.configs.toApiInterface(config),
      context,
    ),
  };
}

async function setArchivedState(
  req: Pick<ApiRequestLocals, "context" | "isJwtAuth">,
  key: string,
  archived: boolean,
) {
  const { context } = req;
  const config = await context.models.configs.getByKey(key);
  if (!config) {
    throw new NotFoundError(`Unable to locate the config: ${key}`);
  }

  if (!context.permissions.canUpdateConfig(config, config)) {
    context.permissions.throwPermissionError();
  }

  // Idempotent: skip the write if already in the desired state.
  if (!!config.archived === archived) {
    return buildResponse(context, config);
  }

  // Either transition advances live state (resolution scrubs archived refs, so
  // archiving blanks consumers' values and unarchiving re-activates them), so a
  // locked config is frozen in its current archived state too.
  assertConfigNotLocked(config);
  // Block archiving a still-referenced config or one with live children.
  if (archived) {
    await assertConfigArchivable(context, config);
  }
  // Deferred-publish guards (direct publish → armed:false): warn (bypassably)
  // when the transition rewrites a value served to a running experiment or
  // feeding a locked dependent. The config's own value/schema are unchanged,
  // so the proposed state is the config as-is.
  await assertConfigPublishGuards(
    context,
    config,
    { armAcknowledgments: undefined },
    { armed: false },
    config,
  );

  // Metadata-only, but still respect the approval gate so it can't bypass
  // required metadata reviews. No body, so bypass is only via the org's
  // `restApiBypassesReviews` setting or the caller's bypass permission.
  const adapter = getAdapter("config");
  const patchOps = buildPatchOps({ archived });
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(context, {
        target: { snapshot: config, proposedChanges: patchOps },
      } as unknown as Revision)
    : adapter.isApprovalRequired(context);

  if (approvalRequired) {
    const canBypass =
      canUseRestApiBypassSetting(req) ||
      adapter.canBypassApproval(
        context,
        config as unknown as Record<string, unknown>,
      );
    if (!canBypass) {
      throw new BadRequestError(
        "This organization requires approvals for this config. " +
          `Use \`POST /configs-revisions/${config.key}\` to ${
            archived ? "archive" : "unarchive"
          } it through a draft, or use a role/token with the bypass permission.`,
      );
    }
    // Record the merged revision FIRST, then apply to the live entity; roll the
    // revision back if the apply fails, so a merged record never lacks a live change.
    await ensureLiveRevisionExists(
      context,
      "config",
      config as unknown as Record<string, unknown> & {
        id: string;
        owner?: string;
        dateCreated?: Date;
      },
    );
    const merged = await context.models.revisions.createMerged({
      type: "config",
      id: config.id,
      snapshot: config as unknown as Record<string, unknown>,
      proposedChanges: patchOps,
      bypass: true,
    });
    let updated: Partial<ConfigInterface>;
    try {
      updated = await context.models.configs.update(config, { archived });
    } catch (e) {
      try {
        await context.models.revisions.deleteById(merged.id);
      } catch {
        // ignore — surface the original update error
      }
      throw e;
    }
    await dispatchConfigRevisionEvent(context, merged, { type: "published" });
    return buildResponse(context, { ...config, ...updated });
  }

  const updated = await context.models.configs.update(config, { archived });
  return buildResponse(context, { ...config, ...updated });
}

export const archiveConfig = createApiRequestHandler(archiveConfigValidator)(
  async (req) => setArchivedState(req, req.params.key, true),
);

export const unarchiveConfig = createApiRequestHandler(
  unarchiveConfigValidator,
)(async (req) => setArchivedState(req, req.params.key, false));
