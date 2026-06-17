import {
  FigmaConnectionInterface,
  figmaConnectionSchema,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: figmaConnectionSchema,
  pKey: ["userId", "organization"] as const,
  collectionName: "figmaconnections",
  readonlyFields: [],
});

// Stored token values are AES-encrypted ciphertext (handled in
// services/figma.ts) — the model never sees or returns raw tokens.
type FigmaTokenFields = Pick<
  FigmaConnectionInterface,
  "accessToken" | "refreshToken" | "expiresAt"
>;

export class FigmaConnectionModel extends BaseClass {
  // A Figma connection is private to the user who created it: records are
  // keyed by (userId, organization) and the tokens are encrypted at rest.
  // Every gate requires an authenticated end-user context whose id matches
  // the record's userId — so one user can never read or mutate another
  // user's connection, and org-level API keys (which have no userId) are
  // locked out entirely. BaseModel applies these on every read/write, so
  // even a mis-scoped query can't leak a record across users.
  private ownedByCurrentUser(doc: FigmaConnectionInterface): boolean {
    return !!this.context.userId && doc.userId === this.context.userId;
  }
  protected canCreate(doc: FigmaConnectionInterface): boolean {
    return this.ownedByCurrentUser(doc);
  }
  protected canRead(doc: FigmaConnectionInterface): boolean {
    return this.ownedByCurrentUser(doc);
  }
  protected canUpdate(existing: FigmaConnectionInterface): boolean {
    return this.ownedByCurrentUser(existing);
  }
  protected canDelete(existing: FigmaConnectionInterface): boolean {
    return this.ownedByCurrentUser(existing);
  }

  public getByUserId(userId: string): Promise<FigmaConnectionInterface | null> {
    // organization is auto-applied by BaseModel, so this resolves to the
    // current org's connection for this user.
    return this._findOne({ userId });
  }

  public async upsertForUser(
    userId: string,
    tokens: FigmaTokenFields,
  ): Promise<FigmaConnectionInterface> {
    const existing = await this.getByUserId(userId);
    if (existing) {
      return this._updateOne(existing, tokens);
    }
    return this._createOne({ userId, ...tokens });
  }

  public async deleteForUser(userId: string): Promise<void> {
    const existing = await this.getByUserId(userId);
    if (existing) {
      await this._deleteOne(existing);
    }
  }
}
