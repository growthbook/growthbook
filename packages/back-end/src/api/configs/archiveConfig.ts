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
  evaluatePublishGates,
  PublishBlockedError,
  PublishGate,
  BypassedGate,
} from "back-end/src/revisions/publishGates";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import {
  assertConfigNotLocked,
  collectConfigLockGate,
} from "back-end/src/services/configLock";
import { landDirectChange } from "back-end/src/revisions/revertActions";
import { runGuardedWrite } from "back-end/src/revisions/landingSequence";
import { collectArchiveApprovalGate } from "back-end/src/revisions/governanceGates";
import { canLandArchivedState } from "back-end/src/revisions/archiveTransition";
import { configPublishEnvironments } from "back-end/src/revisions/revisionPublishEnvironments";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";

async function buildResponse(
  context: ApiReqContext,
  config: ConfigInterface,
  bypassed: BypassedGate[],
) {
  return {
    config: await resolveOwnerEmail(
      context.models.configs.toApiInterface(config),
      context,
    ),
    ...(bypassed.length ? { bypassedGates: bypassed } : {}),
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
    throw new NotFoundError(`Unable to locate the Config: ${key}`);
  }

  // Archiving is delete-class; unarchiving returns the Config to service and is
  // an ordinary publish.
  if (
    !canLandArchivedState({
      permissions: context.permissions,
      model: "config",
      entity: config,
      archived,
      environments: configPublishEnvironments(context, config),
    })
  ) {
    context.permissions.throwPermissionError();
  }

  // Idempotent: skip the write if already in the desired state.
  if (!!config.archived === archived) {
    return buildResponse(context, config, []);
  }

  const adapter = getAdapter("config");
  const patchOps = buildPatchOps({ archived });
  const desiredState = { archived };
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(context, {
        target: { snapshot: config, proposedChanges: patchOps },
      } as unknown as Revision)
    : adapter.isApprovalRequired(context);
  const canBypass =
    canUseRestApiBypassSetting(req) ||
    adapter.canBypassApproval(
      context,
      config as unknown as Record<string, unknown>,
    );

  // Aggregate every publish gate into one structured 422 (same contract as the
  // revision-publish endpoints): each names the flag that clears it and, where
  // one exists, a callable resolution route. The lock/approval backstops below
  // stay as the enforcement net; the collected guard gates are enforced here.
  const gates: PublishGate[] = [
    // Hard revision pin — no inline bypass, only an explicit unlock.
    ...collectConfigLockGate(config),
    // Metadata-only, but still gated so it can't bypass a required metadata
    // review. There's no draft to approve here, so the resolution routes the
    // change through a draft revision.
    ...collectArchiveApprovalGate({
      approvalRequired,
      archived,
      noun: "Config",
      createDraftPath: `/configs-revisions/${config.key}`,
      model: "config",
    }),
  ];
  // Soft guards (experiment / locked-dependent / schema-break / archive-dependents)
  // for the archived flip. Resolution scrubs archived refs, so the transition
  // rewrites consumers' values even though the config's own value is unchanged.
  gates.push(
    ...((await adapter.collectPublishGates?.(
      context,
      config,
      {
        target: { snapshot: config, proposedChanges: patchOps },
      } as unknown as Revision,
      desiredState,
    )) ?? []),
  );

  const { blocking, bypassed } = evaluatePublishGates(gates, {
    ignoreWarnings: context.ignoreWarnings,
    skipSchemaValidation: context.canSkipSchemaValidationFor("config"),
    skipHooks: context.canSkipHooksFor("config"),
    bypassApprovalPermission: adapter.canBypassApproval(
      context,
      config as Record<string, unknown>,
    ),
    restApiBypassesReviews: canUseRestApiBypassSetting(req),
    canForceMergeStaleBase: canBypass,
  });
  if (blocking.length) {
    throw new PublishBlockedError(blocking);
  }

  // Backstops behind the gates above — still before any merge is claimed.
  assertConfigNotLocked(config);
  if (approvalRequired && !canBypass) {
    throw new BadRequestError(
      "This organization requires approvals for this Config. " +
        `Use \`POST /configs-revisions/${config.key}\` to ${
          archived ? "archive" : "unarchive"
        } it through a draft, or use a role/token with the bypass permission.`,
    );
  }

  // One recorded, guarded landing whether or not approval was bypassed.
  await ensureLiveRevisionExists(
    context,
    "config",
    config as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );
  const { merged, result: updated } = await landDirectChange({
    context,
    entityType: "config",
    entity: config as unknown as Record<string, unknown> & { id: string },
    patchOps,
    bypass: approvalRequired,
    changes: { archived },
    write: () =>
      runGuardedWrite("config", config.id, () =>
        context.models.configs.updateIfUnchanged(config, { archived }),
      ),
  });
  await dispatchConfigRevisionEvent(context, merged, { type: "published" });
  return buildResponse(context, { ...config, ...updated }, bypassed);
}

export const archiveConfig = createApiRequestHandler(archiveConfigValidator)(
  async (req) => setArchivedState(req, req.params.key, true),
);

export const unarchiveConfig = createApiRequestHandler(
  unarchiveConfigValidator,
)(async (req) => setArchivedState(req, req.params.key, false));
