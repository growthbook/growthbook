import type { Response } from "express";
import { isEqual, pick } from "lodash";
import {
  SDKConnectionInterface,
  CreateSDKConnectionParams,
  EditSDKConnectionParams,
  ProxyTestResult,
} from "shared/types/sdk-connection";
import {
  CreateSdkWebhookProps,
  WebhookInterface,
  WebhookSummary,
} from "shared/types/webhook";
import {
  createSdkWebhookValidator,
  sdkConnectionSettingsSnapshotValidator,
  sdkConnectionUpdatableFieldsSchema,
  sdkWebhookSnapshotValidator,
  SDKConnectionRevisionSnapshot,
  SDKConnectionSettingsRevisionSnapshot,
  SDKWebhookRevisionSnapshot,
} from "shared/validators";
import {
  Revision,
  JsonPatchOperation,
  getSdkConnectionApprovalRule,
  isSdkConnectionRevisionMetadataOnly,
  isSdkConnectionRevisionReviewExempt,
  normalizeProposedChanges,
} from "shared/enterprise";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  createSDKConnection,
  deleteSDKConnectionModel,
  findSDKConnectionById,
  findSDKConnectionsByOrganization,
  testProxyConnection,
} from "back-end/src/models/SdkConnectionModel";
import { validateRequireProjectForSdkConnections } from "back-end/src/api/sdk-connections/validations";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  createOrUpdateRevision,
  applyPatchToSnapshot,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { getAdapter } from "back-end/src/revisions";
import type { ApplyChangesResult } from "back-end/src/revisions/EntityRevisionAdapter";
import {
  compensateFailedLanding,
  runGuardedWrite,
} from "back-end/src/revisions/landingSequence";
import type { SDKConnectionLiveSnapshot } from "back-end/src/revisions/adapters/sdk-connection.adapter";

const SETTINGS_SNAPSHOT_KEYS = Object.keys(
  sdkConnectionSettingsSnapshotValidator.shape,
);

// Build the sdkConnection settings snapshot value for a patch op from a
// flattened connection state (proxyEnabled/proxyHost already flat).
function buildSettingsSnapshotValue(
  flatState: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of SETTINGS_SNAPSHOT_KEYS) {
    const val = flatState[key];
    if (val !== null && val !== undefined) result[key] = val;
  }
  return result;
}

export const getSDKConnections = async (
  req: AuthRequest,
  res: Response<{
    status: 200;
    connections: SDKConnectionInterface[];
  }>,
) => {
  const context = getContextFromReq(req);
  const connections = await findSDKConnectionsByOrganization(context);
  res.status(200).json({
    status: 200,
    connections,
  });
};

export const postSDKConnection = async (
  req: AuthRequest<Omit<CreateSDKConnectionParams, "organization">>,
  res: Response<{
    status: 200;
    connection: SDKConnectionInterface;
  }>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const params = req.body;

  if (!context.permissions.canCreateSDKConnection(params)) {
    context.permissions.throwPermissionError();
  }

  validateRequireProjectForSdkConnections(org, params.projects);

  let encryptPayload = false;
  if (orgHasPremiumFeature(org, "encrypt-features-endpoint")) {
    encryptPayload = params.encryptPayload;
  }

  let hashSecureAttributes = false;
  if (orgHasPremiumFeature(org, "hash-secure-attributes")) {
    hashSecureAttributes = params.hashSecureAttributes;
  }

  let remoteEvalEnabled = false;
  if (orgHasPremiumFeature(org, "remote-evaluation")) {
    remoteEvalEnabled = params.remoteEvalEnabled || false;
  }

  const doc = await createSDKConnection(context, {
    ...params,
    encryptPayload,
    hashSecureAttributes,
    remoteEvalEnabled,
    organization: org.id,
  });

  queueSDKPayloadRefresh({
    context,
    payloadKeys: [],
    sdkConnections: [doc],
    auditContext: {
      event: "created",
      model: "sdkconnection",
      id: doc.id,
    },
  });

  // Backfill a "live" revision representing the created state so the history
  // view (and later edits) have a baseline to diff against. New connections
  // have no webhooks yet; attach an empty array so the adapter's buildSnapshot
  // produces a composite { sdkConnection, sdkWebhooks: [] } baseline.
  await ensureLiveRevisionExists(context, "sdk-connection", {
    ...(doc as unknown as Record<string, unknown>),
    _webhooks: [],
  } as unknown as Record<string, unknown> & {
    id: string;
    owner?: string;
    dateCreated?: Date;
  });

  res.status(200).json({
    status: 200,
    connection: doc,
  });
};

type PutSDKConnectionRequest = AuthRequest<
  EditSDKConnectionParams & { sdkWebhooks?: SDKWebhookRevisionSnapshot[] },
  { id: string },
  {
    bypassApproval?: string;
    autoPublish?: string;
    revisionId?: string;
    forceCreateRevision?: string;
    title?: string;
    revertedFrom?: string;
  }
>;

type PutSDKConnectionResponse =
  | {
      status: 200;
      requiresApproval?: false;
      revision?: Revision;
    }
  | {
      status: 202;
      requiresApproval: boolean;
      revision: Revision;
    };

// Same rule as the adapter's `isApprovalRequiredForRevision`, which needs a
// persisted revision; this answers before the draft is minted so a refused
// publish leaves nothing behind.
function isApprovalRequiredForChange(
  context: ReqContext,
  baseline: SDKConnectionRevisionSnapshot,
  proposedSettings: SDKConnectionSettingsRevisionSnapshot,
  patchOps: JsonPatchOperation[],
): boolean {
  if (!context.hasPremiumFeature("require-approvals")) return false;
  const approvalFlows = context.org.settings?.approvalFlows;
  const rule =
    getSdkConnectionApprovalRule(approvalFlows, baseline.sdkConnection) ??
    getSdkConnectionApprovalRule(approvalFlows, proposedSettings);
  if (!rule) return false;
  const snapshot = baseline as unknown as Record<string, unknown>;
  if (isSdkConnectionRevisionReviewExempt(patchOps, snapshot)) return false;
  if (rule.requireMetadataReview ?? true) return true;
  return !isSdkConnectionRevisionMetadataOnly(patchOps, snapshot);
}

export const putSDKConnection = async (
  req: PutSDKConnectionRequest,
  res: Response<PutSDKConnectionResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const connection = await findSDKConnectionById(context, id);

  if (!connection) {
    throw new Error("Could not find SDK Connection");
  }

  // Permission check always runs regardless of approval flow status.
  if (!context.permissions.canUpdateSDKConnection(connection, req.body)) {
    context.permissions.throwPermissionError();
  }

  validateRequireProjectForSdkConnections(
    org,
    req.body.projects,
    connection.projects,
  );

  // Apply premium-feature gating to the incoming values before diffing, so an
  // org without the entitlement can't enable a gated payload setting.
  const proposed: Record<string, unknown> = { ...req.body };

  if (req.body.encryptPayload !== undefined) {
    let encryptPayload = req.body.encryptPayload;
    const changingFromUnencryptedToEncrypted =
      !connection.encryptPayload && encryptPayload;
    if (
      changingFromUnencryptedToEncrypted &&
      !orgHasPremiumFeature(org, "encrypt-features-endpoint")
    ) {
      encryptPayload = false;
    }
    proposed.encryptPayload = encryptPayload;
  }
  if (
    req.body.hashSecureAttributes !== undefined &&
    !orgHasPremiumFeature(org, "hash-secure-attributes")
  ) {
    proposed.hashSecureAttributes = false;
  }
  if (
    req.body.remoteEvalEnabled !== undefined &&
    !orgHasPremiumFeature(org, "remote-evaluation")
  ) {
    proposed.remoteEvalEnabled = false;
  }

  // Flat connection-settings fields that are allowed in a revision.
  const connectionSettingsUpdatableFields = new Set(
    Object.keys(sdkConnectionUpdatableFieldsSchema.shape),
  );

  // Pre-fetch webhooks so ensureLiveRevisionExists / createOrUpdateRevision
  // can produce a composite snapshot { sdkConnection, sdkWebhooks }.
  const liveWebhooks =
    await context.models.sdkWebhooks.findAllSdkWebhooksByConnectionIds([id]);

  // The flattened, secret-free view of the live connection (proxy flattened).
  const currentState: Record<string, unknown> = {
    ...connection,
    proxyEnabled: connection.proxy?.enabled,
    proxyHost: connection.proxy?.host,
  };

  // If updating a specific revision, diff against that draft's current
  // settings (snapshot + its own proposed changes) instead of the live conn.
  const revisionId = req.query.revisionId;
  let settingsComparisonBase = { ...currentState };
  if (revisionId) {
    const targetRevision =
      await context.models.revisions.getByIdReadable(revisionId);
    if (!targetRevision) {
      throw new NotFoundError("Revision not found");
    }
    // Another entity's revision as the comparison base would write its
    // settings into this connection's draft or merged history.
    if (
      targetRevision.target.type !== "sdk-connection" ||
      targetRevision.target.id !== connection.id
    ) {
      throw new BadRequestError(
        "Revision does not belong to this SDK connection",
      );
    }
    const patchedSnapshot = applyPatchToSnapshot(
      targetRevision.target.snapshot,
      normalizeProposedChanges(targetRevision.target.proposedChanges),
    );
    settingsComparisonBase = {
      ...currentState,
      ...patchedSnapshot.sdkConnection,
    };
  }

  // Absent means false for every optional boolean (payload builders test
  // `=== true`) and the edit modals seed absent booleans as false, so an
  // incoming `false` against an absent stored value is not a change — nor is
  // "" or [] against an absent string/array. An absent incoming value is
  // "not sent" (the modals omit untouched sections).
  const isAbsent = (v: unknown) => v === undefined || v === null;
  const isEmptyValue = (v: unknown) =>
    v === false || v === "" || isEqual(v, []);
  const hasChanged = (newVal: unknown, oldVal: unknown): boolean => {
    if (isAbsent(newVal)) return false;
    if (isAbsent(oldVal)) return !isEmptyValue(newVal);
    return !isEqual(newVal, oldVal);
  };

  const fieldsToUpdate: Record<string, unknown> = {};
  for (const key of Object.keys(proposed)) {
    if (!connectionSettingsUpdatableFields.has(key)) continue;
    if (hasChanged(proposed[key], settingsComparisonBase[key])) {
      fieldsToUpdate[key] = proposed[key];
    }
  }

  const forceCreateRevision = req.query.forceCreateRevision === "1";
  const bypassApproval = req.query.bypassApproval === "1";
  const autoPublish = req.query.autoPublish === "1";
  const title = req.query.title;
  const revertedFrom = req.query.revertedFrom;

  const wantsDraft = !!revisionId || forceCreateRevision;
  const explicitPublish = bypassApproval || autoPublish;
  // No draft-intent flag is an implicit publish: the change lands now or the
  // request is refused. It never becomes a draft the caller didn't ask for.
  const wantsMerge = explicitPublish || !wantsDraft;

  // Convert live webhooks to snapshot shape for comparison. `httpMethod` is
  // optional on the webhook schema and absent on rows predating it, while the
  // snapshot schema requires it — so default before parsing rather than
  // throwing and leaving the connection uneditable.
  const liveWebhookSnapshots = liveWebhooks.map((wh) =>
    sdkWebhookSnapshotValidator.parse({
      ...wh,
      httpMethod: wh.httpMethod ?? "POST",
    }),
  );

  // The request body is untrusted: validate it against the same schema instead
  // of casting, so a malformed webhook can't be written straight to Mongo.
  const parseIncomingWebhooks = (
    value: unknown,
  ): SDKWebhookRevisionSnapshot[] | null => {
    if (!Array.isArray(value)) return null;
    return value.map((wh) => sdkWebhookSnapshotValidator.parse(wh));
  };

  const incomingWebhooks = parseIncomingWebhooks(req.body.sdkWebhooks);
  const hasWebhookChanges =
    incomingWebhooks !== null &&
    !isEqual(incomingWebhooks, liveWebhookSnapshots);

  // Nothing changed and no empty draft was asked for: an explicit publish flag
  // on an unchanged save (the edit modals always send one) is still a no-op.
  if (
    Object.keys(fieldsToUpdate).length === 0 &&
    !hasWebhookChanges &&
    !forceCreateRevision
  ) {
    return res.status(200).json({ status: 200 });
  }

  // The adapter's apply gates webhook writes on the env-scoped SDK-webhook
  // atoms. Asked here so a caller who holds the connection atom but not those
  // is refused before anything is minted or written.
  if (hasWebhookChanges) {
    const scope = {
      projects: connection.projects,
      environment: connection.environment,
    };
    if (
      !context.permissions.canCreateSDKWebhook(scope) ||
      !context.permissions.canUpdateSDKWebhook(scope) ||
      !context.permissions.canDeleteSDKWebhook(scope)
    ) {
      context.permissions.throwPermissionError();
    }
  }

  // Build a coarse-replacement patch op: replace the entire sdkConnection
  // settings object atomically. This keeps `checkMergeConflicts` working
  // correctly (it extracts top-level field names from paths).
  const currentSettingsSnapshot = buildSettingsSnapshotValue(
    currentState,
  ) as SDKConnectionSettingsRevisionSnapshot;
  // The op REPLACES the whole settings object, so it must be layered on the
  // state this request is editing — the draft's patched state when updating a
  // draft, not the live connection. Building it from `currentState` silently
  // reverted every field the draft had already changed and this request didn't
  // re-send, with no conflict and no diff entry.
  const proposedSettingsSnapshot = buildSettingsSnapshotValue({
    ...settingsComparisonBase,
    ...fieldsToUpdate,
  }) as SDKConnectionSettingsRevisionSnapshot;

  const patchOps: JsonPatchOperation[] = [];
  // What landing this request writes, keyed like the composite snapshot.
  const desiredChanges: Record<string, unknown> = {};
  if (!isEqual(proposedSettingsSnapshot, currentSettingsSnapshot)) {
    patchOps.push({
      op: "replace",
      path: "/sdkConnection",
      value: proposedSettingsSnapshot,
    });
    desiredChanges.sdkConnection = proposedSettingsSnapshot;
  }
  if (hasWebhookChanges && incomingWebhooks) {
    patchOps.push({
      op: "replace",
      path: "/sdkWebhooks",
      value: incomingWebhooks,
    });
    desiredChanges.sdkWebhooks = incomingWebhooks;
  }

  const baselineSnapshot: SDKConnectionRevisionSnapshot = {
    sdkConnection: currentSettingsSnapshot,
    sdkWebhooks: liveWebhookSnapshots,
  };
  const adapter = getAdapter("sdk-connection");
  const needsApproval = isApprovalRequiredForChange(
    context,
    baselineSnapshot,
    proposedSettingsSnapshot,
    patchOps,
  );
  // A move takes bypass authority in the destination scope too, so both the
  // live and the proposed scope are asked — as the approval rule is above.
  const canBypass =
    adapter.canBypassApproval(context, baselineSnapshot) &&
    adapter.canBypassApproval(context, {
      sdkConnection: proposedSettingsSnapshot,
      sdkWebhooks: [],
    });

  // Every publish gate runs before the draft is minted, so a refused publish
  // leaves nothing behind. Publish authority for a connection is the same atom
  // as edit authority (`manageSDKConnections`), already checked above.
  if (wantsMerge && needsApproval) {
    if (!explicitPublish) {
      throw new BadRequestError(
        "This change requires approval. Save it as a draft revision and submit it for review.",
      );
    }
    if (!canBypass) {
      context.permissions.throwPermissionError();
    }
  }
  const willPublish = wantsMerge;

  // Same rule as `publishRevision`: another draft's committed "lock other
  // drafts" schedule blocks this landing unless the caller can bypass.
  if (
    willPublish &&
    !canBypass &&
    (await context.models.revisions.hasPublishLockingScheduledSibling(
      {
        type: "sdk-connection",
        id: connection.id,
        snapshot: baselineSnapshot,
        proposedChanges: [],
      },
      "",
    ))
  ) {
    throw new BadRequestError(
      "Another draft of this SDK connection has a scheduled publish that locks other drafts. Cancel that schedule to publish this change.",
    );
  }

  // Entity with pre-attached webhooks for composite snapshot building.
  const entityWithWebhooks = {
    ...(connection as unknown as Record<string, unknown>),
    _webhooks: liveWebhooks,
  };

  await ensureLiveRevisionExists(
    context,
    "sdk-connection",
    entityWithWebhooks as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  let revision = await createOrUpdateRevision(
    context,
    "sdk-connection",
    entityWithWebhooks as unknown as Record<string, unknown> & { id: string },
    patchOps,
    {
      forceCreate: wantsMerge || forceCreateRevision,
      title,
      revertedFrom,
      revisionId: wantsDraft && !explicitPublish ? revisionId : undefined,
    },
  );

  if (!willPublish) {
    return res.status(202).json({
      status: 202,
      requiresApproval: needsApproval,
      revision,
    });
  }

  // Claim the (CAS-guarded) merge before the live write so a concurrent
  // discard can't orphan a half-applied change; reopen if the write fails.
  // Kept for compensation: the claim overwrites `revision` with the merged row.
  const priorRevision = revision;
  revision = await context.models.revisions.merge(revision.id, context.userId, {
    // Only record a bypass when the caller used the explicit admin override.
    bypass: needsApproval && bypassApproval,
  });

  // The guarded write is conditioned on the stamp the diff was computed
  // against, so the landing entity carries the live root fields.
  const landingEntity: SDKConnectionLiveSnapshot = {
    ...baselineSnapshot,
    id: connection.id,
    projects: connection.projects ?? [],
    dateUpdated: connection.dateUpdated,
  };
  let applied: ApplyChangesResult | undefined;
  try {
    await runGuardedWrite("sdk-connection", connection.id, () =>
      adapter.applyChanges(context, landingEntity, desiredChanges, {
        guarded: true,
        onPersisted: (result) => {
          applied = result;
        },
      }),
    );
  } catch (e) {
    try {
      // The adapter reports the flat connection it wrote; ownership is judged
      // per composite key, so hand compensation the landing's own shape. Live
      // back first, then un-merge — ordering and guards live in
      // `compensateFailedLanding`.
      const settingsWritten = applied !== undefined && applied.written !== null;
      await compensateFailedLanding({
        context,
        entityType: "sdk-connection",
        entity: { id: connection.id, ...baselineSnapshot },
        persisted: settingsWritten ? desiredChanges : null,
        changes: desiredChanges,
        unmerge: () =>
          context.models.revisions.reopenAfterFailedApply(
            revision.id,
            context.userId,
            priorRevision,
            revision.dateUpdated,
          ),
      });
    } catch {
      // ignore — surface the original apply error
    }
    throw e;
  }

  return res.status(200).json({ status: 200, revision });
};

export const deleteSDKConnection = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);

  const connection = await findSDKConnectionById(context, id);
  if (!connection) {
    throw new Error("Could not find SDK Connection");
  }

  if (!context.permissions.canDeleteSDKConnection(connection)) {
    context.permissions.throwPermissionError();
  }

  // Archive-then-delete: archiving is reversible and flows through the approval
  // system; the hard delete bypasses approval but is gated on the archive
  // having already been published. Mirrors the saved-group delete flow.
  if (!connection.archived) {
    throw new Error("SDK connection must be archived before it can be deleted");
  }

  await deleteSDKConnectionModel(context, connection);

  res.status(200).json({
    status: 200,
  });
};

export const checkSDKConnectionProxyStatus = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    result?: ProxyTestResult;
  }>,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);
  const connection = await findSDKConnectionById(context, id);

  if (!connection) {
    throw new Error("Could not find SDK Connection");
  }

  const result = await testProxyConnection(context, connection, true);

  res.status(200).json({
    status: 200,
    result,
  });
};

export const getSDKConnectionsWebhooks = async (
  req: AuthRequest,
  res: Response<{
    status: 200;
    connections: Record<string, WebhookSummary[]>;
  }>,
) => {
  const context = getContextFromReq(req);
  const connections = await findSDKConnectionsByOrganization(context);
  const connectionIds = connections.map((conn) => conn.id);
  const allWebhooks =
    await context.models.sdkWebhooks.findAllSdkWebhooksByConnectionIds(
      connectionIds,
    );

  const webhooksByConnection: Record<string, WebhookSummary[]> = {};

  allWebhooks.forEach((webhook) => {
    const webhookSummary = pick(webhook, [
      "id",
      "name",
      "endpoint",
      "lastSuccess",
      "error",
      "dateCreated",
      "disabled",
      "consecutiveFailures",
    ]);
    webhook.sdks.forEach((sdkId) => {
      if (!webhooksByConnection[sdkId]) {
        webhooksByConnection[sdkId] = [];
      }
      webhooksByConnection[sdkId].push(webhookSummary);
    });
  });

  res.status(200).json({
    status: 200,
    connections: webhooksByConnection,
  });
};

export const getSDKConnectionWebhooks = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    webhooks: WebhookInterface[];
  }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const conn = await findSDKConnectionById(context, id);
  if (!conn) {
    throw new Error("Could not find SDK connection");
  }

  const webhooks =
    await context.models.sdkWebhooks.findAllSdkWebhooksByConnection(id);

  // If user does not have write access, remove the shared secret
  if (!context.permissions.canUpdateSDKWebhook(conn)) {
    webhooks.forEach((w) => {
      w.signingKey = "";
    });
  }

  res.status(200).json({
    status: 200,
    webhooks,
  });
};

export async function postSDKConnectionWebhook(
  req: AuthRequest<CreateSdkWebhookProps, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const { id } = req.params;
  const connection = await findSDKConnectionById(context, id);
  if (!connection) {
    throw new Error("Could not find SDK Connection");
  }

  if (!context.permissions.canCreateSDKWebhook(connection)) {
    context.permissions.throwPermissionError();
  }

  const webhookcount = await context.models.sdkWebhooks.countSdkWebhooksByOrg();
  const canAddMultipleSdkWebhooks = orgHasPremiumFeature(
    org,
    "multiple-sdk-webhooks",
  );
  if (!canAddMultipleSdkWebhooks && webhookcount > 0) {
    throw new Error("your webhook limit has been reached");
  }

  const webhook = await context.models.sdkWebhooks.create({
    ...context.models.sdkWebhooks.getDefaultCreateProps(id),
    ...createSdkWebhookValidator.parse(req.body),
  });
  return res.status(200).json({
    status: 200,
    webhook,
  });
}
