import { ApiKeyInterface, SecretApiKey } from "shared/types/apikey";
import { apiKeySchema } from "shared/validators";
import { getRoleById } from "shared/permissions";
import {
  generateEncryptionKey,
  generateSigningKey,
  migrateApiKey,
} from "back-end/src/util/api-key.util";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "apikeys";

const BaseClass = MakeModelClass({
  schema: apiKeySchema,
  collectionName: COLLECTION_NAME,
  pKey: ["key"] as const,
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

  protected migrate(legacyDoc: unknown): ApiKeyInterface {
    return migrateApiKey(legacyDoc);
  }

  protected sanitize(doc: ApiKeyInterface): ApiKeyInterface {
    if (!doc.secret) return doc;
    return { ...doc, key: "", encryptionKey: undefined };
  }

  public async createOrganizationApiKey({
    description,
    roleId,
  }: {
    description: string;
    roleId: string;
  }): Promise<ApiKeyInterface> {
    if (this.context.org.deactivatedRoles?.includes(roleId)) {
      this.context.throwBadRequestError(`Role has been deactivated: ${roleId}`);
    }
    const role = getRoleById(roleId, this.context.org);
    if (!role) {
      this.context.throwBadRequestError(`Invalid role: ${roleId}`);
    }
    return await this.createApiKey({
      secret: true,
      encryptSDK: false,
      description,
      environment: "",
      project: "",
      role: roleId,
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
    return await this._findOne(
      {
        userId,
        role: "visualEditor",
      },
      {
        bypassSanitization: true,
      },
    );
  }

  public async getUnredactedSecretKey(
    id: string,
  ): Promise<SecretApiKey | null> {
    return (await this._findOne(
      { id },
      { bypassSanitization: true },
    )) as SecretApiKey;
  }

  public async dangerousGetAllApiKeysInOrg() {
    return await this._find({}, { bypassReadPermissionChecks: true });
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
      prefix += `${role.slice(0, 20)}_`;
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
