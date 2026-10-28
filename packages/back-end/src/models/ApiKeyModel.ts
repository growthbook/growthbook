import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import pick from "lodash/pick";
import { ApiKeyInterface, SecretApiKey } from "shared/types/apikey";
import {
  apiKeySchema,
  ConfirmRule,
  OAuthTokenPermissions,
} from "shared/validators";
import {
  apiKeyToggleRequiresAdmin,
  canManageApiKeySecret,
  canSetApiKeyDisabled,
  changesApiKeyAuthority,
  getRoleById,
} from "shared/permissions";
import {
  addDays,
  EXPIRING_SOON_DAYS,
  ExpiresAt,
  getExpirationProblem,
  isExpired,
  latestEditedExpiration,
  maxExpirationDate,
  previousKeyExpiration,
  rotatedExpiration,
  violatesExpirationPolicy,
} from "shared/api-key-expiration";
import { date } from "shared/dates";
import {
  generateEncryptionKey,
  generateSigningKey,
  migrateApiKey,
} from "back-end/src/util/api-key.util";
import {
  assertProjectRulesReferenceProjects,
  getEnvironmentIdsFromOrg,
} from "back-end/src/services/organizations";
import { getCollection } from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "apikeys";

const SCOPE_FIELDS = [
  "role",
  "limitAccessByEnvironment",
  "environments",
  "additionalRoles",
  "projectRoles",
] as const;

const BaseClass = MakeModelClass({
  schema: apiKeySchema,
  collectionName: COLLECTION_NAME,
  pKey: ["key"] as const,
  globallyUniquePrimaryKeys: true,
  idPrefix: "key_",
  additionalIndexes: [
    { fields: { id: 1 } },
    // Partial TTL for OAuth access tokens only — classic API keys/PATs are untouched.
    {
      fields: { expiresAt: 1 },
      expireAfterSeconds: 0,
      partialFilterExpression: { oauthClientId: { $exists: true } },
      name: "oauthAccessTokenTtl",
    },
    {
      fields: { previousKey: 1 },
      partialFilterExpression: { previousKey: { $exists: true } },
      name: "previousKey",
    },
  ],
  skipDateUpdatedFields: ["lastUsed"],
  defaultValues: {
    limitAccessByEnvironment: false,
    environments: [],
    lastUsed: null,
  },
});

const toTime = (d: ExpiresAt) => (d ? new Date(d).getTime() : null);

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
      // Admins can read members' PATs, so "readable" doesn't mean "own": getApiKeys
      // filters to the caller's userId and postApiKeyReveal checks ownership.
      return (
        apiKey.userId === this.context.userId ||
        this.context.permissions.canManagePersonalAccessTokens()
      );
    } else if (apiKey.secret) {
      return this.context.permissions.canViewApiKeys();
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
    // API keys are immutable apart from this allow-list. The key value, role and
    // identity fields must never be edited here.
    // `lastUsed` is written by auth middleware via the dangerous bypass and never hits this path.
    const editable = new Set(["disabled", "disabledBy", "expiresAt"]);
    const keys = Object.keys(updates);
    if (!keys.length || keys.some((k) => !editable.has(k))) return false;
    // Admins can disable another member's PAT without being able to delete it —
    // the disabled doc keeps `lastUsed` ticking so they can see continued use.
    if (apiKey.secret && updates.disabled !== undefined) {
      return canSetApiKeyDisabled(
        this.context.permissions,
        apiKey,
        this.context.userId,
        updates.disabled,
      );
    }
    // Expiry-only updates come from applying the expiration policy.
    if (apiKeyToggleRequiresAdmin(apiKey, this.context.userId)) {
      return this.context.permissions.canManagePersonalAccessTokens();
    }
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
    return {
      ...doc,
      key: "",
      previousKey: undefined,
      encryptionKey: undefined,
    };
  }

  // Projects an API key doc down to a safe, non-sensitive subset for audit
  // details. This lives next to `sanitize` so the redaction allow-list stays in
  // one place. The raw `key` and `previousKey` tokens and `encryptionKey` must
  // NEVER be included so a secret value can never leak into the audit log.
  public static toAuditDetails(doc: ApiKeyInterface) {
    return {
      id: doc.id,
      description: doc.description,
      // A token's owner, null for an org key: history access tells them apart.
      userId: doc.userId ?? null,
      role: doc.role,
      scoped: doc.scoped,
      limitAccessByEnvironment: doc.limitAccessByEnvironment,
      environments: doc.environments,
      additionalRoles: doc.additionalRoles,
      projectRoles: doc.projectRoles,
      actAs: doc.actAs,
      disabled: doc.disabled,
      disabledBy: doc.disabledBy,
      expiresAt: doc.expiresAt,
      confirmRules: doc.confirmRules,
      keyIssuedAt: doc.keyIssuedAt,
      previousKeyExpiresAt: doc.previousKeyExpiresAt,
    };
  }

  protected async customValidation(
    doc: ApiKeyInterface,
    previousDoc?: ApiKeyInterface,
  ) {
    // An OAuth token carries its grant's permissions, which consent checked
    // (validateOAuthPermissions). Like a stored key's, they aren't re-checked,
    // so a refresh still works after a downgrade or once a role or environment
    // they name is gone.
    const consented = !!doc.oauthClientId;
    if (!consented) this.assertPlanAllowsConfirmations(doc, previousDoc);
    const maxDays = this.maxLifetimeDaysFor(doc);
    if (
      doc.secret &&
      !doc.oauthClientId &&
      (!previousDoc || toTime(doc.expiresAt) !== toTime(previousDoc.expiresAt))
    ) {
      // Reviving a lapsed key is what creating a replacement is for.
      if (previousDoc && isExpired(previousDoc.expiresAt)) {
        this.context.throwBadRequestError(
          "An expired key's expiration date can't be changed. Create a new key instead.",
        );
      }
      const latest = previousDoc
        ? latestEditedExpiration(
            previousDoc.expiresAt,
            previousDoc.keyIssuedAt ?? previousDoc.dateCreated,
            maxDays,
          )
        : maxExpirationDate(maxDays);
      const problem = getExpirationProblem(
        doc.expiresAt,
        maxDays,
        new Date(),
        latest,
      );
      if (problem) {
        this.context.throwBadRequestError(
          problem === "past"
            ? "The expiration date must be in the future."
            : problem === "required"
              ? "This organization requires an expiration date."
              : `This organization's ${maxDays}-day maximum lifetime allows this key an expiration date no later than ${date(latest as Date)}.`,
        );
      }
    }
    if (doc.userId) {
      if (doc.actAs) {
        this.context.throwBadRequestError(
          "PATs already act as a user and cannot take X-GrowthBook-Requested-By.",
        );
      }
      // Creation only — existing tokens are already rejected at authentication,
      // and users must still be able to disable or delete the ones they have.
      if (
        !previousDoc &&
        this.context.org.settings?.disablePersonalAccessTokens
      ) {
        this.context.throwBadRequestError(
          "Personal access tokens are disabled for this organization.",
        );
      }
      if (!doc.scoped) {
        this.assertUnscopedTokenUnrestricted(doc);
        return;
      }
      if (!doc.role) {
        this.context.throwBadRequestError(
          "Scoped personal access tokens require a role.",
        );
      }
    }
    // Only a write that changes the scope is checked, so a key stays disableable after its plan, roles or environments lapse.
    if (
      consented ||
      (previousDoc &&
        isEqual(pick(doc, SCOPE_FIELDS), pick(previousDoc, SCOPE_FIELDS)))
    ) {
      return;
    }
    this.assertPlanAllowsScope(doc, previousDoc);
    await this.validateScope(doc, previousDoc);
  }

  // Everything a new token's permissions are checked against, run once on the
  // OAuth consent page so a bad choice fails there and its tokens skip it.
  public async validateOAuthPermissions(
    permissions: OAuthTokenPermissions | null,
  ) {
    if (!permissions) return;
    this.assertPlanAllowsConfirmations(permissions);
    const { scopedRole, ...scope } = permissions;
    if (!scopedRole) {
      this.assertUnscopedTokenUnrestricted(scope);
      return;
    }
    const doc = {
      ...scope,
      role: scopedRole,
      limitAccessByEnvironment: scope.limitAccessByEnvironment ?? false,
      environments: scope.environments ?? [],
    };
    this.assertPlanAllowsScope(doc);
    await this.validateScope(doc);
  }

  // An unscoped token acts as its user, so it can't carry restrictions.
  private assertUnscopedTokenUnrestricted(doc: {
    limitAccessByEnvironment?: boolean;
    projectRoles?: unknown[];
    additionalRoles?: unknown[];
  }) {
    if (
      doc.limitAccessByEnvironment ||
      doc.projectRoles?.length ||
      doc.additionalRoles?.length
    ) {
      this.context.throwBadRequestError(
        "Restricting a personal access token requires a scoped role.",
      );
    }
  }

  // Only turning confirmations on is gated, so a key keeps and can still edit
  // its confirmations after a downgrade, and can always drop them.
  private assertPlanAllowsConfirmations(
    doc: Pick<ApiKeyInterface, "confirmRules">,
    previousDoc?: Pick<ApiKeyInterface, "confirmRules">,
  ) {
    if (
      doc.confirmRules &&
      !previousDoc?.confirmRules &&
      !this.context.hasPremiumFeature("human-in-the-loop")
    ) {
      this.context.throwPlanDoesNotAllowError(
        "Your plan does not support Human-in-the-Loop confirmations.",
      );
    }
  }

  // Commercial gates, for org keys and scoped PATs alike. Only a role change is
  // gated so existing keys keep working.
  private assertPlanAllowsScope(
    doc: Pick<
      ApiKeyInterface,
      "role" | "limitAccessByEnvironment" | "additionalRoles" | "projectRoles"
    >,
    previousDoc?: Pick<ApiKeyInterface, "role">,
  ) {
    if (
      doc.role &&
      doc.role !== previousDoc?.role &&
      doc.role !== "admin" &&
      !this.context.limits.orgSupportsRoles()
    ) {
      this.context.throwPaymentRequiredError(
        "Your plan only supports the admin role. Upgrade your plan to assign other roles.",
      );
    }
    if (
      (doc.limitAccessByEnvironment ||
        doc.additionalRoles?.some((r) => r.limitAccessByEnvironment)) &&
      !this.context.hasPremiumFeature("advanced-permissions")
    ) {
      this.context.throwPlanDoesNotAllowError(
        "Your plan does not support restricting API key permissions by environment.",
      );
    }
    if (
      doc.projectRoles?.length &&
      !this.context.hasPremiumFeature("advanced-permissions")
    ) {
      this.context.throwPlanDoesNotAllowError(
        "Your plan does not support project-level permissions on API keys.",
      );
    }
  }

  // Role, environments and project rules, for org keys and scoped PATs alike
  private async validateScope(
    doc: Pick<
      ApiKeyInterface,
      "role" | "environments" | "additionalRoles" | "projectRoles"
    >,
    previousDoc?: Pick<ApiKeyInterface, "projectRoles">,
  ) {
    this.validateRole(doc.role);
    this.validateEnvironments(doc.environments);
    for (const rule of doc.additionalRoles ?? []) {
      this.validateRole(rule.role);
      this.validateEnvironments(rule.environments);
    }
    if (!doc.projectRoles?.length) return;
    for (const pr of doc.projectRoles) {
      this.validateRole(pr.role);
      this.validateEnvironments(pr.environments);
      for (const rule of pr.additionalRoles ?? []) {
        this.validateRole(rule.role);
        this.validateEnvironments(rule.environments);
      }
    }
    // Only rules this write adds or changes are checked (same as members and
    // teams), so a key still pointing at a since-deleted project stays
    // editable and can be disabled.
    try {
      await assertProjectRulesReferenceProjects(
        this.context,
        previousDoc?.projectRoles,
        doc.projectRoles,
      );
    } catch (e) {
      this.context.throwBadRequestError(e.message);
    }
  }

  // SDK endpoint keys and app-issued OAuth tokens are out of scope: neither is
  // a credential a person manages, and OAuth tokens already expire on their own.
  private maxLifetimeDaysFor(doc: ApiKeyInterface): number | null | undefined {
    if (!doc.secret || doc.oauthClientId) return null;
    return doc.userId
      ? this.context.org.settings?.maxPatLifetimeDays
      : this.context.org.settings?.maxApiKeyLifetimeDays;
  }

  /**
   * Stamps the policy maximum onto every key of one kind that has no expiry or
   * outlives the maximum. Scoped server-side by kind rather than by ids from the
   * client, so it can neither be pointed at arbitrary keys nor miss keys created
   * since the page loaded.
   */
  public async applyExpirationPolicy(
    kind: "pat" | "secret",
  ): Promise<{ updated: number; expiresAt: Date | null }> {
    const maxDays =
      kind === "pat"
        ? this.context.org.settings?.maxPatLifetimeDays
        : this.context.org.settings?.maxApiKeyLifetimeDays;
    const expiresAt = maxExpirationDate(maxDays);
    if (!expiresAt) return { updated: 0, expiresAt: null };

    // Unsanitized: `sanitize` blanks `key`, which is this model's primary key,
    // so updates built from a sanitized read match no document and no-op.
    const docs = await this._find(
      {
        secret: true,
        oauthClientId: { $exists: false },
        userId: kind === "pat" ? { $ne: null } : null,
      },
      { bypassSanitization: true },
    );

    let updated = 0;
    for (const doc of docs) {
      if (!violatesExpirationPolicy(doc.expiresAt, maxDays)) continue;
      await this.update(doc, { expiresAt });
      updated++;
    }
    return { updated, expiresAt };
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

  public async createOrganizationApiKey({
    description,
    roleId,
    limitAccessByEnvironment,
    environments,
    additionalRoles,
    projectRoles,
    actAs,
    expiresAt,
    confirmRules,
  }: {
    description: string;
    roleId: string;
    limitAccessByEnvironment?: boolean;
    environments?: string[];
    additionalRoles?: ApiKeyInterface["additionalRoles"];
    projectRoles?: ApiKeyInterface["projectRoles"];
    actAs?: ApiKeyInterface["actAs"];
    expiresAt?: Date | null;
    confirmRules?: ConfirmRule[] | null;
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
      additionalRoles,
      projectRoles,
      actAs,
      expiresAt,
      confirmRules,
    });
  }

  // Scoping fields without a scopedRole are passed through so validation rejects them.
  public async createUserPersonalAccessApiKey({
    userId,
    description,
    scopedRole,
    limitAccessByEnvironment,
    environments,
    additionalRoles,
    projectRoles,
    expiresAt,
    confirmRules,
  }: {
    userId: string;
    description: string;
    scopedRole?: string;
    limitAccessByEnvironment?: boolean;
    environments?: string[];
    additionalRoles?: ApiKeyInterface["additionalRoles"];
    projectRoles?: ApiKeyInterface["projectRoles"];
    expiresAt?: Date | null;
    confirmRules?: ConfirmRule[] | null;
  }): Promise<ApiKeyInterface> {
    return await this.createApiKey({
      userId,
      secret: true,
      environment: "",
      project: "",
      encryptSDK: false,
      description,
      role: scopedRole || "user",
      scoped: !!scopedRole,
      limitAccessByEnvironment,
      environments,
      additionalRoles,
      projectRoles,
      expiresAt,
      confirmRules,
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
      expiresAt: maxExpirationDate(
        this.context.org.settings?.maxPatLifetimeDays,
      ),
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
    // Missing and not permitted get the same answer, so the lookup tells a
    // caller without delete rights nothing.
    if (!doc || !this.canDelete(doc)) this.context.throwNotFoundError();

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
    const after = await this.update(doc, {
      disabled,
      disabledBy: disabled ? this.context.userId : null,
    });
    return { before: doc, after };
  }

  // Admins can edit the permission scope of an existing org secret key in place,
  // and users their own PATs (role + environment/project restrictions +
  // description). This lets already issued tokens pick up new permissions
  // immediately — auth reads the role from this DB record on every request.
  public async updateSecretApiKeyPermissions(
    id: string,
    {
      role,
      scopedRole,
      limitAccessByEnvironment,
      environments,
      additionalRoles,
      projectRoles,
      description,
      actAs,
      expiresAt,
      confirmRules,
    }: {
      role?: string;
      scopedRole?: string;
      limitAccessByEnvironment?: boolean;
      environments?: string[];
      additionalRoles?: ApiKeyInterface["additionalRoles"];
      projectRoles?: ApiKeyInterface["projectRoles"];
      description?: string;
      actAs?: ApiKeyInterface["actAs"];
      // Omitted leaves it unchanged; `customValidation` enforces the edit rules.
      expiresAt?: Date | null;
      confirmRules?: ConfirmRule[] | null;
    },
  ): Promise<{ before: ApiKeyInterface; after: ApiKeyInterface }> {
    const doc = await this._findOne({ id }, { bypassSanitization: true });
    if (!doc) this.context.throwNotFoundError(`API key not found: ${id}`);

    // SDK keys (non secret) have no role, so they're rejected.
    if (!doc.secret) {
      this.context.throwBadRequestError(
        "Only secret API keys can have their permissions edited.",
      );
    }

    if (doc.userId) {
      // A PAT is only ever editable by its owner, like reveal and delete.
      if (doc.userId !== this.context.userId) {
        this.context.throwNotFoundError(`API key not found: ${id}`);
      }
      // Rewriting its role would orphan it from getVisualEditorApiKey.
      if (doc.role === "visualEditor" && !doc.scoped) {
        this.context.throwBadRequestError(
          "The visual editor's API key can't be edited.",
        );
      }
      // Mirrors creation: no scopedRole means the token inherits its user's permissions.
      const after = await this._updateOne(
        doc,
        {
          description,
          role: scopedRole || "user",
          scoped: scopedRole ? true : undefined,
          limitAccessByEnvironment: !!scopedRole && !!limitAccessByEnvironment,
          environments: scopedRole ? environments : [],
          additionalRoles: scopedRole ? additionalRoles : undefined,
          projectRoles: scopedRole ? projectRoles : undefined,
          ...(expiresAt !== undefined && { expiresAt }),
          ...(confirmRules !== undefined && { confirmRules }),
        },
        { forceCanUpdate: true },
      );
      return { before: doc, after };
    }

    if (!this.context.permissions.canUpdateApiKey()) {
      this.context.permissions.throwPermissionError();
    }
    // An edit that names no role leaves the role and scope as they are.
    const authority = {
      ...(role !== undefined && {
        role,
        limitAccessByEnvironment,
        environments,
        additionalRoles,
        projectRoles,
      }),
      ...(actAs !== undefined && { actAs }),
      ...(confirmRules !== undefined && { confirmRules }),
    };
    if (
      changesApiKeyAuthority(doc, { ...doc, ...authority }) &&
      !this.context.permissions.canCreateApiKey()
    ) {
      this.context.permissions.throwPermissionError(
        "Changing an API key's role, scope, requester settings, or confirmations requires permission to create API keys.",
      );
    }
    if (role !== undefined && !role) {
      this.context.throwBadRequestError("A role is required.");
    }

    // Permission fields (role/scope/description) are intentionally editable, as
    // is the expiry, while the token's value and identity fields
    // (key, secret, userId) stay immutable. `canUpdate` blocks these fields, so we
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
        ...authority,
        description,
        ...(expiresAt !== undefined && { expiresAt }),
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
    const collection = getCollection<ApiKeyInterface>(COLLECTION_NAME);
    const now = new Date();
    const { matchedCount } = await collection.updateOne(
      { key, organization },
      { $set: { lastUsed: now } },
    );
    // Otherwise it may be a rotated key's previous secret.
    if (!matchedCount) {
      await collection.updateOne(
        { previousKey: key, organization },
        { $set: { lastUsed: now, previousKeyLastUsed: now } },
      );
    }
  }

  // OAuth token endpoint has no ReqContext. These static helpers keep apikey
  // writes in the model layer (same pattern as dangerousRecordUsageByKey).

  /**
   * Keys the expiration sweep has work for: inside the expiring-soon window or
   * past it and not yet fully notified, plus keys carrying a notice whose expiry
   * has since moved back out, so the notice can be cleared and announce again.
   * Cross-organization because the sweep runs once for the whole instance.
   */
  public static async dangerousFindPendingExpirationNotices(
    horizon: Date,
  ): Promise<ApiKeyInterface[]> {
    return getCollection<ApiKeyInterface>(COLLECTION_NAME)
      .find({
        secret: true,
        // Org keys only: a PAT's owner is told in-app, not via org webhooks.
        userId: { $not: { $type: "string" } },
        oauthClientId: { $exists: false },
        $or: [
          {
            expiresAt: { $ne: null, $lte: horizon },
            expirationNotice: { $ne: "expired" },
          },
          {
            expirationNotice: { $ne: null },
            expiresAt: { $not: { $lte: horizon } },
          },
        ],
      })
      .toArray();
  }

  // Written by the sweep, which has no request context — same raw-$set pattern
  // as `dangerousRecordUsageByKey`. Written only after the event exists, so
  // every way this can go wrong leaves the notice unrecorded and re-announced.
  public static async dangerousRecordExpirationNotice(
    id: string,
    organization: string,
    notice: "expiring" | "expired",
  ): Promise<void> {
    await getCollection<ApiKeyInterface>(COLLECTION_NAME).updateOne(
      { id, organization },
      { $set: { expirationNotice: notice } },
    );
  }

  // Clears the record when an expiry is pushed back out, so the key can announce
  // itself again next time it approaches.
  public static async dangerousClearExpirationNotice(
    id: string,
    organization: string,
  ): Promise<void> {
    await getCollection<ApiKeyInterface>(COLLECTION_NAME).updateOne(
      { id, organization },
      { $set: { expirationNotice: null } },
    );
  }

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

  // A deleted project's roles are dead grants; drop them from every org key.
  public static async dangerousRemoveProjectRolesForProject(
    organization: string,
    projectId: string,
  ): Promise<void> {
    await getCollection<ApiKeyInterface>(COLLECTION_NAME).updateMany(
      { organization, "projectRoles.project": projectId },
      { $pull: { projectRoles: { project: projectId } } },
    );
  }

  // Skips an expired key so the caller mints a replacement. A disabled one is
  // still returned: an admin switched it off on purpose.
  public async getVisualEditorApiKey(
    userId: string,
  ): Promise<ApiKeyInterface | null> {
    return await this._findOne(
      {
        userId,
        role: "visualEditor",
        // A user's own scoped PAT may carry this role; only the auto-created key counts.
        scoped: { $ne: true },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      },
      {
        bypassSanitization: true,
      },
    );
  }

  // Reveals only the current secret, never a rotated-out one.
  public async getUnredactedSecretKey(
    id: string,
  ): Promise<SecretApiKey | null> {
    const doc = await this._findOne({ id }, { bypassSanitization: true });
    return doc ? (omit(doc, "previousKey") as SecretApiKey) : null;
  }

  // Issues a new secret under the same id, role and settings. With a grace
  // period, the replaced secret keeps working until it ends.
  public async rotateSecret(
    id: string,
    gracePeriodHours: number,
  ): Promise<{ before: ApiKeyInterface; after: ApiKeyInterface }> {
    const doc = await this.getRotatableKey(id);
    if (isExpired(doc.expiresAt)) {
      this.context.throwBadRequestError(
        "An expired key can't be rotated. Create a new key instead.",
      );
    }

    const now = new Date();
    const updates = {
      key: generateSigningKey(
        this.prefixForApiKey({
          environment: "",
          secret: true,
          userId: doc.userId,
          role: doc.role,
        }),
      ),
      keyIssuedAt: now,
      expiresAt: rotatedExpiration(
        doc.expiresAt,
        doc.keyIssuedAt ?? doc.dateCreated,
        this.maxLifetimeDaysFor(doc),
        now,
      ),
      // Kept even with no grace period, so auth can say the secret was rotated.
      previousKey: doc.key,
      previousKeyExpiresAt:
        previousKeyExpiration(doc.expiresAt, gracePeriodHours, now) ?? now,
      previousKeyLastUsed: null,
      dateUpdated: now,
    };

    // `key` is the primary key, so this can't go through `_updateOne`. Matching
    // the old secret makes concurrent rotations fail instead of both winning.
    const { matchedCount } = await getCollection<ApiKeyInterface>(
      COLLECTION_NAME,
    ).updateOne(
      { id, organization: this.context.org.id, key: doc.key },
      { $set: updates },
    );
    if (!matchedCount) {
      this.context.throwBadRequestError(
        "This key was changed while it was being rotated. Try again.",
      );
    }

    return { before: doc, after: { ...doc, ...updates } };
  }

  // Ends a rotation's grace period early, e.g. when the old secret leaked.
  public async revokePreviousKey(
    id: string,
  ): Promise<{ before: ApiKeyInterface; after: ApiKeyInterface }> {
    const doc = await this.getRotatableKey(id);
    if (!doc.previousKey || isExpired(doc.previousKeyExpiresAt)) {
      this.context.throwBadRequestError(
        "This key has no previous secret to revoke.",
      );
    }
    const now = new Date();
    // Expired rather than removed, so auth can still say the secret was rotated.
    const updates = { previousKeyExpiresAt: now, dateUpdated: now };
    // Matching the checked secret keeps a stale revoke off a newer rotation's.
    await getCollection<ApiKeyInterface>(COLLECTION_NAME).updateOne(
      { id, organization: this.context.org.id, previousKey: doc.previousKey },
      { $set: updates },
    );
    return { before: doc, after: { ...doc, ...updates } };
  }

  private async getRotatableKey(id: string): Promise<ApiKeyInterface> {
    const doc = await this._findOne({ id }, { bypassSanitization: true });
    if (!doc || !doc.secret || doc.oauthClientId) {
      this.context.throwNotFoundError(`API key not found: ${id}`);
    }
    if (
      !canManageApiKeySecret(this.context.permissions, doc, this.context.userId)
    ) {
      // Like delete, another member's PAT reads as missing.
      if (doc.userId) {
        this.context.throwNotFoundError(`API key not found: ${id}`);
      }
      this.context.permissions.throwPermissionError(
        "Rotating an API key requires permission to create API keys.",
      );
    }
    return doc;
  }

  // The member's own PATs worth a warning: lapsing soon, or lapsed but still in use.
  public async getExpiringPersonalAccessTokens(userId: string) {
    return this.findExpiring({
      userId,
      oauthClientId: { $exists: false },
      // The app mints and replaces its own Visual Editor key; the member never made it.
      $nor: [{ role: "visualEditor", scoped: { $ne: true } }],
    });
  }

  // The organization's own API keys worth a warning, for people who manage them.
  public async getExpiringOrgApiKeys() {
    return this.findExpiring({ userId: null, secret: true });
  }

  private async findExpiring(filter: Record<string, unknown>) {
    const now = new Date();
    const keys = await this._find({
      ...filter,
      disabled: { $ne: true },
      expiresAt: { $ne: null, $lte: addDays(now, EXPIRING_SOON_DAYS) },
    });
    return keys
      .filter(
        (k) =>
          !isExpired(k.expiresAt, now) ||
          (!!k.lastUsed && !!k.expiresAt && k.lastUsed > k.expiresAt),
      )
      .map(({ id, description, expiresAt, lastUsed }) => ({
        id,
        description,
        expiresAt,
        lastUsed,
      }));
  }

  // Every member's PAT, for the admin revocation list. OAuth access tokens are
  // excluded: they're short-lived and revoked by disconnecting the app instead.
  public async getAllPersonalAccessTokens(): Promise<ApiKeyInterface[]> {
    // `$ne: null` rather than `$exists`: org keys persist an explicit
    // `userId: null`, which `$exists: true` would match.
    return await this._find({
      userId: { $ne: null },
      oauthClientId: { $exists: false },
    });
  }

  public async dangerousGetAllApiKeysInOrg() {
    return await this._find({}, { bypassReadPermissionChecks: true });
  }

  // Deferred actions resolve their armer with no reading user, so a PAT needs this.
  public async dangerousGetById(id: string): Promise<ApiKeyInterface | null> {
    const [key] = await this._find(
      { id },
      { bypassReadPermissionChecks: true, limit: 1 },
    );
    return key ?? null;
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
    scoped,
    limitAccessByEnvironment,
    environments,
    additionalRoles,
    projectRoles,
    actAs,
    expiresAt,
    confirmRules,
  }: {
    environment: string;
    project: string;
    description: string;
    secret: boolean;
    encryptSDK: boolean;
    userId?: string;
    role?: string;
    scoped?: boolean;
    limitAccessByEnvironment?: boolean;
    environments?: string[];
    additionalRoles?: ApiKeyInterface["additionalRoles"];
    projectRoles?: ApiKeyInterface["projectRoles"];
    actAs?: ApiKeyInterface["actAs"];
    expiresAt?: Date | null;
    confirmRules?: ConfirmRule[] | null;
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
      ...(scoped ? { scoped } : {}),
      encryptionKey: encryptSDK ? await generateEncryptionKey() : undefined,
      limitAccessByEnvironment: limitAccessByEnvironment ?? false,
      environments: environments ?? [],
      additionalRoles,
      projectRoles,
      ...(actAs !== undefined && { actAs }),
      expiresAt,
      ...(confirmRules ? { confirmRules } : {}),
    });
  }
}
