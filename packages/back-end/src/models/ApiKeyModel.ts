import crypto from "crypto";
import { webcrypto } from "node:crypto";
import { ApiKeyInterface, SecretApiKey } from "shared/types/apikey";
import { apiKeySchema } from "shared/validators";
import {
  IS_MULTI_ORG,
  SECRET_API_KEY,
  SECRET_API_KEY_ROLE,
} from "back-end/src/util/secrets";
import { roleForApiKey } from "back-end/src/util/api-key.util";
import {
  getCollection,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";
import { findAllOrganizations } from "./OrganizationModel";
import { MakeModelClass } from "./BaseModel";

const COLLECTION_NAME = "apikeys";

const BaseClass = MakeModelClass({
  schema: apiKeySchema,
  collectionName: COLLECTION_NAME,
  idPrefix: "key_",
  additionalIndexes: [{ fields: { key: 1 }, unique: true }],
  // TODO: add default projection to remove encryptionKey and also key if secret is true
});

export class ApiKeyModel extends BaseClass {
  protected canCreate(apiKey: ApiKeyInterface): boolean {
    if (apiKey.userId) {
      return apiKey.userId === this.context.userId;
    } else {
      return this.context.permissions.canCreateApiKey();
    }
  }
  // TODO: handle reading secret keys
  protected canRead(apiKey: ApiKeyInterface): boolean {
    if (apiKey.userId) {
      return apiKey.userId === this.context.userId;
    } else {
      return this.context.permissions.canReadSingleProjectResource(
        apiKey.project,
      );
    }
  }
  protected canUpdate(): boolean {
    return true;
  }
  protected canDelete(apiKey: ApiKeyInterface): boolean {
    if (apiKey.secret) {
      if (apiKey.userId) {
        // For Personal Access Token (PAT)s - users can delete only their own PATs regardless of permission level.
        return apiKey.userId === this.context.userId;
      } else {
        // If there is no userId, this is an API Key, so we check permissions.
        return this.context.permissions.canDeleteApiKey();
      }
    } else {
      return this.context.permissions.canDeleteSDKConnection({
        projects: [apiKey.project || ""],
        environment: apiKey.environment || "",
      });
    }
  }

  protected migrate(legacyDoc: unknown): ApiKeyInterface {
    const obj = legacyDoc as ApiKeyInterface;
    return {
      ...obj,
      id: obj.id ?? this._generateId(),
      role: roleForApiKey(obj) || undefined,
      dateUpdated: obj.dateUpdated ?? new Date(),
    };
  }

  public static async generateEncryptionKey(): Promise<string> {
    const key = await webcrypto.subtle.generateKey(
      {
        name: "AES-CBC",
        length: 128,
      },
      true,
      ["encrypt", "decrypt"],
    );
    return Buffer.from(await webcrypto.subtle.exportKey("raw", key)).toString(
      "base64",
    );
  }

  public static generateSigningKey(prefix: string = "", bytes = 32): string {
    return (
      prefix +
      crypto.randomBytes(bytes).toString("base64").replace(/[=/+]/g, "")
    );
  }

  public async createOrganizationApiKey({
    description,
    role = "readonly",
  }: {
    description: string;
    role: "admin" | "readonly";
  }): Promise<ApiKeyInterface> {
    return await this.createApiKey({
      secret: true,
      encryptSDK: false,
      description,
      environment: "",
      project: "",
      role,
    });
  }

  public async createUserPersonalAccessApiKey({
    userId,
    description,
  }: {
    userId: string;
    description: string;
  }): Promise<ApiKeyInterface> {
    return await this.createApiKey({
      userId,
      secret: true,
      environment: "",
      project: "",
      encryptSDK: false,
      description,
      role: "user",
    });
  }

  public async createUserVisualEditorApiKey({
    userId,
    description,
  }: {
    userId: string;
    description: string;
  }): Promise<ApiKeyInterface> {
    return await this.createApiKey({
      userId,
      secret: true,
      environment: "",
      project: "",
      encryptSDK: false,
      description,
      role: "visualEditor",
    });
  }

  public async deleteApiKeyByKey(key: string) {
    const apiKey = await this._findOne({ key });
    if (!apiKey) this.context.throwNotFoundError();
    await this.delete(apiKey);
  }

  public async getApiKeyByIdOrKey(
    id: string | undefined,
    key: string | undefined,
  ): Promise<ApiKeyInterface | null> {
    if (!id && !key) return null;

    return await this._findOne(id ? { id } : { key });
  }

  public async getVisualEditorApiKey(
    userId: string,
  ): Promise<ApiKeyInterface | null> {
    return await this._findOne({
      userId,
      role: "visualEditor",
    });
  }

  public static async lookupOrganizationByApiKey(
    key: string,
  ): Promise<Partial<ApiKeyInterface>> {
    // If self-hosting on a single org and using a hardcoded secret key
    if (!IS_MULTI_ORG && SECRET_API_KEY && key === SECRET_API_KEY) {
      const { organizations: orgs } = await findAllOrganizations(1, "");
      if (orgs.length === 1) {
        return {
          id: "SECRET_API_KEY",
          key: SECRET_API_KEY,
          secret: true,
          organization: orgs[0].id,
          role: SECRET_API_KEY_ROLE,
        };
      }
    }

    const doc = await getCollection<ApiKeyInterface>(COLLECTION_NAME).findOne({
      key,
    });

    if (!doc || !doc.organization) return {};
    return removeMongooseFields(doc);
  }

  public async getUnredactedSecretKey(
    id: string,
  ): Promise<SecretApiKey | null> {
    // TODO: add projection override allowing secret
    return (await this._findOne({
      id,
    })) as SecretApiKey;
  }

  private prefixForApiKey({
    environment,
    secret,
    userId,
    role,
  }: {
    environment: string;
    secret: boolean;
    userId?: string;
    role?: string;
  }): string {
    // Non-secret keys are SDK keys and use the environment prefix
    if (!secret) {
      return `${this.getShortEnvName(environment)}_`;
    }

    // Secret keys either have the user or role prefix
    let prefix = "secret_";
    if (userId) {
      prefix += "user_";
    } else if (role) {
      prefix += `${role}_`;
    }

    return prefix;
  }

  private getShortEnvName(env: string) {
    env = env.toLowerCase();
    if (env.startsWith("dev")) return "dev";
    if (env.startsWith("local")) return "local";
    if (env.startsWith("staging")) return "staging";
    if (env.startsWith("stage")) return "stage";
    if (env.startsWith("qa")) return "qa";
    // Default to first 4 characters
    // Will work for "production" and "testing"
    return env.substring(0, 4);
  }

  private async createApiKey({
    environment,
    project,
    description,
    secret,
    encryptSDK,
    userId,
    role,
  }: {
    environment: string;
    project: string;
    description: string;
    secret: boolean;
    encryptSDK: boolean;
    userId?: string;
    role?: string;
  }): Promise<ApiKeyInterface> {
    // NOTE: There's a plan to migrate SDK connection-related things to the SdkConnection collection
    if (!secret && !environment) {
      throw new Error("SDK Endpoints must have an environment set");
    }

    const prefix = this.prefixForApiKey({
      environment,
      secret,
      userId,
      role,
    });
    const key = ApiKeyModel.generateSigningKey(prefix);

    return await this.create({
      environment,
      project,
      description,
      key,
      secret,
      encryptSDK,
      userId,
      role,
      encryptionKey: encryptSDK
        ? await ApiKeyModel.generateEncryptionKey()
        : undefined,
    });
  }
}
