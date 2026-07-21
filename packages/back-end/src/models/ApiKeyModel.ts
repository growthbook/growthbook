import { ApiKeyInterface, SecretApiKey } from "shared/types/apikey";
import { apiKeySchema } from "shared/validators";
import { getRoleById } from "shared/permissions";
import {
  generateEncryptionKey,
  generateSigningKey,
  migrateApiKey,
} from "back-end/src/util/api-key.util";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { getCollection } from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "apikeys";

const BaseClass = MakeModelClass({
  schema: apiKeySchema,
  collectionName: COLLECTION_NAME,
  pKey: ["key"] as const,
  globallyUniquePrimaryKeys: true,
  idPrefix: "key_",
  additionalIndexes: [{ fields: { id: 1 } }],
  skipDateUpdatedFields: ["lastUsed"],
  defaultValues: {
    limitAccessByEnvironment: false,
    environments: [],
    lastUsed: null,
  },
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
  protected canUpdate(
    apiKey: ApiKeyInterface,
    updates: Partial<ApiKeyInterface>,
  ): boolean {
    // API keys are immutable except for toggling `disabled`.
    // Anything else (key value, role, etc.) must never be edited.
    // `lastUsed` is written by auth middleware via the dangerous bypass and never hits this path.
    const keys = Object.keys(updates);
    if (keys.length !== 1 || keys[0] !== "disabled") return false;
    return this.canDelete(apiKey);
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

  // Projects an API key doc down to a safe, non-sensitive subset for audit
  // details. This lives next to `sanitize` so the redaction allow-list stays in
  // one place. The raw `key` token and `encryptionKey` must NEVER be included so
  // the secret value can never leak into the audit log.
  public static toAuditDetails(doc: ApiKeyInterface) {
    return {
      id: doc.id,
      description: doc.description,
      role: doc.role,
      limitAccessByEnvironment: doc.limitAccessByEnvironment,
      environments: doc.environments,
      projectRoles: doc.projectRoles,
      disabled: doc.disabled,
    };
  }

  protected async customValidation(doc: ApiKeyInterface) {
    if (doc.userId) {
      // PATs inherit permissions from their user — scoping fields must not be set
      if (doc.limitAccessByEnvironment) {
        this.context.throwBadRequestError(
          "PATs do not support environment restrictions.",
        );
      }
      if (doc.projectRoles) {
        this.context.throwBadRequestError(
          "PATs do not support project-scoped roles.",
        );
      }
    } else {
      // Org API keys — validate role, environments, project roles, and commercial features
      this.validateRole(doc.role);
      if (
        doc.limitAccessByEnvironment &&
        !this.context.hasPremiumFeature("advanced-permissions")
      ) {
        this.context.throwPlanDoesNotAllowError(
          "Your plan does not support restricting API key permissions by environment.",
        );
      }
      this.validateEnvironments(doc.environments);
      if (doc.projectRoles) {
        if (!this.context.hasPremiumFeature("advanced-permissions")) {
          this.context.throwPlanDoesNotAllowError(
            "Your plan does not support project-level permissions on API keys.",
          );
        }
        for (const pr of doc.projectRoles) {
          this.validateRole(pr.role);
          await this.validateProject(pr.project);
          this.validateEnvironments(pr.environments);
        }
      }
    }
  }

  private validateRole(role: string | undefined) {
    if (role === undefined) return;
    if (this.context.org.deactivatedRoles?.includes(role)) {
      this.context.throwBadRequestError(`Role has been deactivated: ${role}`);
    }
    if (!getRoleById(role, this.context.org)) {
      this.context.throwBadRequestError(`Invalid role: ${role}`);
    }
  }

  private validateEnvironments(environments: string[]) {
    if (!environments.length) return;
    const orgEnvIds = getEnvironmentIdsFromOrg(this.context.org);
    for (const env of environments) {
      if (!orgEnvIds.includes(env)) {
        this.context.throwBadRequestError(`Invalid environment: ${env}`);
      }
    }
  }

  private async validateProject(projectId: string) {
    const project = (await this.context.getProjects()).find(
      ({ id }) => id === projectId,
    );
    if (!project) {
      this.context.throwBadRequestError(`Invalid project: ${projectId}`);
    }
  }

  public async createOrganizationApiKey({
    description,
    roleId,
    limitAccessByEnvironment,
    environments,
    projectRoles,
  }: {
    description: string;
    roleId: string;
    limitAccessByEnvironment?: boolean;
    environments?: string[];
    projectRoles?: ApiKeyInterface["projectRoles"];
  }): Promise<ApiKeyInterface> {
    return await this.createApiKey({
      secret: true,
      encryptSDK: false,
      description,
      environment: "",
      project: "",
      role: roleId,
      limitAccessByEnvironment,
      environments,
      projectRoles,
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

  // Returns the deleted doc so callers can audit-log the removed key.
  public async deleteByIdOrKey(
    id: string | undefined,
    key: string | undefined,
  ): Promise<ApiKeyInterface> {
    if (!id && !key) this.context.throwNotFoundError();

    const doc = await this._findOne(id ? { id } : { key }, {
      bypassSanitization: true,
    });
    if (!doc) this.context.throwNotFoundError();

    await this.delete(doc);
    return doc;
  }

  // Returns both the pre- and post-update docs so callers can audit-log the
  // before/after state from the real persisted doc.
  public async setDisabled(
    id: string,
    disabled: boolean,
  ): Promise<{ before: ApiKeyInterface; after: ApiKeyInterface }> {
    const doc = await this._findOne({ id }, { bypassSanitization: true });
    if (!doc) this.context.throwNotFoundError(`API key not found: ${id}`);
    const after = await this.update(doc, { disabled });
    return { before: doc, after };
  }

  // Admins can edit the permission scope of an existing org secret key in place
  // (role + environment/project restrictions + description). This lets already
  // issued tokens pick up new permissions immediately — auth reads the role from
  // this DB record on every request.
  public async updateSecretApiKeyPermissions(
    id: string,
    {
      role,
      limitAccessByEnvironment,
      environments,
      projectRoles,
      description,
    }: {
      role?: string;
      limitAccessByEnvironment?: boolean;
      environments?: string[];
      projectRoles?: ApiKeyInterface["projectRoles"];
      description?: string;
    },
  ): Promise<{ before: ApiKeyInterface; after: ApiKeyInterface }> {
    const doc = await this._findOne({ id }, { bypassSanitization: true });
    if (!doc) this.context.throwNotFoundError(`API key not found: ${id}`);

    // Only plain organization secret keys are editable here. SDK keys (non
    // secret) have no role, and PATs (secret + userId) derive their permissions
    // from the linked member, not the key doc — so both are rejected.
    if (!doc.secret) {
      this.context.throwBadRequestError(
        "Only secret API keys can have their permissions edited.",
      );
    }
    if (doc.userId) {
      this.context.throwBadRequestError(
        "Personal Access Tokens inherit permissions from their user and cannot be edited.",
      );
    }

    // Permission fields (role/scope/description) are intentionally editable by
    // admins, while the token's value and identity fields (key, secret, userId)
    // stay immutable. `canUpdate` blocks every field except `disabled`, so we
    // bypass it for this specific permission-only update via `forceCanUpdate`;
    // the update object below is limited to permission fields, so identity
    // fields can never be changed through this path. `customValidation` still
    // runs, re-applying the same role/environment/project checks and the
    // `advanced-permissions` premium gate used at creation time.
    //
    // The stored `key` string is left untouched so already-issued tokens keep
    // working. Its `secret_<role>_` prefix is purely cosmetic and is
    // intentionally left stale after a role change rather than reissuing.
    const after = await this._updateOne(
      doc,
      {
        role,
        limitAccessByEnvironment,
        environments,
        projectRoles,
        description,
      },
      { forceCanUpdate: true },
    );
    return { before: doc, after };
  }

  // Called from authentication middleware on every API request attempt.
  // Fires even for disabled keys so operators can see whether a key is still
  // being used before deleting it. Runs before the request context exists, so
  // it's a static raw $set scoped by the (key, organization) pair.
  public static async dangerousRecordUsageByKey(
    key: string,
    organization: string,
  ): Promise<void> {
    await getCollection<ApiKeyInterface>(COLLECTION_NAME).updateOne(
      { key, organization },
      { $set: { lastUsed: new Date() } },
    );
  }

  // OAuth token endpoint has no ReqContext. These static helpers keep apikey
  // writes in the model layer (same pattern as dangerousRecordUsageByKey).

  public static async dangerousFindByKeyHash(
    keyHash: string,
  ): Promise<ApiKeyInterface | null> {
    return getCollection<ApiKeyInterface>(COLLECTION_NAME).findOne({
      key: keyHash,
    });
  }

  public static async dangerousDisableByKeyHash(
    keyHash: string,
  ): Promise<void> {
    await getCollection<ApiKeyInterface>(COLLECTION_NAME).updateOne(
      { key: keyHash },
      { $set: { disabled: true } },
    );
  }

  /** Disable every non-disabled OAuth access token for one client/user/org grant. */
  public static async dangerousDisableOAuthGrant(
    clientId: string,
    userId: string,
    organization: string,
  ): Promise<void> {
    await getCollection<ApiKeyInterface>(COLLECTION_NAME).updateMany(
      {
        oauthClientId: clientId,
        userId,
        organization,
        disabled: { $ne: true },
      },
      { $set: { disabled: true } },
    );
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
    limitAccessByEnvironment,
    environments,
    projectRoles,
  }: {
    environment: string;
    project: string;
    description: string;
    secret: boolean;
    encryptSDK: boolean;
    userId?: string;
    role?: string;
    limitAccessByEnvironment?: boolean;
    environments?: string[];
    projectRoles?: ApiKeyInterface["projectRoles"];
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
      limitAccessByEnvironment: limitAccessByEnvironment ?? false,
      environments: environments ?? [],
      projectRoles,
    });
  }
}
