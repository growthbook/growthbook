import { isEqual } from "lodash";
import { z } from "zod";
import { ApiKeyInterface, SecretApiKey } from "shared/types/apikey";
import { apiKeySchema, secretApiKeyUpdatableFields } from "shared/validators";
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

const UPDATABLE_KEY_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(secretApiKeyUpdatableFields.shape),
);

// Full-replacement semantics: every permission field is required so a caller
// omitting one can't silently strip a key's restrictions. Only the
// description merges (kept when omitted).
type UpdateOrganizationApiKeyProps = Omit<
  Required<z.infer<typeof secretApiKeyUpdatableFields>>,
  "role" | "description"
> & {
  roleId: string;
  description?: string;
};

// Org secret keys are the only kind with editable permissions: PATs inherit
// their user's permissions and SDK endpoint keys have no role.
function isOrgSecretKey(apiKey: ApiKeyInterface): boolean {
  return !!apiKey.secret && !apiKey.userId;
}

const BaseClass = MakeModelClass({
  schema: apiKeySchema,
  collectionName: COLLECTION_NAME,
  pKey: ["key"] as const,
  globallyUniquePrimaryKeys: true,
  idPrefix: "key_",
  additionalIndexes: [{ fields: { id: 1 } }],
  skipDateUpdatedFields: ["lastUsed"],
  // canUpdate's field allowlist is the authz gate; this hard-fails identity
  // and key-material writes on every update path regardless of authz
  readonlyFields: [
    "key",
    "encryptionKey",
    "secret",
    "userId",
    "environment",
    "project",
  ],
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
    // `lastUsed` is written by auth middleware via the dangerous bypass and never hits this path.
    const keys = Object.keys(updates);
    if (keys.length === 1 && keys[0] === "disabled") {
      return this.canDelete(apiKey);
    }
    // The key value itself and identity fields (secret, userId) must never
    // be edited.
    if (!isOrgSecretKey(apiKey)) return false;
    if (!keys.length || !keys.every((k) => UPDATABLE_KEY_FIELDS.has(k))) {
      return false;
    }
    return this.context.permissions.canUpdateApiKey();
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

  protected async customValidation(
    doc: ApiKeyInterface,
    previousDoc?: ApiKeyInterface,
  ) {
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
      // Org API keys — validate role, environments, project roles, and
      // commercial features. Only fields that actually changed are validated,
      // so pre-existing state that has since become invalid (a deactivated
      // role, a lapsed premium feature) doesn't block unrelated edits.
      if (!previousDoc || doc.role !== previousDoc.role) {
        this.validateRole(doc.role);
      }
      const envRestrictionsChanged =
        !previousDoc ||
        doc.limitAccessByEnvironment !== previousDoc.limitAccessByEnvironment ||
        !isEqual(doc.environments, previousDoc.environments);
      // With the restriction off the env list is inert, and validating it
      // would stop a key whose org since deleted an environment from ever
      // turning the restriction off
      if (envRestrictionsChanged && doc.limitAccessByEnvironment) {
        if (!this.context.hasPremiumFeature("advanced-permissions")) {
          this.context.throwPlanDoesNotAllowError(
            "Your plan does not support restricting API key permissions by environment.",
          );
        }
        this.validateEnvironments(doc.environments);
      }
      if (
        doc.projectRoles?.length &&
        (!previousDoc || !isEqual(doc.projectRoles, previousDoc.projectRoles))
      ) {
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

  // Full-replacement update of an org secret key's permissions. The key value
  // is untouched, so callers keep working — the new permissions apply on their
  // next request (auth reads the key doc fresh every time). Note the role
  // embedded in the key string's prefix is cosmetic and may go stale.
  // Returns void like the other mutators — the unredacted doc must not leak.
  public async updateOrganizationApiKey(
    id: string,
    {
      description,
      roleId,
      limitAccessByEnvironment,
      environments,
      projectRoles,
    }: UpdateOrganizationApiKeyProps,
  ): Promise<void> {
    // canUpdate also gates this, but only for updates that change something —
    // check up front so a value-matching no-op can't be used by unprivileged
    // members to probe a key's current permissions.
    if (!this.context.permissions.canUpdateApiKey()) {
      this.context.permissions.throwPermissionError();
    }
    const doc = await this.getUnredactedByIdOrThrow(id);
    if (!isOrgSecretKey(doc)) {
      this.context.throwBadRequestError(
        "Only organization secret API keys support permission updates",
      );
    }
    await this.update(doc, {
      ...(description !== undefined ? { description } : null),
      role: roleId,
      limitAccessByEnvironment,
      environments,
      // Explicit undefined clears any existing project-scoped roles
      projectRoles: projectRoles.length ? projectRoles : undefined,
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

  public async setDisabled(id: string, disabled: boolean): Promise<void> {
    const doc = await this.getUnredactedByIdOrThrow(id);
    await this.update(doc, { disabled });
  }

  private async getUnredactedByIdOrThrow(id: string): Promise<ApiKeyInterface> {
    const doc = await this._findOne({ id }, { bypassSanitization: true });
    if (!doc) this.context.throwNotFoundError(`API key not found: ${id}`);
    return doc;
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
