import { omit } from "lodash";
import uniqid from "uniqid";
import md5 from "md5";
import { WebhookInterface } from "shared/types/webhook";
import { webhookSchema } from "shared/validators";
import {
  getCollection,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

const COLLECTION_NAME = "webhooks";
const BaseClass = MakeModelClass({
  schema: webhookSchema,
  collectionName: COLLECTION_NAME,
  idPrefix: "wh_",
  globallyUniqueIds: true,
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
    return newDoc;
  }

  protected migrate(doc: unknown) {
    return SdkWebhookModel.migrate(doc);
  }

  public async findAllSdkWebhooksByConnectionIds(
    sdkConnectionIds: string[],
  ): Promise<WebhookInterface[]> {
    return await this.getAll({
      sdks: { $in: sdkConnectionIds },
    });
  }

  public async findAllSdkWebhooksByPayloadFormat(
    payloadFormat: string,
  ): Promise<WebhookInterface[]> {
    return await this.getAll({
      payloadFormat,
    });
  }

  public async findAllSdkWebhooksByConnection(
    sdkConnectionId: string,
  ): Promise<WebhookInterface[]> {
    return await this.getAll({
      sdks: sdkConnectionId,
    });
  }

  public async findAllLegacySdkWebhooks(): Promise<WebhookInterface[]> {
    return await this.getAll({
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
    await this.update(webhook, {
      error,
      lastSuccess: error ? undefined : new Date(),
    });
  }

  public static async dangerousFindSdkWebhookByIdAcrossOrgs(id: string) {
    const doc = getCollection(COLLECTION_NAME).findOne({
      id,
    });
    return doc ? this.migrate(removeMongooseFields(doc)) : null;
  }

  public async countSdkWebhooksByOrg(organization: string) {
    return await this._dangerousGetCollection().countDocuments({
      organization,
      useSdkMode: true,
    });
  }

  public getCreateProps(sdkConnectionId: string) {
    return {
      environment: "",
      project: "",
      error: "",
      created: new Date(),
      lastSuccess: null,
      signingKey: "wk_" + md5(uniqid()).slice(0, 16),
      useSdkMode: true,
      featuresOnly: true,
      sdks: [sdkConnectionId],
    };
  }
}
