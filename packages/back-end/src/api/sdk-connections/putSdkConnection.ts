import { isEqual, isUndefined, omitBy } from "lodash";
import { JsonPatchOperation, Revision } from "shared/enterprise";
import {
  SDKConnectionRevisionSnapshot,
  putSdkConnectionValidator,
} from "shared/validators";
import {
  findSDKConnectionById,
  toApiSDKConnectionInterface,
  editSDKConnection,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { canLandArchivedState } from "back-end/src/revisions/archiveTransition";
import { ensureLiveRevisionExists } from "back-end/src/revisions/util";
import { landDirectChange } from "back-end/src/revisions/revertActions";
import { runGuardedWrite } from "back-end/src/revisions/landingSequence";
import type { BypassedGate } from "back-end/src/revisions/publishGates";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { validatePutPayload } from "./validations";

export const putSdkConnection = createApiRequestHandler(
  putSdkConnectionValidator,
)(async (req) => {
  const sdkConnection = await findSDKConnectionById(req.context, req.params.id);
  if (!sdkConnection) {
    throw new Error("Could not find sdkConnection with that id");
  }

  const params = await validatePutPayload(req.context, req.body, sdkConnection);

  if (!req.context.permissions.canUpdateSDKConnection(sdkConnection, params))
    req.context.permissions.throwPermissionError();

  // Archiving is delete-class and restoring is publish-class, both scoped to
  // the one environment the connection serves — the same gate the UI lands on.
  if (
    params.archived !== undefined &&
    params.archived !== !!sdkConnection.archived &&
    !canLandArchivedState({
      permissions: req.context.permissions,
      model: "sdk-connection",
      entity: sdkConnection,
      archived: params.archived,
      environments: [sdkConnection.environment],
    })
  ) {
    req.context.permissions.throwPermissionError();
  }

  const liveWebhooks =
    await req.context.models.sdkWebhooks.findAllSdkWebhooksByConnectionIds([
      sdkConnection.id,
    ]);
  const liveEntity = {
    ...sdkConnection,
    _webhooks: liveWebhooks,
  } as unknown as Record<string, unknown> & {
    id: string;
    owner?: string;
    dateCreated?: Date;
  };

  // Fields the request left out come back as `undefined` and must not blank
  // the baseline.
  const changes = omitBy(params, isUndefined);

  const adapter = getAdapter("sdk-connection");
  const baseline = adapter.buildSnapshot(
    liveEntity,
  ) as SDKConnectionRevisionSnapshot;
  // The snapshot stores the connection flattened, so the proposed state is the
  // flattened baseline with the validated fields laid over it.
  const proposedSettings = (
    adapter.buildSnapshot({
      ...baseline.sdkConnection,
      ...changes,
    }) as SDKConnectionRevisionSnapshot
  ).sdkConnection;

  if (isEqual(proposedSettings, baseline.sdkConnection)) {
    return { sdkConnection: toApiSDKConnectionInterface(sdkConnection) };
  }

  const patchOps: JsonPatchOperation[] = [
    { op: "replace", path: "/sdkConnection", value: proposedSettings },
  ];

  // Per-scope, on both the baseline and the proposed state: an org-wide check
  // refused edits to connections no rule covers, which the UI lets through.
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(req.context, {
        target: { snapshot: baseline, proposedChanges: patchOps },
      } as unknown as Revision)
    : adapter.isApprovalRequired(req.context);

  const bypassedGates: BypassedGate[] = [];
  if (approvalRequired) {
    const canBypass =
      canUseRestApiBypassSetting(req) ||
      adapter.canBypassApproval(req.context, baseline);
    if (!canBypass) {
      throw new BadRequestError(
        "This organization requires approvals on SDK connections. " +
          "Open a draft from the SDK connection page, or use an API key whose " +
          "role holds the bypassApprovalSDKConnections permission.",
      );
    }
    bypassedGates.push({
      type: "approval-required",
      outcome: "bypassed",
      via: canUseRestApiBypassSetting(req)
        ? "restApiBypassesReviews"
        : "bypassApprovalPermission",
    });
  }

  await ensureLiveRevisionExists(req.context, "sdk-connection", liveEntity);

  // Recorded as a merged revision before the live write, like every other
  // direct REST landing, so the UI's history and baseline don't drift. The
  // entity mirrors what the adapter's `getById` returns: the composite plus the
  // root `id`, `projects` and `dateUpdated` the engine's fences and authority
  // checks read.
  const { result: updatedSdkConnection } = await landDirectChange({
    context: req.context,
    entityType: "sdk-connection",
    entity: {
      id: sdkConnection.id,
      projects: sdkConnection.projects,
      dateUpdated: sdkConnection.dateUpdated,
      ...baseline,
    },
    patchOps,
    bypass: approvalRequired,
    write: () =>
      runGuardedWrite("sdk-connection", sdkConnection.id, () =>
        editSDKConnection(req.context, sdkConnection, changes, {
          casOnDateUpdated: sdkConnection.dateUpdated ?? null,
        }),
      ),
    persistedFrom: (written) => written as unknown as Record<string, unknown>,
  });

  return {
    sdkConnection: toApiSDKConnectionInterface(updatedSdkConnection),
    ...(bypassedGates.length ? { bypassedGates } : {}),
  };
});
