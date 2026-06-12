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
  // A Figma connection belongs to a single user. The endpoints always
  // scope reads/writes to context.userId, and the tokens are encrypted at
  // rest, so blanket-allow here (mirrors WatchModel's per-user records).
  protected canCreate(): boolean {
    return true;
  }
  protected canRead(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return true;
  }
  protected canDelete(): boolean {
    return true;
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
