import { omit } from "lodash";
import {
  WebhookSecretFrontEndInterface,
  WebhookSecretInterface,
  webhookSecretSchema,
} from "shared/validators";
import { secretsReplacer } from "back-end/src/util/secrets";
import { webhookSecretApiSpec } from "back-end/src/api/specs/webhook-secret.spec";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: webhookSecretSchema,
  collectionName: "webhooksecrets",
  affectsDefinitionsVersion: true,
  // Org-wide (no project field) → bumps globally. `value` is omitted from the
  // definitions response (getAllForFrontEnd), so rotation shouldn't invalidate.
  definitionsVersionExcludedFields: ["value"],
  idPrefix: "secret_",
  // If true, `id` is globally unique across all orgs
  // If false (default), the `organization`/`id` combo is unique.
  globallyUniquePrimaryKeys: false,
  readonlyFields: [],
  additionalIndexes: [
    {
      unique: true,
      fields: {
        organization: 1,
        key: 1,
      },
    },
  ],
  apiConfig: {
    modelKey: "webhookSecrets",
    openApiSpec: webhookSecretApiSpec,
  },
});

export class WebhookSecretDataModel extends BaseClass {
  protected canCreate(): boolean {
    return this.context.permissions.canCreateEventWebhook();
  }
  protected canRead(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return this.context.permissions.canUpdateEventWebhook();
  }

  protected canDelete(): boolean {
    return this.context.permissions.canDeleteEventWebhook();
  }

  // Readable app-wide for webhook setup, but over REST only with webhook access
  private assertCanViewViaApi() {
    if (!this.context.permissions.canViewEventWebhook()) {
      this.context.permissions.throwPermissionError();
    }
  }

  public override async handleApiGet(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiGet"]>[0],
  ) {
    this.assertCanViewViaApi();
    return super.handleApiGet(req);
  }

  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ) {
    this.assertCanViewViaApi();
    return super.handleApiList(req);
  }

  protected toApiInterface(doc: WebhookSecretInterface) {
    return {
      id: doc.id,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
      key: doc.key,
      description: doc.description,
      allowedOrigins: doc.allowedOrigins,
    };
  }

  public async getAllForFrontEnd(): Promise<WebhookSecretFrontEndInterface[]> {
    const docs = await this.getAll();
    return docs.map((doc) => {
      return omit(doc, ["value"]);
    });
  }

  public async deleteByKey(key: string) {
    const existing = await this._findOne({ key });
    if (!existing) return;
    await this._deleteOne(existing);
  }

  public async getBackEndSecretsReplacer(origin: string) {
    const secrets = await this.getAll();
    const replacements: Record<string, string> = {};
    for (const secret of secrets) {
      if (
        !secret.allowedOrigins ||
        !secret.allowedOrigins.length ||
        secret.allowedOrigins.includes(origin)
      ) {
        replacements[secret.key] = secret.value;
      }
    }

    return secretsReplacer(replacements);
  }
}
