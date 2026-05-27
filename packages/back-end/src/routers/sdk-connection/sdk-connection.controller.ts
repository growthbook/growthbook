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
import { createSdkWebhookValidator } from "shared/validators";
import {
  Revision,
  SDK_CONNECTION_METADATA_FIELDS,
  getApprovalFlowSettings,
  normalizeProposedChanges,
} from "shared/enterprise";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  createSDKConnection,
  deleteSDKConnectionModel,
  editSDKConnection,
  findSDKConnectionById,
  findSDKConnectionsByOrganization,
  testProxyConnection,
} from "back-end/src/models/SdkConnectionModel";
import { validateRequireProjectForSdkConnections } from "back-end/src/api/sdk-connections/validations";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import {
  isRevisionRequired,
  createOrUpdateRevision,
  buildPatchOps,
  applyPatchToSnapshot,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { getAdapter } from "back-end/src/revisions";

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
  // view (and later edits) have a baseline to diff against.
  await ensureLiveRevisionExists(
    context,
    "sdk-connection",
    doc as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  res.status(200).json({
    status: 200,
    connection: doc,
  });
};

type PutSDKConnectionRequest = AuthRequest<
  EditSDKConnectionParams,
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

  const approvalRequired = isRevisionRequired(context, "sdk-connection", id);
  const updatableFields = getAdapter("sdk-connection").getUpdatableFields();

  // The flattened, secret-free view of the live connection used as the diff
  // baseline (mirrors the revision snapshot shape: proxy is flattened).
  const currentState: Record<string, unknown> = {
    ...connection,
    proxyEnabled: connection.proxy?.enabled,
    proxyHost: connection.proxy?.host,
  };

  // If updating a specific revision, diff against that draft's current state
  // (snapshot + its own proposed changes) instead of the live connection.
  const revisionId = req.query.revisionId;
  let comparisonBase = currentState;
  if (revisionId) {
    const targetRevision = await context.models.revisions.getById(revisionId);
    if (targetRevision && targetRevision.target.type === "sdk-connection") {
      const patchedSnapshot = applyPatchToSnapshot(
        targetRevision.target.snapshot as Record<string, unknown>,
        normalizeProposedChanges(targetRevision.target.proposedChanges),
      );
      comparisonBase = { ...currentState, ...patchedSnapshot };
    }
  }

  // Treat a null/undefined incoming value as "not changed" (the form omits
  // untouched fields), otherwise use deep equality.
  const hasChanged = (newVal: unknown, oldVal: unknown): boolean => {
    if (newVal == null) return false;
    if (oldVal == null) return true;
    return !isEqual(newVal, oldVal);
  };

  const fieldsToUpdate: Record<string, unknown> = {};
  for (const key of Object.keys(proposed)) {
    if (!updatableFields.has(key)) continue;
    if (hasChanged(proposed[key], comparisonBase[key])) {
      fieldsToUpdate[key] = proposed[key];
    }
  }

  const forceCreateRevision = req.query.forceCreateRevision === "1";
  const bypassApproval = req.query.bypassApproval === "1";
  const autoPublish = req.query.autoPublish === "1";
  const title = req.query.title;
  const revertedFrom = req.query.revertedFrom;

  // All edits flow through the revision system: with no draft-intent flag we
  // treat the request as an implicit auto-publish so the change is still
  // tracked as a revision and merged immediately when approval isn't required.
  const wantsDraft = !!revisionId || forceCreateRevision;
  const wantsMerge = bypassApproval || autoPublish || !wantsDraft;

  if (
    Object.keys(fieldsToUpdate).length === 0 &&
    !forceCreateRevision &&
    !bypassApproval &&
    !autoPublish
  ) {
    return res.status(200).json({ status: 200 });
  }

  await ensureLiveRevisionExists(
    context,
    "sdk-connection",
    connection as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  const patchOps = buildPatchOps(fieldsToUpdate);

  let revision = await createOrUpdateRevision(
    context,
    "sdk-connection",
    connection as unknown as Record<string, unknown> & { id: string },
    patchOps,
    {
      forceCreate: wantsMerge || forceCreateRevision,
      title,
      revertedFrom,
      revisionId:
        wantsDraft && !bypassApproval && !autoPublish ? revisionId : undefined,
    },
  );

  if (wantsMerge) {
    // Delegate to the adapter so the multi-project bypass rule has a single
    // source of truth (also used by the generic revision controller).
    const canBypass = getAdapter("sdk-connection").canBypassApproval(
      context,
      connection as unknown as Record<string, unknown>,
    );

    // bypassApproval is an explicit admin override — enforce server-side.
    if (bypassApproval && approvalRequired && !canBypass) {
      context.permissions.throwPermissionError();
    }

    // autoPublish is the "metadata-only shortcut": it lets non-admins publish
    // immediately when the org has disabled metadata review. It must NOT be
    // usable to bypass full review — enforce server-side that it's only
    // honoured when (a) the change is metadata-only AND metadata review is
    // disabled, or (b) the caller has the admin bypass permission.
    if (autoPublish && approvalRequired && !canBypass) {
      const isMetadataOnlyChange =
        Object.keys(fieldsToUpdate).length > 0 &&
        Object.keys(fieldsToUpdate).every((k) =>
          SDK_CONNECTION_METADATA_FIELDS.has(k),
        );
      const metadataReviewRequired =
        getApprovalFlowSettings(org.settings?.approvalFlows, "sdk-connection")
          ?.requireMetadataReview ?? true;
      if (!isMetadataOnlyChange || metadataReviewRequired) {
        context.permissions.throwPermissionError();
      }
    }

    const canImmediatelyMerge =
      !approvalRequired || bypassApproval || autoPublish;

    if (canImmediatelyMerge) {
      // Only record a bypass when the caller used the explicit admin override.
      const isBypass = approvalRequired && bypassApproval;

      await editSDKConnection(
        context,
        connection,
        fieldsToUpdate as EditSDKConnectionParams,
      );

      revision = await context.models.revisions.merge(
        revision.id,
        context.userId,
        { bypass: isBypass },
      );

      return res.status(200).json({ status: 200, revision });
    }
  }

  return res.status(202).json({
    status: 202,
    requiresApproval: approvalRequired,
    revision,
  });
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
