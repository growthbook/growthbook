import { isEqual, isUndefined, omitBy } from "lodash";
import uniqid from "uniqid";
import {
  Revision,
  sdkConnectionDraftSettingsAfterSave,
  sdkConnectionSettingsEqual,
} from "shared/enterprise";
import {
  SDKConnectionRevisionSnapshot,
  SDKWebhookRevisionSnapshot,
  deleteSdkConnectionRevisionWebhookValidator,
  parseSdkWebhookSnapshot,
  postSdkConnectionRevisionValidator,
  postSdkConnectionRevisionWebhookValidator,
  putSdkConnectionRevisionArchiveValidator,
  putSdkConnectionRevisionSettingsValidator,
  putSdkConnectionRevisionWebhookValidator,
  pickSdkConnectionSettings,
} from "shared/validators";
import { withLegacySavedGroupFlag } from "shared/sdk-versioning";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  assertCanChangeSdkWebhooks,
  assertSdkWebhookFields,
  sdkWriteFields,
} from "back-end/src/services/sdkConnectionApprovals";
import {
  LoadedConnection,
  loadConnection,
  loadEdit,
  proposedSnapshot,
  stageDraftChanges,
  toApiSdkConnectionRevision,
} from "./revisionShared";
import { validatePremiumFeatures, validatePutPayload } from "./validations";

type NewDraft = { revisionTitle?: string; revisionComment?: string };

// The state an edit is made against: the draft's, else live's.
const editedSnapshot = (
  { live }: LoadedConnection,
  row: Revision | null,
): SDKConnectionRevisionSnapshot => (row ? proposedSnapshot(row) : live);

function stageSettings(
  context: ApiReqContext,
  loaded: LoadedConnection,
  draft: Revision | null,
  newDraft: NewDraft,
  changes: Record<string, unknown>,
) {
  const liveSettings = loaded.live.sdkConnection;
  const settings = pickSdkConnectionSettings(
    sdkConnectionDraftSettingsAfterSave(
      draft
        ? (draft.target.snapshot as SDKConnectionRevisionSnapshot).sdkConnection
        : liveSettings,
      editedSnapshot(loaded, draft).sdkConnection,
      changes,
      liveSettings,
    ),
  );
  if (!draft && sdkConnectionSettingsEqual(settings, liveSettings)) {
    throw new BadRequestError(
      "Nothing to stage: the live SDK Connection already has these settings.",
    );
  }
  return stageDraftChanges(context, loaded, draft, newDraft, [
    { op: "replace", path: "/sdkConnection", value: settings },
  ]);
}

function stageWebhooks(
  context: ApiReqContext,
  loaded: LoadedConnection,
  draft: Revision | null,
  newDraft: NewDraft,
  edit: (
    webhooks: SDKWebhookRevisionSnapshot[],
  ) => SDKWebhookRevisionSnapshot[],
) {
  const before = editedSnapshot(loaded, draft).sdkWebhooks.map(
    parseSdkWebhookSnapshot,
  );
  const after = edit(before);
  if (!draft && isEqual(after, before)) {
    throw new BadRequestError(
      "Nothing to stage: the live SDK Connection already has these webhooks.",
    );
  }
  const { projects, environment } = loaded.connection;
  assertCanChangeSdkWebhooks(context, { projects, environment }, before, after);
  return stageDraftChanges(context, loaded, draft, newDraft, [
    { op: "replace", path: "/sdkWebhooks", value: after },
  ]);
}

const draftWebhook = (
  webhooks: SDKWebhookRevisionSnapshot[],
  id: string,
): SDKWebhookRevisionSnapshot => {
  const webhook = webhooks.find((wh) => wh.id === id);
  if (!webhook) {
    throw new NotFoundError("Could not find that webhook in this revision");
  }
  return webhook;
};

export const postSdkConnectionRevision = createApiRequestHandler(
  postSdkConnectionRevisionValidator,
)(async (req) => {
  const { context } = req;
  const loaded = await loadConnection(context, req.params.id);
  const revision = await stageDraftChanges(
    context,
    loaded,
    null,
    { revisionTitle: req.body.title, revisionComment: req.body.comment },
    [],
  );
  return { revision: await toApiSdkConnectionRevision(context, revision) };
});

export const putSdkConnectionRevisionSettings = createApiRequestHandler(
  putSdkConnectionRevisionSettingsValidator,
)(async (req) => {
  const { context } = req;
  const { loaded, draft } = await loadEdit(context, req.params);
  const { connection } = loaded;

  // Validated as an edit to the settings the draft holds.
  const edited = editedSnapshot(loaded, draft).sdkConnection;
  const editedConnection = {
    ...connection,
    ...edited,
    proxy: {
      ...connection.proxy,
      enabled: !!edited.proxyEnabled,
      host: edited.proxyHost ?? "",
    },
  } as SDKConnectionInterface;
  const params = await validatePutPayload(
    context,
    sdkWriteFields(req.body),
    editedConnection,
  );
  // The plan is judged against live: only a setting live has on is kept.
  validatePremiumFeatures(context, params, connection);
  if (!context.permissions.canUpdateSDKConnection(connection, params)) {
    context.permissions.throwPermissionError();
  }

  const revision = await stageSettings(
    context,
    loaded,
    draft,
    req.body,
    withLegacySavedGroupFlag(omitBy(params, isUndefined), editedConnection),
  );
  return { revision: await toApiSdkConnectionRevision(context, revision) };
});

export const putSdkConnectionRevisionArchive = createApiRequestHandler(
  putSdkConnectionRevisionArchiveValidator,
)(async (req) => {
  const { context } = req;
  const { loaded, draft } = await loadEdit(context, req.params);
  const revision = await stageSettings(context, loaded, draft, req.body, {
    archived: req.body.archived,
  });
  return { revision: await toApiSdkConnectionRevision(context, revision) };
});

export const postSdkConnectionRevisionWebhook = createApiRequestHandler(
  postSdkConnectionRevisionWebhookValidator,
)(async (req) => {
  const { context } = req;
  const fields = sdkWriteFields(req.body);
  const { loaded, draft } = await loadEdit(context, req.params);
  assertSdkWebhookFields(fields);
  const webhook = parseSdkWebhookSnapshot({
    ...fields,
    id: uniqid("wh_"),
    payloadFormat: fields.payloadFormat ?? "standard",
  });
  const revision = await stageWebhooks(
    context,
    loaded,
    draft,
    req.body,
    (webhooks) => [...webhooks, webhook],
  );
  return { revision: await toApiSdkConnectionRevision(context, revision) };
});

export const putSdkConnectionRevisionWebhook = createApiRequestHandler(
  putSdkConnectionRevisionWebhookValidator,
)(async (req) => {
  const { context } = req;
  const fields = sdkWriteFields(req.body);
  const { webhookId } = req.params;
  const { loaded, draft } = await loadEdit(context, req.params);
  const revision = await stageWebhooks(
    context,
    loaded,
    draft,
    req.body,
    (webhooks) => {
      const old = draftWebhook(webhooks, webhookId);
      const next = parseSdkWebhookSnapshot({
        ...old,
        ...omitBy(fields, isUndefined),
      });
      assertSdkWebhookFields(next, old);
      return webhooks.map((wh) => (wh.id === webhookId ? next : wh));
    },
  );
  return { revision: await toApiSdkConnectionRevision(context, revision) };
});

export const deleteSdkConnectionRevisionWebhook = createApiRequestHandler(
  deleteSdkConnectionRevisionWebhookValidator,
)(async (req) => {
  const { context } = req;
  const { webhookId } = req.params;
  const { loaded, draft } = await loadEdit(context, req.params);
  const revision = await stageWebhooks(
    context,
    loaded,
    draft,
    req.body,
    (webhooks) => {
      draftWebhook(webhooks, webhookId);
      return webhooks.filter((wh) => wh.id !== webhookId);
    },
  );
  return { revision: await toApiSdkConnectionRevision(context, revision) };
});
