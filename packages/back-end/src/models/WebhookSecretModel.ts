import { omit } from "lodash";
import {
  WebhookSecretFrontEndInterface,
  WebhookSecretInterface,
  webhookSecretSchema,
} from "shared/validators";
import {
  renderedWebhookOrigin,
  secretsReplacer,
} from "back-end/src/util/secrets";
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
    return this.context.permissions.canManageWebhookSecrets();
  }
  protected canRead(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return this.context.permissions.canManageWebhookSecrets();
  }

  protected canDelete(): boolean {
    return this.context.permissions.canManageWebhookSecrets();
  }

  // Readable app-wide for webhook setup, but over REST only with some webhook access
  private assertCanViewViaApi() {
    if (!this.context.permissions.canManageSomeEventWebhooks()) {
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

  // The secrets a webhook may use, judged by the origin its URL renders to.
  // `placeholders` stand in for referenced keys that don't exist, so they
  // don't stop the URL from rendering.
  private async usableAt(url: string, placeholders: string[] = []) {
    const all = await this.getAll();
    const originWith = (secrets: typeof all) =>
      renderedWebhookOrigin(url, {
        ...Object.fromEntries(placeholders.map((key) => [key, "x"])),
        ...Object.fromEntries(
          secrets.map((secret) => [secret.key, secret.value]),
        ),
      });
    const origin = originWith(all);
    if (origin === null) return [];
    const usable = all.filter(
      (secret) =>
        !secret.allowedOrigins?.length ||
        secret.allowedOrigins.includes(origin),
    );
    // The send renders with only these, and a template can branch on a secret
    // being absent, so the origin has to hold for the set actually sent.
    return originWith(usable) === origin ? usable : [];
  }

  public async getUsableKeys(
    url: string,
    referenced: string[],
  ): Promise<Set<string>> {
    return new Set(
      (await this.usableAt(url, referenced)).map((secret) => secret.key),
    );
  }

  // A referenced secret that isn't usable is absent here, so rendering throws
  // inside the send and is recorded as a failed delivery.
  public async getBackEndSecretsReplacer(url: string) {
    return secretsReplacer(
      Object.fromEntries(
        (await this.usableAt(url)).map((secret) => [secret.key, secret.value]),
      ),
    );
  }
}
