import { ApiKeyInterface, SecretApiKey } from "shared/types/apikey";
import { apiKeySchema } from "shared/validators";
import {
  IS_MULTI_ORG,
  SECRET_API_KEY,
  SECRET_API_KEY_ROLE,
} from "back-end/src/util/secrets";
import {
  generateEncryptionKey,
  generateSigningKey,
  roleForApiKey,
} from "back-end/src/util/api-key.util";
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
  pKey: ["key"],
  globallyUniquePrimaryKeys: true,
  idPrefix: "key_",
  additionalIndexes: [{ fields: { id: 1 } }],
});

export class ApiKeyModel extends BaseClass {
  protected canCreate(apiKey: ApiKeyInterface): boolean {
    if (apiKey.userId) {
      return apiKey.userId === this.context.userId;
    } else {
      return this.context.permissions.canCreateApiKey();
    }
  }
  protected canRead(apiKey: ApiKeyInterface): boolean {
    if (apiKey.userId) {
      return apiKey.userId === this.context.userId;
    } else {
      return this.context.permissions.canReadSingleProjectResource(
        apiKey.project,
      );
    }
  }
  protected canUpdate(_existing: ApiKeyInterface): boolean {
    // ApiKeys should be immutable
    return false;
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

  protected static migrate(legacyDoc: unknown): ApiKeyInterface {
    const obj = legacyDoc as ApiKeyInterface;
    return {
      ...obj,
      role: roleForApiKey(obj) || undefined,
      dateUpdated: obj.dateUpdated ?? new Date(),
    };
  }
  protected migrate(legacyDoc: unknown): ApiKeyInterface {
    return ApiKeyModel.migrate(legacyDoc);
  }

  protected sanitize(doc: ApiKeyInterface): ApiKeyInterface {
    if (!doc.secret) return doc;
    return { ...doc, key: "", encryptionKey: undefined };
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

  public async getApiKeyByIdOrKey(
    id: string | undefined,
    key: string | undefined,
  ): Promise<ApiKeyInterface | null> {
    if (!id && !key) return null;

    return await this._findOne(id ? { id } : { key });
  }

  public async deleteByIdOrKey(
    id: string | undefined,
    key: string | undefined,
  ): Promise<void> {
    if (!id && !key) this.context.throwNotFoundError();

    const doc = await this._findOne(id ? { id } : { key }, {
      bypassSanitization: true,
    });
    if (!doc) this.context.throwNotFoundError();

    await this.delete(doc);
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
    return ApiKeyModel.migrate(removeMongooseFields(doc));
  }

  public async getUnredactedSecretKey(
    id: string,
  ): Promise<SecretApiKey | null> {
    return (await this._findOne(
      { id },
      { bypassSanitization: true },
    )) as SecretApiKey;
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
    const key = generateSigningKey(prefix);

    return await this.create({
      environment,
      project,
      description,
      key,
      secret,
      encryptSDK,
      userId,
      role,
      encryptionKey: encryptSDK ? await generateEncryptionKey() : undefined,
    });
  }
}
