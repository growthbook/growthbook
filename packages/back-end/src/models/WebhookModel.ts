import { omit, uniq } from "lodash";
import { z } from "zod";
import { WEBHOOK_CONSECUTIVE_FAILURES_THRESHOLD } from "shared/constants";
import { WebhookInterface } from "shared/types/webhook";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { UpdateProps } from "shared/types/base-model";
import {
  apiSdkWebhookDeleteReturn,
  apiSdkWebhookListReturn,
  apiSdkWebhookReturn,
  CreateSdkWebhookProps,
  UpdateSdkWebhookProps,
  apiSdkWebhookValidator,
  postSdkConnectionWebhookValidator,
  putSdkWebhookValidator,
  webhookSchema,
} from "shared/validators";
import {
  getCollection,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";
import { generateSigningKey } from "back-end/src/util/api-key.util";
import { validateWebhookTimeoutSeconds } from "back-end/src/util/http.util";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  deleteSdkWebhookEndpoint,
  listSdkConnectionWebhooksEndpoint,
  postSdkConnectionWebhookEndpoint,
  postSdkWebhookTestEndpoint,
  putSdkWebhookEndpoint,
  sdkWebhookApiSpec,
} from "back-end/src/api/specs/sdk-webhook.spec";
import { fireSdkWebhook } from "back-end/src/jobs/sdkWebhooks";
import {
  assertDirectWriteAllowed,
  assertNoLockingScheduledDraft,
  assertSdkWebhookFields,
  assertSdkWebhookNotManaged,
  assertSdkWebhookPlanLimit,
  DirectWriteBypass,
  sdkWebhookEditUpdates,
} from "back-end/src/services/sdkConnectionApprovals";
import type { BypassedGate } from "back-end/src/revisions/publishGates";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import { MakeModelClass } from "./BaseModel";
import {
  assertCanUseSDKConnections,
  findSDKConnectionById,
  findSDKConnectionsByIds,
  touchSDKConnections,
} from "./SdkConnectionModel";

type ApiSdkWebhook = z.infer<typeof apiSdkWebhookValidator>;
type ApiSdkWebhookReturn = z.infer<typeof apiSdkWebhookReturn>;
type ApiSdkWebhookListReturn = z.infer<typeof apiSdkWebhookListReturn>;
type ApiSdkWebhookDeleteReturn = z.infer<typeof apiSdkWebhookDeleteReturn>;
type PostSdkWebhookBody = z.infer<
  typeof postSdkConnectionWebhookValidator.bodySchema
>;
type PutSdkWebhookBody = z.infer<typeof putSdkWebhookValidator.bodySchema>;

const COLLECTION_NAME = "webhooks";
const BaseClass = MakeModelClass({
  schema: webhookSchema,
  collectionName: COLLECTION_NAME,
  idPrefix: "wh_",
  globallyUniquePrimaryKeys: true,
  readonlyFields: [],
  additionalIndexes: [
    {
      unique: false,
      fields: {
        organization: 1,
        sdks: 1,
      },
    },
  ],
  baseQuery: {
    useSdkMode: true,
  },
  apiConfig: {
    modelKey: "sdkWebhooks",
    openApiSpec: sdkWebhookApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...listSdkConnectionWebhooksEndpoint,
        reqHandler: (req): Promise<ApiSdkWebhookListReturn> =>
          req.context.models.sdkWebhooks.apiListForConnection(req.params.id),
      }),
      defineCustomApiHandler({
        ...postSdkConnectionWebhookEndpoint,
        reqHandler: (req): Promise<ApiSdkWebhookReturn> =>
          req.context.models.sdkWebhooks.apiCreateForConnection(
            req.params.id,
            req.body,
            canUseRestApiBypassSetting(req),
          ),
      }),
      defineCustomApiHandler({
        ...putSdkWebhookEndpoint,
        reqHandler: (req): Promise<ApiSdkWebhookReturn> =>
          req.context.models.sdkWebhooks.apiUpdate(
            req.params.id,
            req.body,
            canUseRestApiBypassSetting(req),
          ),
      }),
      defineCustomApiHandler({
        ...deleteSdkWebhookEndpoint,
        reqHandler: (req): Promise<ApiSdkWebhookDeleteReturn> =>
          req.context.models.sdkWebhooks.apiDelete(
            req.params.id,
            req.body?.bypassApproval,
            canUseRestApiBypassSetting(req),
          ),
      }),
      defineCustomApiHandler({
        ...postSdkWebhookTestEndpoint,
        reqHandler: (req): Promise<ApiSdkWebhookReturn> =>
          req.context.models.sdkWebhooks.apiTest(req.params.id),
      }),
    ],
  },
});

export class SdkWebhookModel extends BaseClass {
  protected canCreate(): boolean {
    return this.context.permissions.canManageLegacySDKWebhooks();
  }
  protected canRead(): boolean {
    return this.context.permissions.canManageLegacySDKWebhooks();
  }
  protected canUpdate(): boolean {
    return this.context.permissions.canManageLegacySDKWebhooks();
  }

  protected canDelete(): boolean {
    return this.context.permissions.canManageLegacySDKWebhooks();
  }

  // Writes omit secrets: a held write's response is shown on its confirmation
  protected toApiInterface(
    w: WebhookInterface,
    canSeeSecrets = false,
  ): ApiSdkWebhook {
    return {
      id: w.id,
      name: w.name,
      endpoint: w.endpoint,
      sdkConnections: w.sdks,
      httpMethod: w.httpMethod ?? "POST",
      payloadFormat: w.payloadFormat ?? "standard",
      payloadKey: w.payloadKey,
      ...(canSeeSecrets
        ? { headers: w.headers ?? "", signingKey: w.signingKey }
        : {}),
      timeoutSeconds: w.timeoutSeconds ?? null,
      lastSuccess: w.lastSuccess?.toISOString() ?? null,
      error: w.error,
      consecutiveFailures: w.consecutiveFailures ?? 0,
      disabled: !!w.disabled,
      dateCreated: w.dateCreated.toISOString(),
      dateUpdated: w.dateUpdated.toISOString(),
    };
  }

  private async getConnectionForWrite(id: string) {
    const conn = await findSDKConnectionById(this.context, id);
    if (!conn)
      this.context.throwNotFoundError(`SDK Connection not found: ${id}`);
    return conn;
  }

  // Every connection must allow the action; only delete may act on an orphan
  private async getWebhookForWrite(
    id: string,
    can: (conn: SDKConnectionInterface) => boolean,
    { allowOrphan = false }: { allowOrphan?: boolean } = {},
  ) {
    const webhook = await this.getById(id);
    if (!webhook)
      this.context.throwNotFoundError(`SDK webhook not found: ${id}`);
    const conns = await findSDKConnectionsByIds(this.context, webhook.sdks);
    if (!conns.length && !allowOrphan) {
      this.context.throwBadRequestError(
        "Could not find any SDK Connection tied to this webhook",
      );
    }
    if (!conns.every(can)) this.context.permissions.throwPermissionError();
    return { webhook, conns };
  }

  // Secrets go to whoever could update the webhook: every live connection it covers must allow it
  public async getEditableWebhookIds(
    webhooks: WebhookInterface[],
  ): Promise<Set<string>> {
    const conns = await findSDKConnectionsByIds(this.context, [
      ...new Set(webhooks.flatMap((w) => w.sdks)),
    ]);
    const existing = new Set(conns.map((c) => c.id));
    const editable = new Set(
      conns
        .filter((c) => this.context.permissions.canUpdateSDKWebhook(c))
        .map((c) => c.id),
    );
    return new Set(
      webhooks
        .filter((w) => {
          const live = w.sdks.filter((id) => existing.has(id));
          return live.length > 0 && live.every((id) => editable.has(id));
        })
        .map((w) => w.id),
    );
  }

  // A draft scheduled to publish with other drafts locked holds direct writes
  // too, from anyone who couldn't bypass approval.
  private async assertNotScheduleLocked(
    conns: SDKConnectionInterface[],
    bypass?: DirectWriteBypass,
  ) {
    if (bypass?.restBypass) return;
    for (const conn of conns) {
      if (
        !this.context.permissions.canBypassSDKConnectionApprovalChecks({
          projects: conn.projects,
        })
      ) {
        await assertNoLockingScheduledDraft(this.context, conn.id);
      }
    }
  }

  // The direct writes a person or key makes, shared by the app and REST.
  // Status and integration writes use the base methods. `bypass` is REST's way
  // past an approval rule; the app changes a gated connection's webhooks in a
  // draft.
  public async createForConnection(
    connectionId: string,
    props: Omit<CreateSdkWebhookProps, "managedBy">,
    bypass?: DirectWriteBypass,
  ) {
    const { context } = this;
    const conn = await this.getConnectionForWrite(connectionId);
    if (!context.permissions.canCreateSDKWebhook(conn)) {
      context.permissions.throwPermissionError();
    }
    const bypassedGates = assertDirectWriteAllowed(context, [conn], bypass);
    await this.assertNotScheduleLocked([conn], bypass);
    assertSdkWebhookNotManaged(null, props.payloadFormat);
    await assertSdkWebhookPlanLimit(context, 1);

    const webhook = await this.create({
      ...this.getDefaultCreateProps(conn.id),
      ...props,
    });
    await touchSDKConnections(context, [conn.id]);
    return { webhook, bypassedGates };
  }

  public async updateDirect(
    id: string,
    { sdks: sent, ...updates }: UpdateSdkWebhookProps,
    bypass?: DirectWriteBypass,
  ) {
    const { context } = this;
    const can = (c: SDKConnectionInterface) =>
      context.permissions.canUpdateSDKWebhook(c);
    const { webhook, conns } = await this.getWebhookForWrite(id, can);
    assertSdkWebhookNotManaged(webhook, updates.payloadFormat);

    const sdks = sent && uniq(sent);
    const added = (sdks ?? []).filter((id) => !webhook.sdks.includes(id));
    // Attaching it to a connection is a change to that one too: its approval
    // rule and its scheduled-publish lock both apply.
    const affected = [
      ...conns,
      ...(await assertCanUseSDKConnections(context, added, can)),
    ];
    const bypassedGates = assertDirectWriteAllowed(context, affected, bypass);
    await this.assertNotScheduleLocked(affected, bypass);
    // Stale ids may round-trip, but a narrowed list must keep a live connection
    if (
      sdks &&
      !added.length &&
      webhook.sdks.some((id) => !sdks.includes(id)) &&
      !(await findSDKConnectionsByIds(context, sdks)).length
    ) {
      context.throwBadRequestError(
        "A webhook must keep at least one existing SDK Connection",
      );
    }

    const updated = await this.applyEdit(webhook, {
      ...updates,
      ...(sdks ? { sdks } : {}),
    });
    await touchSDKConnections(context, uniq([...webhook.sdks, ...added]));
    return { webhook: updated, bypassedGates };
  }

  public async deleteDirect(id: string, bypass?: DirectWriteBypass) {
    const { context } = this;
    const { webhook, conns } = await this.getWebhookForWrite(
      id,
      (c) => context.permissions.canDeleteSDKWebhook(c),
      { allowOrphan: true },
    );
    const bypassedGates = assertDirectWriteAllowed(context, conns, bypass);
    await this.assertNotScheduleLocked(conns, bypass);
    assertSdkWebhookNotManaged(webhook);
    await this.delete(webhook);
    await touchSDKConnections(context, webhook.sdks);
    return { bypassedGates };
  }

  // Fires it now; the outcome is recorded on the webhook.
  public async testDirect(id: string): Promise<WebhookInterface> {
    const { webhook } = await this.getWebhookForWrite(id, (c) =>
      this.context.permissions.canUpdateSDKWebhook(c),
    );
    await fireSdkWebhook(this.context, webhook).catch(() => undefined);
    return (await this.getById(webhook.id)) ?? webhook;
  }

  // A person's edit, direct or landed from a draft: sent once it's saved.
  public async applyEdit(
    webhook: WebhookInterface,
    updates: UpdateProps<WebhookInterface>,
  ): Promise<WebhookInterface> {
    const updated = await this.update(
      webhook,
      sdkWebhookEditUpdates(webhook, updates),
    );
    fireSdkWebhook(this.context, updated).catch(() => undefined);
    return updated;
  }

  // The Vercel integration recreates and rewrites its webhooks, so REST leaves them alone
  public async apiListForConnection(
    connectionId: string,
  ): Promise<ApiSdkWebhookListReturn> {
    const conn = await this.getConnectionForWrite(connectionId);
    const webhooks = await this.findAllSdkWebhooksByConnection(conn.id);
    const editable = await this.getEditableWebhookIds(webhooks);
    return {
      sdkWebhooks: webhooks.map((w) =>
        this.toApiInterface(w, editable.has(w.id)),
      ),
    };
  }

  public async apiCreateForConnection(
    connectionId: string,
    { bypassApproval, ...body }: PostSdkWebhookBody,
    restBypass: boolean,
  ): Promise<ApiSdkWebhookReturn> {
    const { webhook, bypassedGates } = await this.createForConnection(
      connectionId,
      {
        ...body,
        headers: body.headers ?? "",
        // Stored explicitly: a missing format reads back as legacy no-payload
        httpMethod: body.httpMethod ?? "POST",
        payloadFormat: body.payloadFormat ?? "standard",
      },
      { bypassApproval, restBypass },
    );
    return this.toApiReturn(webhook, bypassedGates);
  }

  public async apiUpdate(
    id: string,
    { bypassApproval, sdkConnections, ...updates }: PutSdkWebhookBody,
    restBypass: boolean,
  ): Promise<ApiSdkWebhookReturn> {
    const { webhook, bypassedGates } = await this.updateDirect(
      id,
      { ...updates, ...(sdkConnections ? { sdks: sdkConnections } : {}) },
      { bypassApproval, restBypass },
    );
    return this.toApiReturn(webhook, bypassedGates);
  }

  public async apiDelete(
    id: string,
    bypassApproval: boolean | undefined,
    restBypass: boolean,
  ): Promise<ApiSdkWebhookDeleteReturn> {
    const { bypassedGates } = await this.deleteDirect(id, {
      bypassApproval,
      restBypass,
    });
    return {
      deletedId: id,
      ...(bypassedGates.length ? { bypassedGates } : {}),
    };
  }

  public async apiTest(id: string): Promise<ApiSdkWebhookReturn> {
    return this.toApiReturn(await this.testDirect(id));
  }

  private toApiReturn(
    webhook: WebhookInterface,
    bypassedGates: BypassedGate[] = [],
  ): ApiSdkWebhookReturn {
    return {
      sdkWebhook: this.toApiInterface(webhook),
      ...(bypassedGates.length ? { bypassedGates } : {}),
    };
  }

  protected async customValidation(
    doc: WebhookInterface,
    previousDoc?: WebhookInterface,
  ) {
    // Only on change: status writes merge the stored value, which must keep
    // working if the cap is lowered later (the request-time clamp covers it)
    if (doc.timeoutSeconds !== previousDoc?.timeoutSeconds) {
      validateWebhookTimeoutSeconds(doc.timeoutSeconds);
    }
    // Legacy webhooks keep whatever they were saved with.
    if (!doc.useSdkMode) return;
    assertSdkWebhookFields({
      endpoint:
        doc.endpoint !== previousDoc?.endpoint ? doc.endpoint : undefined,
      headers: doc.headers !== previousDoc?.headers ? doc.headers : undefined,
    });
  }

  protected static migrate(doc: unknown): WebhookInterface {
    const castDoc = doc as WebhookInterface;
    const newDoc = omit(castDoc, ["sendPayload"]) as WebhookInterface;
    if (!castDoc.payloadFormat) {
      if (castDoc.httpMethod === "GET") {
        newDoc.payloadFormat = "none";
      } else if (castDoc.sendPayload) {
        newDoc.payloadFormat = "standard";
      } else {
        newDoc.payloadFormat = "standard-no-payload";
      }
    }
    if (!castDoc.dateCreated && castDoc.created)
      newDoc.dateCreated = castDoc.created;
    if (castDoc.consecutiveFailures === undefined)
      newDoc.consecutiveFailures = 0;
    if (castDoc.disabled === undefined) newDoc.disabled = false;
    return newDoc;
  }

  protected migrate(doc: unknown) {
    return SdkWebhookModel.migrate(doc);
  }

  public async findAllSdkWebhooksByConnectionIds(
    sdkConnectionIds: string[],
  ): Promise<WebhookInterface[]> {
    return await this._find({
      sdks: { $in: sdkConnectionIds },
    });
  }

  // What is live, whoever asks: a revision's snapshot, the comparison a publish
  // makes against it and the ownership of a webhook's headers all need the real
  // list. Read through `findAllSdkWebhooksByConnectionIds`, someone without the
  // webhook permission gets none, which records a connection as having no
  // webhooks and lands a webhook change as nothing. Never returned as is: what
  // a viewer may see is decided where it is sent.
  public async findLiveSdkWebhooksForRevision(
    sdkConnectionIds: string[],
  ): Promise<WebhookInterface[]> {
    return await this._find(
      { sdks: { $in: sdkConnectionIds } },
      { bypassReadPermissionChecks: true },
    );
  }

  public async findAllSdkWebhooksByPayloadFormat(
    payloadFormat: string,
  ): Promise<WebhookInterface[]> {
    return await this._find({
      payloadFormat,
    });
  }

  public async findAllSdkWebhooksByConnection(
    sdkConnectionId: string,
  ): Promise<WebhookInterface[]> {
    return await this._find({
      sdks: sdkConnectionId,
    });
  }

  public async findAllLegacySdkWebhooks(): Promise<WebhookInterface[]> {
    return await this._find({
      useSdkMode: { $ne: true },
    });
  }

  public async deleteLegacySdkWebhookById(id: string) {
    const webhook = await this._findOne({ id, useSdkMode: { $ne: true } });
    if (webhook) await this.delete(webhook);
  }

  public async setLastSdkWebhookError(
    webhook: WebhookInterface,
    error: string,
  ) {
    if (error) {
      const consecutiveFailures = (webhook.consecutiveFailures || 0) + 1;
      const updates: UpdateProps<WebhookInterface> = {
        error,
        consecutiveFailures,
      };
      if (consecutiveFailures >= WEBHOOK_CONSECUTIVE_FAILURES_THRESHOLD) {
        updates.disabled = true;
      }
      await this.update(webhook, updates);
    } else {
      await this.update(webhook, {
        error: "",
        lastSuccess: new Date(),
        consecutiveFailures: 0,
        disabled: false,
      });
    }
  }

  public static async dangerousFindSdkWebhookByIdAcrossOrgs(id: string) {
    const doc = await getCollection(COLLECTION_NAME).findOne({
      id,
    });
    return doc ? this.migrate(removeMongooseFields(doc)) : null;
  }

  public async countSdkWebhooksByOrg() {
    return await this._countDocuments({});
  }

  public getDefaultCreateProps(sdkConnectionId: string) {
    return {
      environment: "",
      project: "",
      error: "",
      lastSuccess: null,
      signingKey: generateSigningKey("wk_"),
      useSdkMode: true,
      featuresOnly: true,
      sdks: [sdkConnectionId],
      consecutiveFailures: 0,
      disabled: false,
    };
  }
}
