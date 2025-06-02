import { omit } from "lodash";
import Handlebars from "handlebars";
import {
  WebhookSecretFrontEndInterface,
  webhookSecretSchema,
} from "back-end/src/validators/webhook-secrets";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: webhookSecretSchema,
  collectionName: "webhooksecrets",
  idPrefix: "secret_",
  // If true, `id` is globally unique across all orgs
  // If false (default), the `organization`/`id` combo is unique.
  globallyUniqueIds: false,
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

  public async getAllForFrontEnd(): Promise<WebhookSecretFrontEndInterface[]> {
    const docs = await this.getAll();
    return docs.map((doc) => {
      return omit(doc, ["value"]);
    });
  }

  public async findByKey(key: string) {
    return this._findOne({ key });
  }

  public async getBackEndSecretsReplacer(): Promise<(s: string) => string> {
    const secrets = await this.getAll();
    const replacements: Record<string, string> = {};
    for (const secret of secrets) {
      replacements[secret.key] = secret.value;
    }
    return (s) => {
      const template = Handlebars.compile(s, {
        noEscape: true,
        strict: true,
      });
      return template(replacements);
    };
  }
}
