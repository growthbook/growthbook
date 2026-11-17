import { isUndefined, omitBy } from "lodash";
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
} from "shared/validators";
import { withLegacySavedGroupFlag } from "shared/sdk-versioning";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { pickSettingsSnapshot } from "back-end/src/revisions/adapters/sdk-connection.adapter";
import {
  assertCanChangeSdkWebhooks,
  assertSdkWebhookFields,
} from "back-end/src/services/sdkConnectionApprovals";
import {
  LoadedConnection,
  loadConnection,
  loadDraft,
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
  const settingsAfter = (row: Revision | null) =>
    pickSettingsSnapshot(
      sdkConnectionDraftSettingsAfterSave(
        row
          ? (row.target.snapshot as SDKConnectionRevisionSnapshot).sdkConnection
          : liveSettings,
        editedSnapshot(loaded, row).sdkConnection,
        changes,
        liveSettings,
      ),
    );
  if (!draft && sdkConnectionSettingsEqual(settingsAfter(null), liveSettings)) {
    throw new BadRequestError(
      "Nothing to stage: the live SDK Connection already has these settings.",
    );
  }
  return stageDraftChanges(context, loaded, draft, newDraft, (row) => [
    { op: "replace", path: "/sdkConnection", value: settingsAfter(row) },
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
  // Rows predating `httpMethod` lack it.
  const webhooksOf = (row: Revision | null) =>
    editedSnapshot(loaded, row).sdkWebhooks.map((wh) =>
      parseSdkWebhookSnapshot({ ...wh, httpMethod: wh.httpMethod ?? "POST" }),
    );
  const before = webhooksOf(draft);
  const { projects, environment } = loaded.connection;
  assertCanChangeSdkWebhooks(
    context,
    { projects, environment },
    before,
    edit(before),
  );
  return stageDraftChanges(context, loaded, draft, newDraft, (row) => [
    { op: "replace", path: "/sdkWebhooks", value: edit(webhooksOf(row)) },
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
    () => [],
  );
  return { revision: await toApiSdkConnectionRevision(context, revision) };
});

export const putSdkConnectionRevisionSettings = createApiRequestHandler(
  putSdkConnectionRevisionSettingsValidator,
)(async (req) => {
  const { context } = req;
  const { revisionTitle, revisionComment, ...body } = req.body;
  const loaded = await loadConnection(context, req.params.id);
  const { connection } = loaded;
  const draft = await loadDraft(context, connection.id, req.params.version);

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
  const params = await validatePutPayload(context, body, editedConnection);
  // The plan is judged against live: only a setting live has on is kept.
  validatePremiumFeatures(context, params, connection);
  if (!context.permissions.canUpdateSDKConnection(connection, params)) {
    context.permissions.throwPermissionError();
  }

  const revision = await stageSettings(
    context,
    loaded,
    draft,
    { revisionTitle, revisionComment },
    withLegacySavedGroupFlag(omitBy(params, isUndefined), editedConnection),
  );
  return { revision: await toApiSdkConnectionRevision(context, revision) };
});

export const putSdkConnectionRevisionArchive = createApiRequestHandler(
  putSdkConnectionRevisionArchiveValidator,
)(async (req) => {
  const { context } = req;
  const { archived, ...newDraft } = req.body;
  const loaded = await loadConnection(context, req.params.id);
  const draft = await loadDraft(
    context,
    loaded.connection.id,
    req.params.version,
  );
  const revision = await stageSettings(context, loaded, draft, newDraft, {
    archived,
  });
  return { revision: await toApiSdkConnectionRevision(context, revision) };
});

export const postSdkConnectionRevisionWebhook = createApiRequestHandler(
  postSdkConnectionRevisionWebhookValidator,
)(async (req) => {
  const { context } = req;
  const { revisionTitle, revisionComment, ...fields } = req.body;
  const loaded = await loadConnection(context, req.params.id);
  const draft = await loadDraft(
    context,
    loaded.connection.id,
    req.params.version,
  );
  assertSdkWebhookFields(fields);
  const webhook = parseSdkWebhookSnapshot({
    ...fields,
    id: uniqid("wh_"),
    httpMethod: fields.httpMethod ?? "POST",
    payloadFormat: fields.payloadFormat ?? "standard",
  });
  const revision = await stageWebhooks(
    context,
    loaded,
    draft,
    { revisionTitle, revisionComment },
    (webhooks) => [...webhooks, webhook],
  );
  return { revision: await toApiSdkConnectionRevision(context, revision) };
});

export const putSdkConnectionRevisionWebhook = createApiRequestHandler(
  putSdkConnectionRevisionWebhookValidator,
)(async (req) => {
  const { context } = req;
  const { revisionTitle, revisionComment, ...fields } = req.body;
  const { webhookId } = req.params;
  const loaded = await loadConnection(context, req.params.id);
  const draft = await loadDraft(
    context,
    loaded.connection.id,
    req.params.version,
  );
  const revision = await stageWebhooks(
    context,
    loaded,
    draft,
    { revisionTitle, revisionComment },
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
  const loaded = await loadConnection(context, req.params.id);
  const draft = await loadDraft(
    context,
    loaded.connection.id,
    req.params.version,
  );
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
