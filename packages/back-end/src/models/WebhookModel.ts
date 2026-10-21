import { omit } from "lodash";
import { z } from "zod";
import { WEBHOOK_CONSECUTIVE_FAILURES_THRESHOLD } from "shared/constants";
import { WebhookInterface } from "shared/types/webhook";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { UpdateProps } from "shared/types/base-model";
import {
  apiSdkWebhookListReturn,
  apiSdkWebhookReturn,
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
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { MakeModelClass } from "./BaseModel";
import {
  assertCanUseSDKConnections,
  findSDKConnectionById,
  findSDKConnectionsByIds,
} from "./SdkConnectionModel";

type ApiSdkWebhook = z.infer<typeof apiSdkWebhookValidator>;
type ApiSdkWebhookReturn = z.infer<typeof apiSdkWebhookReturn>;
type ApiSdkWebhookListReturn = z.infer<typeof apiSdkWebhookListReturn>;
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
          ),
      }),
      defineCustomApiHandler({
        ...putSdkWebhookEndpoint,
        reqHandler: (req): Promise<ApiSdkWebhookReturn> =>
          req.context.models.sdkWebhooks.apiUpdate(req.params.id, req.body),
      }),
      defineCustomApiHandler({
        ...deleteSdkWebhookEndpoint,
        reqHandler: (req): Promise<{ deletedId: string }> =>
          req.context.models.sdkWebhooks.apiDelete(req.params.id),
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
    return this.context.permissions.canCreateEventWebhook();
  }
  protected canRead(): boolean {
    return this.context.permissions.canViewEventWebhook();
  }
  protected canUpdate(): boolean {
    return this.context.permissions.canUpdateEventWebhook();
  }

  protected canDelete(): boolean {
    return this.context.permissions.canDeleteEventWebhook();
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

  private async getConnectionForApi(id: string) {
    const conn = await findSDKConnectionById(this.context, id);
    if (!conn)
      this.context.throwNotFoundError(`SDK Connection not found: ${id}`);
    return conn;
  }

  private assertHeadersJson(headers?: string) {
    if (!headers) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(headers);
    } catch (e) {
      parsed = null;
    }
    if (!z.record(z.string(), z.string()).safeParse(parsed).success) {
      this.context.throwBadRequestError(
        "headers must be a JSON-encoded object of strings",
      );
    }
  }

  // Every connection must allow the action; as in the app, only delete may act on an orphan
  private async getWebhookForApiUpdate(
    id: string,
    can: (conn: SDKConnectionInterface) => boolean,
    allowOrphan = false,
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
    return webhook;
  }

  public async apiListForConnection(
    connectionId: string,
  ): Promise<ApiSdkWebhookListReturn> {
    const conn = await this.getConnectionForApi(connectionId);
    const webhooks = await this.findAllSdkWebhooksByConnection(conn.id);
    // Secrets go to whoever could update the webhook, as getWebhookForApiUpdate requires
    const conns = await findSDKConnectionsByIds(this.context, [
      ...new Set(webhooks.flatMap((w) => w.sdks)),
    ]);
    const existing = new Set(conns.map((c) => c.id));
    const editable = new Set(
      conns
        .filter((c) => this.context.permissions.canUpdateSDKWebhook(c))
        .map((c) => c.id),
    );
    return {
      sdkWebhooks: webhooks.map((w) => {
        const live = w.sdks.filter((id) => existing.has(id));
        return this.toApiInterface(
          w,
          live.length > 0 && live.every((id) => editable.has(id)),
        );
      }),
    };
  }

  public async apiCreateForConnection(
    connectionId: string,
    body: PostSdkWebhookBody,
  ): Promise<ApiSdkWebhookReturn> {
    const { context } = this;
    const conn = await this.getConnectionForApi(connectionId);
    if (!context.permissions.canCreateSDKWebhook(conn)) {
      context.permissions.throwPermissionError();
    }
    this.assertHeadersJson(body.headers);

    const count = await this.countSdkWebhooksByOrg();
    if (
      count > 0 &&
      !orgHasPremiumFeature(context.org, "multiple-sdk-webhooks")
    ) {
      context.throwPlanDoesNotAllowError(
        "Your plan only supports one SDK webhook.",
      );
    }

    const webhook = await this.create({
      ...this.getDefaultCreateProps(conn.id),
      ...body,
      headers: body.headers ?? "",
      // Stored explicitly: a missing format reads back as legacy no-payload
      httpMethod: body.httpMethod ?? "POST",
      payloadFormat: body.payloadFormat ?? "standard",
    });
    return { sdkWebhook: this.toApiInterface(webhook) };
  }

  public async apiUpdate(
    id: string,
    body: PutSdkWebhookBody,
  ): Promise<ApiSdkWebhookReturn> {
    const { context } = this;
    const can = (c: SDKConnectionInterface) =>
      context.permissions.canUpdateSDKWebhook(c);
    const webhook = await this.getWebhookForApiUpdate(id, can);
    const { sdkConnections, ...updates } = body;
    // Only changed values are checked, so an echoed GET response still saves
    if (updates.headers !== (webhook.headers ?? "")) {
      this.assertHeadersJson(updates.headers);
    }
    if (
      updates.payloadFormat === "vercelNativeIntegration" &&
      webhook.payloadFormat !== "vercelNativeIntegration"
    ) {
      context.throwBadRequestError(
        "payloadFormat vercelNativeIntegration is managed by the Vercel integration",
      );
    }

    if (sdkConnections) {
      const added = sdkConnections.filter((id) => !webhook.sdks.includes(id));
      await assertCanUseSDKConnections(context, added, can);
      // Stale ids may round-trip, but a narrowed list must keep a live connection
      const removed = webhook.sdks.some((id) => !sdkConnections.includes(id));
      if (
        !added.length &&
        removed &&
        !(await findSDKConnectionsByIds(context, sdkConnections)).length
      ) {
        context.throwBadRequestError(
          "sdkConnections must include at least one existing SDK Connection",
        );
      }
    }

    // Reset failure state when the endpoint changes, as the app does
    const resetFields =
      updates.endpoint && updates.endpoint !== webhook.endpoint
        ? { consecutiveFailures: 0, disabled: false }
        : {};
    const updated = await this.update(webhook, {
      ...updates,
      ...(sdkConnections ? { sdks: sdkConnections } : {}),
      ...resetFields,
    });

    fireSdkWebhook(context, updated).catch(() => {
      // Already logged on the webhook
    });
    return { sdkWebhook: this.toApiInterface(updated) };
  }

  public async apiDelete(id: string): Promise<{ deletedId: string }> {
    await this.getWebhookForApiUpdate(
      id,
      (c) => this.context.permissions.canDeleteSDKWebhook(c),
      true,
    );
    await this.deleteById(id);
    return { deletedId: id };
  }

  public async apiTest(id: string): Promise<ApiSdkWebhookReturn> {
    const webhook = await this.getWebhookForApiUpdate(id, (c) =>
      this.context.permissions.canUpdateSDKWebhook(c),
    );
    await fireSdkWebhook(this.context, webhook).catch(() => {
      // The outcome is recorded on the webhook
    });
    const after = (await this.getById(webhook.id)) ?? webhook;
    return { sdkWebhook: this.toApiInterface(after) };
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
