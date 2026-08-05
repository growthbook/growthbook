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
    // Audit details default to the whole document, which would put
    // `encryptedKey` in the audit log — readable by anyone with audit access,
    // a wider audience than the API deliberately withholds it from. Allowlist
    // the non-secret fields instead, the same way DataSourceModel keeps
    // connection credentials out. What's left still answers who changed which
    // provider's key and when, and `last4` changing is the diff that shows a
    // rotation actually happened.
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
    // Read-then-write, so either branch can lose a race with another writer on
    // this same (organization, provider) row — and the key we were handed is
    // already verified, so losing a race should cost a retry, not the save:
    //
    // - create loses to the unique index when another admin got there first;
    //   the next pass finds their row and updates it instead.
    // - update loses its CAS guard when the row was replaced or deleted in
    //   between; the next pass re-reads and either updates or recreates.
    //
    // The guard is what makes this honest. An unguarded `_updateOne` whose filter
    // matches nothing still returns the merged document, so a delete landing
    // between the read and the write would report a saved key that isn't stored.
    //
    // Three attempts: each pass only loses if a *different* write landed in the
    // meantime, and the number of admins editing one provider's key at once is
    // small.
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
          // Ciphertext is salted, so this differs on every save — it doubles as
          // a version marker for the row we read.
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
