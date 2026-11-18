import { JsonPatchOperation, Revision } from "shared/enterprise";
import {
  SDKConnectionRevisionSnapshot,
  postSdkConnectionRevisionRevertValidator,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { publishRevision } from "back-end/src/revisions/revisionActions";
import { resolveRevertStrategy } from "back-end/src/revisions/revertActions";
import type { BypassedGate } from "back-end/src/revisions/publishGates";
import { sdkConnectionRevertChanges } from "back-end/src/revisions/adapters/sdk-connection.adapter";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import {
  assertCanChangeSdkWebhooks,
  assertNoLockingScheduledDraft,
  sdkConnectionReviewRules,
} from "back-end/src/services/sdkConnectionApprovals";
import {
  confirmationLink,
  landingActions,
  requireConfirmation,
} from "back-end/src/services/confirmations";
import {
  TYPE,
  loadConnection,
  loadRevision,
  proposedSnapshot,
  stageDraftChanges,
  toApiSdkConnectionRevision,
} from "./revisionShared";
import { validateSdkConnectionChanges } from "./validations";

export const postSdkConnectionRevisionRevert = createApiRequestHandler(
  postSdkConnectionRevisionRevertValidator,
)(async (req) => {
  const { context } = req;
  const { version } = req.params;
  const loaded = await loadConnection(context, req.params.id);
  const { connection, live } = loaded;
  const target = await loadRevision(context, live.id, version);
  if (target.status !== "merged") {
    throw new BadRequestError(
      `Can only revert to a published (merged) revision. Revision #${version} has status "${target.status}".`,
    );
  }

  const adapter = getAdapter(TYPE);
  const targetState = adapter.buildSnapshot(
    proposedSnapshot(target),
  ) as SDKConnectionRevisionSnapshot;

  const changes = sdkConnectionRevertChanges(live, targetState);
  const settings = changes.sdkConnection ?? live.sdkConnection;
  const patchOps: JsonPatchOperation[] = Object.entries(changes).map(
    ([field, value]) => ({ op: "replace", path: `/${field}`, value }),
  );
  if (!patchOps.length) {
    throw new BadRequestError(
      `Revision #${version} matches the live SDK Connection, so there is nothing to revert.`,
    );
  }

  // A revert can move the connection back to where it used to be.
  if (
    !context.permissions.canUpdateSDKConnection(connection, {
      projects: settings.projects,
      environment: settings.environment,
    })
  ) {
    context.permissions.throwPermissionError();
  }
  if (changes.sdkWebhooks) {
    assertCanChangeSdkWebhooks(
      context,
      connection,
      live.sdkWebhooks,
      changes.sdkWebhooks,
    );
  }
  // An environment or Project the target used may be gone.
  await validateSdkConnectionChanges(context, settings, live.sdkConnection);

  const { name, environment } = live.sdkConnection;
  const hold = {
    environments: [environment],
    links: [confirmationLink("sdkConnection", live.id, name)],
    pin: connection.dateUpdated,
  };
  const newDraft = {
    revisionTitle:
      req.body.title ??
      `Revert to "${target.title?.trim() || `Revision ${version}`}"`,
    revisionComment: req.body.comment,
    revertedFrom: target.id,
  };

  // A revert restores a state that was already reviewed, so the org can let
  // one land without approval.
  const revertsBypassApproval = !!context.org.settings?.revertsBypassApproval;
  if (
    resolveRevertStrategy(req.body.strategy, revertsBypassApproval) !==
    "publish"
  ) {
    await requireConfirmation(context, {
      ...hold,
      actions: ["sdkConnection.draft"],
      summary: `Draft a revert of ${name} to revision ${version}`,
    });
    return {
      revision: await toApiSdkConnectionRevision(
        context,
        await stageDraftChanges(context, loaded, null, newDraft, patchOps),
      ),
    };
  }

  // Everything that could refuse the landing runs before the draft exists, so
  // a refused revert leaves nothing behind.
  const underReview =
    sdkConnectionReviewRules(context, live, patchOps).length > 0;
  const approvalRequired = underReview && !revertsBypassApproval;
  const restBypass = canUseRestApiBypassSetting(req);
  const canBypass =
    restBypass || adapter.canBypassApproval(context, live, patchOps);
  if (approvalRequired && !canBypass) {
    throw new BadRequestError(
      'This revert requires approval before it can be published. Use `strategy: "draft"` to create a draft for review.',
    );
  }
  await adapter.assertPublishable?.(context, live, changes, {
    target: {
      type: TYPE,
      id: live.id,
      snapshot: live,
      proposedChanges: patchOps,
    },
    revertedFrom: target.id,
  } as unknown as Revision);
  if (!canBypass) await assertNoLockingScheduledDraft(context, live.id);

  const bypassedGates: BypassedGate[] = underReview
    ? [
        {
          type: "approval-required",
          outcome: "bypassed",
          via: !approvalRequired
            ? "revertsBypassApproval"
            : restBypass
              ? "restApiBypassesReviews"
              : "bypassApprovalPermission",
        },
      ]
    : [];
  await requireConfirmation(context, {
    ...hold,
    actions: landingActions("sdkConnection", false),
    bypassing: bypassedGates,
    summary: `Revert ${name} to revision ${version}`,
  });

  const draft = await stageDraftChanges(
    context,
    loaded,
    null,
    { ...newDraft, direct: true },
    patchOps,
  );
  const published = await publishRevision(context, draft, live, {
    bypass: underReview,
    // They ran in `assertPublishable` above.
    skipHooks: true,
  });
  const liveIds = new Set(live.sdkWebhooks.map((wh) => wh.id));
  const recreatedWebhookIds = (changes.sdkWebhooks ?? [])
    .filter((wh) => !liveIds.has(wh.id))
    .map((wh) => wh.id);
  return {
    revision: await toApiSdkConnectionRevision(context, published),
    ...(bypassedGates.length ? { bypassedGates } : {}),
    ...(recreatedWebhookIds.length ? { recreatedWebhookIds } : {}),
  };
});
