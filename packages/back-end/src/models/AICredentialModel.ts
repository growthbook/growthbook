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
  pKey: ["organization", "provider"] as const,
  readonlyFields: [],
  auditLog: {
    entity: "aiCredential",
    createEvent: "aiCredential.create",
    updateEvent: "aiCredential.update",
    deleteEvent: "aiCredential.delete",
    // Never include encryptedKey in audit logs.
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

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("ai-byok");
  }

  public getByProvider(
    provider: AIProvider,
  ): Promise<AICredentialInterface | null> {
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
    if (!this.hasPremiumFeature()) {
      throw new Error(
        "Your organization does not have access to this feature.",
      );
    }

    // Retry create/update races against the unique key and CAS guard.
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
