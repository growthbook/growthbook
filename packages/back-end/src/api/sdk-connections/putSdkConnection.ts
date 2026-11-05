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

  const { bypassApproval, ...body } = req.body;
  const params = await validatePutPayload(req.context, body, sdkConnection);

  if (!req.context.permissions.canUpdateSDKConnection(sdkConnection, params))
    req.context.permissions.throwPermissionError();

  // Archiving is delete-class and restoring is publish-class, in the
  // connection's environment.
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
  const liveEntity = { ...sdkConnection, _webhooks: liveWebhooks };

  // Omitted fields come back as `undefined` and must not blank the baseline.
  const changes = omitBy(params, isUndefined);

  const adapter = getAdapter("sdk-connection");
  const baseline = adapter.buildSnapshot(
    liveEntity,
  ) as SDKConnectionRevisionSnapshot;
  // The snapshot stores the connection flattened.
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

  // Judged per scope on baseline and proposed state, not org-wide.
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(req.context, {
        target: { snapshot: baseline, proposedChanges: patchOps },
      } as unknown as Revision)
    : adapter.isApprovalRequired(req.context);

  const bypassedGates: BypassedGate[] = [];
  if (approvalRequired) {
    if (!bypassApproval) {
      throw new BadRequestError(
        "This organization requires approvals on SDK connections. " +
          "Open a draft from the SDK connection page, " +
          'or pass `{ "bypassApproval": true }` if you have the `bypassApprovalSDKConnections` permission.',
      );
    }
    // A move needs bypass authority in the destination scope too.
    const canBypass =
      canUseRestApiBypassSetting(req) ||
      (adapter.canBypassApproval(req.context, baseline) &&
        adapter.canBypassApproval(req.context, {
          sdkConnection: proposedSettings,
          sdkWebhooks: [],
        }));
    if (!canBypass) {
      req.context.permissions.throwPermissionError();
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

  // The engine's fences and authority checks read the root `id`, `projects`
  // and `dateUpdated` alongside the composite.
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
