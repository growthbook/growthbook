import {
  AICredentialFrontEndInterface,
  AICredentialInterface,
  aiCredentialSchema,
} from "shared/validators";
import { AIProvider } from "shared/ai";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import { CasConflictError, MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: aiCredentialSchema,
  collectionName: "aicredentials",
  // BaseModel builds a unique index from this, so an org can't hold two keys
  // for one provider.
  pKey: ["organization", "provider"] as const,
  // No idPrefix: composite-key models don't auto-generate an id.
  readonlyFields: [],
  auditLog: {
    entity: "aiCredential",
    createEvent: "aiCredential.create",
    updateEvent: "aiCredential.update",
    deleteEvent: "aiCredential.delete",
    // Details default to the whole document, which would put `encryptedKey` in
    // the audit log — a wider audience than the API withholds it from. Allowlist
    // the non-secret fields, as DataSourceModel does for connection params.
    detailsAllowlist: [
      "organization",
      "provider",
      "last4",
      "updatedByEmail",
      "dateCreated",
      "dateUpdated",
    ],
  },
});

export class AICredentialModel extends BaseClass {
  // Reads yield ciphertext and last4, never a usable key, and the AI services
  // resolve keys for whoever triggered the request — including API-key and job
  // contexts with no admin role. Writes are org-admin only.
  protected canRead(): boolean {
    return true;
  }
  protected canCreate(): boolean {
    return this.context.permissions.canManageOrgSettings();
  }
  protected canUpdate(): boolean {
    return this.context.permissions.canManageOrgSettings();
  }
  protected canDelete(): boolean {
    return this.context.permissions.canManageOrgSettings();
  }

  // BaseModel applies this to create/update but not delete, which is what we
  // want: a downgraded org can still clear a key the resolver is ignoring.
  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("ai-byok");
  }

  public getByProvider(
    provider: AIProvider,
  ): Promise<AICredentialInterface | null> {
    // `organization` is applied automatically by BaseModel.
    return this._findOne({ provider });
  }

  public async upsertForProvider(
    provider: AIProvider,
    fields: {
      encryptedKey: string;
      last4: string;
      updatedByEmail: string;
    },
  ): Promise<AICredentialInterface> {
    // _createOne/_updateOne below skip the wrappers that would apply this.
    if (!this.hasPremiumFeature()) {
      throw new Error(
        "Your organization does not have access to this feature.",
      );
    }

    // Read-then-write, so either branch can lose a race — create to the unique
    // index, update to its CAS guard — and the key is already verified, so a
    // loss should cost a retry, not the save. The guard is what makes this
    // honest: an unguarded _updateOne matching nothing still returns the merged
    // document, so a concurrent delete would report a key that isn't stored.
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await this.getByProvider(provider);

      if (!existing) {
        try {
          return await this._createOne({ provider, ...fields });
        } catch (e) {
          if (!isDuplicateKeyError(e)) throw e;
          continue;
        }
      }

      try {
        return await this._updateOne(existing, fields, {
          // Salted, so this differs on every save — a version marker for the
          // row we read.
          guard: { encryptedKey: existing.encryptedKey },
        });
      } catch (e) {
        if (!(e instanceof CasConflictError)) throw e;
      }
    }

    throw new Error(
      "Could not save the API key because it is being changed at the same time somewhere else. Try again.",
    );
  }

  public async deleteForProvider(provider: AIProvider): Promise<boolean> {
    const existing = await this.getByProvider(provider);
    if (!existing) return false;
    await this._deleteOne(existing);
    return true;
  }

  public async getAllForFrontEnd(): Promise<AICredentialFrontEndInterface[]> {
    const docs = await this.getAll();
    // Built by construction rather than `omit`, so a future secret-bearing
    // field can't silently ride along into an API response.
    return docs.map(
      ({
        organization,
        provider,
        last4,
        updatedByEmail,
        dateCreated,
        dateUpdated,
      }) => ({
        organization,
        provider,
        last4,
        updatedByEmail,
        dateCreated,
        dateUpdated,
      }),
    );
  }
}
