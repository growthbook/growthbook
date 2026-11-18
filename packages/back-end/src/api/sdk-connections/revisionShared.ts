import { omit } from "lodash";
import {
  JsonPatchOperation,
  Revision,
  normalizeProposedChanges,
} from "shared/enterprise";
import {
  ApiSdkConnectionRevision,
  SDKConnectionRevisionSnapshot,
  parseSdkWebhookSnapshot,
} from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { findSDKConnectionById } from "back-end/src/models/SdkConnectionModel";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { revertTargetState } from "back-end/src/revisions/revertActions";
import { scrubRevisionForViewer } from "back-end/src/revisions/scrub";
import { canDoRevisionAction } from "back-end/src/revisions/revisionActions";
import { SDKConnectionLiveSnapshot } from "back-end/src/revisions/adapters/sdk-connection.adapter";
import { dispatchSdkConnectionRevisionEvent } from "back-end/src/services/sdkConnectionRevisionEvents";
import { revisionEnvelopeToApi } from "back-end/src/api/revisionApiEnvelope";
import { isDraftStatus } from "back-end/src/api/revisionValidations";

export const TYPE = "sdk-connection";

// The connection in each form the revision engine takes: `entity` to cut a
// draft from, `live` to judge and land one against.
export async function loadConnection(context: ApiReqContext, id: string) {
  const connection = await findSDKConnectionById(context, id);
  if (!connection) {
    throw new NotFoundError("Could not find sdkConnection with that id");
  }
  const webhooks =
    await context.models.sdkWebhooks.findLiveSdkWebhooksForRevision([id]);
  const entity = { ...connection, _webhooks: webhooks };
  const live: SDKConnectionLiveSnapshot = {
    id: connection.id,
    projects: connection.projects,
    dateUpdated: connection.dateUpdated,
    ...(getAdapter(TYPE).buildSnapshot(
      entity,
    ) as SDKConnectionRevisionSnapshot),
  };
  return { connection, entity, live };
}
export type LoadedConnection = Awaited<ReturnType<typeof loadConnection>>;

export async function loadRevision(
  context: ApiReqContext,
  connectionId: string,
  version: number,
): Promise<Revision> {
  const revision = await context.models.revisions.getByTargetAndVersion(
    TYPE,
    connectionId,
    version,
  );
  if (!revision) {
    throw new NotFoundError("Could not find SDK Connection revision");
  }
  return revision;
}

export async function loadConnectionAndRevision(
  context: ApiReqContext,
  params: { id: string; version: number },
) {
  const loaded = await loadConnection(context, params.id);
  const revision = await loadRevision(context, loaded.live.id, params.version);
  return { ...loaded, revision };
}

// What the connection looks like with a revision's changes applied.
export function proposedSnapshot(
  revision: Revision,
): SDKConnectionRevisionSnapshot {
  return revertTargetState(revision) as SDKConnectionRevisionSnapshot;
}

// The connection an edit endpoint writes to and its draft; null for "new".
export async function loadEdit(
  context: ApiReqContext,
  params: { id: string; version: number | "new" },
) {
  const loaded = await loadConnection(context, params.id);
  if (params.version === "new") return { loaded, draft: null };
  const draft = await loadRevision(context, loaded.live.id, params.version);
  if (!isDraftStatus(draft.status)) {
    throw new BadRequestError(
      `Cannot edit a revision with status "${draft.status}"`,
    );
  }
  return { loaded, draft };
}

// Stages changes into `draft`, or into a new one.
export async function stageDraftChanges(
  context: ApiReqContext,
  { entity, live }: LoadedConnection,
  draft: Revision | null,
  newDraft: {
    revisionTitle?: string;
    revisionComment?: string;
    revertedFrom?: string;
    direct?: boolean;
  },
  ops: JsonPatchOperation[],
): Promise<Revision> {
  if (!canDoRevisionAction(TYPE, "draft", context, live)) {
    context.permissions.throwPermissionError();
  }
  await ensureLiveRevisionExists(context, TYPE, entity);

  const revision = await createOrUpdateRevision(
    context,
    TYPE,
    entity,
    ops,
    draft
      ? { revisionId: draft.id }
      : {
          forceCreate: true,
          title: newDraft.revisionTitle,
          comment: newDraft.revisionComment,
          revertedFrom: newDraft.revertedFrom,
          direct: newDraft.direct,
        },
  );
  // A direct landing reports itself when it publishes.
  if (!newDraft.direct) {
    await dispatchSdkConnectionRevisionEvent(
      context,
      revision,
      draft ? { type: "updated" } : { type: "created" },
    );
  }
  return revision;
}

const toApiSnapshot = (snapshot: SDKConnectionRevisionSnapshot) => {
  const { sdkConnection, sdkWebhooks } = getAdapter(TYPE).buildSnapshot(
    snapshot,
  ) as SDKConnectionRevisionSnapshot;
  return {
    settings: omit(sdkConnection, "organization"),
    // Older rows may carry delivery state.
    webhooks: sdkWebhooks.map(parseSdkWebhookSnapshot),
  };
};

export async function toApiSdkConnectionRevision(
  context: ApiReqContext,
  raw: Revision,
  { withHeaders = false } = {},
): Promise<ApiSdkConnectionRevision> {
  // Webhook headers go only to callers who can edit the webhook, and only on
  // reads: a held write's response is shown on its confirmation.
  const revision = await scrubRevisionForViewer(context, raw, !withHeaders);
  const base = toApiSnapshot(
    revision.target.snapshot as SDKConnectionRevisionSnapshot,
  );
  const proposed = toApiSnapshot(proposedSnapshot(revision));
  return {
    ...revisionEnvelopeToApi(revision),
    baseSdkConnection: base.settings,
    proposedSdkConnection: proposed.settings,
    baseSdkWebhooks: base.webhooks,
    proposedSdkWebhooks: proposed.webhooks,
    proposedChanges: normalizeProposedChanges(revision.target.proposedChanges),
  };
}
