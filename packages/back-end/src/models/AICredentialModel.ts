import {
  AICredentialFrontEndInterface,
  AICredentialInterface,
  aiCredentialSchema,
} from "shared/validators";
import { AIProvider } from "shared/ai";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: aiCredentialSchema,
  collectionName: "aicredentials",
  // (organization, provider) — BaseModel builds a unique index from the primary
  // key, so an org physically cannot end up with two keys for one provider.
  pKey: ["organization", "provider"] as const,
  // No idPrefix: composite-key models don't auto-generate an id.
  readonlyFields: [],
  auditLog: {
    entity: "aiCredential",
    createEvent: "aiCredential.create",
    updateEvent: "aiCredential.update",
    deleteEvent: "aiCredential.delete",
  },
});

export class AICredentialModel extends BaseClass {
  // Reading a credential row yields ciphertext plus the masked last4, never a
  // usable key, so any member of the org may read it — the AI services need to
  // resolve keys on behalf of whoever triggered the request, including API-key
  // and background-job contexts that have no org-admin role. Writes are
  // org-admin only.
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
    const existing = await this.getByProvider(provider);
    if (existing) {
      return this._updateOne(existing, fields);
    }
    try {
      return await this._createOne({ provider, ...fields });
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e;
      // Two admins saved this provider's first key at the same time: both saw no
      // row, and the composite unique index rejected the loser. The loser's key
      // is just as valid and was already verified against the provider, so apply
      // it as an update to the row that won rather than failing their save.
      const raced = await this.getByProvider(provider);
      if (!raced) throw e;
      return this._updateOne(raced, fields);
    }
  }

  public async deleteForProvider(provider: AIProvider): Promise<boolean> {
    const existing = await this.getByProvider(provider);
    if (!existing) return false;
    await this._deleteOne(existing);
    return true;
  }

  public async getAllForFrontEnd(): Promise<AICredentialFrontEndInterface[]> {
    const docs = await this.getAll();
    // Drop the ciphertext by construction rather than with `omit`, so a future
    // secret-bearing field can't be added to the schema and silently ride along
    // into an API response.
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
