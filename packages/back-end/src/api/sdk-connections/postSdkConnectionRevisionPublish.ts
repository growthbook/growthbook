import { postSdkConnectionRevisionPublishValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  assertCanPublishRevision,
  publishRevision,
} from "back-end/src/revisions/revisionActions";
import {
  REVIEW_GATE_TYPES,
  resolveEntityPublishGates,
} from "back-end/src/revisions/publishGates";
import { collectRevisionGovernanceGates } from "back-end/src/revisions/governanceGates";
import { buildMergeDesiredState } from "back-end/src/revisions/util";
import { assertCanChangeSdkWebhooks } from "back-end/src/services/sdkConnectionApprovals";
import { collectSdkConnectionPublishHookGates } from "back-end/src/enterprise/sandbox/sandbox-eval";
import {
  confirmationLink,
  gateNotices,
  landingActions,
  requireConfirmation,
} from "back-end/src/services/confirmations";
import {
  TYPE,
  loadConnectionAndRevision,
  toApiSdkConnectionRevision,
} from "./revisionShared";

export const postSdkConnectionRevisionPublish = createApiRequestHandler(
  postSdkConnectionRevisionPublishValidator,
)(async (req) => {
  const { context } = req;
  const { live, revision } = await loadConnectionAndRevision(
    context,
    req.params,
  );
  if (revision.status === "merged" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot publish a revision with status "${revision.status}"`,
    );
  }

  const adapter = getAdapter(TYPE);
  await assertCanPublishRevision(context, revision, live);
  const { proposedChanges } = revision.target;
  // In the Projects a move leaves and the ones it enters.
  const canBypass = adapter.canBypassApproval(context, live, proposedChanges);

  const proposed = buildMergeDesiredState(
    live,
    revision.target.snapshot as Record<string, unknown>,
    proposedChanges,
    adapter.getUpdatableFields(),
  );
  // Before any hook runs, so a caller who may not change webhooks is refused
  // for that and shown no hook's message.
  assertCanChangeSdkWebhooks(
    context,
    live.sdkConnection,
    live.sdkWebhooks,
    proposed.sdkWebhooks,
  );
  // Every gate in one 422, each with the way past it. The publish below
  // enforces the same rules again.
  const gates = [
    ...(await collectRevisionGovernanceGates({
      context,
      adapter,
      targetType: TYPE,
      entity: live,
      revision,
    })),
    ...((await adapter.collectPublishGates?.(
      context,
      live,
      revision,
      proposed,
    )) ?? []),
    ...(await collectSdkConnectionPublishHookGates({
      context,
      live,
      revision,
      proposed,
    })),
  ];
  const { bypassed, skipped } = resolveEntityPublishGates({
    entityType: TYPE,
    req,
    gates,
    bypassApprovalPermission: canBypass,
    canForceMergeStaleBase: canBypass,
  });

  const { name, environment } = live.sdkConnection;
  await requireConfirmation(context, {
    actions: landingActions("sdkConnection", false),
    environments: [environment],
    bypassing: bypassed,
    notices: gateNotices(skipped),
    summary: `Publish revision ${revision.version} of ${name}`,
    links: [confirmationLink("sdkConnection", live.id, name)],
    pin: revision.dateUpdated,
  });

  const merged = await publishRevision(context, revision, live, {
    bypass: bypassed.some((gate) => REVIEW_GATE_TYPES.has(gate.type)),
    skipHooks: true,
  });
  return {
    revision: await toApiSdkConnectionRevision(context, merged),
    ...(bypassed.length ? { bypassedGates: bypassed } : {}),
  };
});
