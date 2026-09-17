import { OAuthGrantInterface, oauthGrantValidator } from "shared/validators";
import { OAUTH_REFRESH_TOKEN_TTL_SECONDS } from "back-end/src/util/secrets";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "oauthgrants";

// Grant only needs to outlive the longest refresh token that could point at
// it (expired tokens are rejected before the grant is read). Margin covers
// clock skew, Mongo's ~60s TTL sweep, and the grant→token write gap.
const GRANT_TTL_MARGIN_SECONDS = 24 * 60 * 60; // 1 day

function grantExpiry(now: Date = new Date()): Date {
  return new Date(
    now.getTime() +
      (OAUTH_REFRESH_TOKEN_TTL_SECONDS + GRANT_TTL_MARGIN_SECONDS) * 1000,
  );
}

const BaseClass = MakeModelClass({
  schema: oauthGrantValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "oag_",
  auditLog: {
    entity: "oauthGrant",
    createEvent: "oauthGrant.create",
    updateEvent: "oauthGrant.update",
    deleteEvent: "oauthGrant.delete",
  },
  defaultValues: {
    revoked: false,
  },
  additionalIndexes: [
    // Unique so concurrent authorizations can't fork a grant into two targets.
    { fields: { organization: 1, clientId: 1, userId: 1 }, unique: true },
    { fields: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
});

/**
 * Durable OAuth grants — the revocation target that outlives rotating tokens.
 * Org-scoped via ReqContext; no cross-org `dangerous*` path. See
 * {@link oauthGrantValidator} for why this exists and how TTL bounds growth.
 */
export class OAuthGrantModel extends BaseClass {
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

  public async getGrant(
    clientId: string,
    userId: string,
  ): Promise<OAuthGrantInterface | null> {
    return this._findOne({ clientId, userId });
  }

  /** Active (non-revoked) grants for a user — the "Connected Apps" list. */
  public async getActiveForUser(
    userId: string,
  ): Promise<OAuthGrantInterface[]> {
    return this._find(
      { userId, revoked: { $ne: true } },
      { bypassReadPermissionChecks: true },
    );
  }

  /**
   * Read-then-create against the unique index. On a concurrent-create race,
   * adopt the winner's doc instead of surfacing a 500.
   */
  private async getOrCreateGrant(props: {
    clientId: string;
    userId: string;
    scope?: string;
    resource?: string;
    revoked: boolean;
    expiresAt: Date;
  }): Promise<{ grant: OAuthGrantInterface; created: boolean }> {
    const existing = await this.getGrant(props.clientId, props.userId);
    if (existing) return { grant: existing, created: false };
    try {
      return { grant: await this.create(props), created: true };
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e;
      const winner = await this.getGrant(props.clientId, props.userId);
      if (winner) return { grant: winner, created: false };
      throw e;
    }
  }

  /** Consent: create, or clear `revoked` and refresh scope on re-consent. */
  public async startGrant(params: {
    clientId: string;
    userId: string;
    scope?: string;
    resource?: string;
  }): Promise<OAuthGrantInterface> {
    const { grant, created } = await this.getOrCreateGrant({
      clientId: params.clientId,
      userId: params.userId,
      scope: params.scope,
      resource: params.resource,
      revoked: false,
      expiresAt: grantExpiry(),
    });
    if (created) return grant;
    return this.update(grant, {
      revoked: false,
      scope: params.scope,
      resource: params.resource,
      expiresAt: grantExpiry(),
    });
  }

  /**
   * Refresh flow: bump TTL on active grants, but never clear a concurrent
   * `revoked` (caller tears down). Creates a grant if missing (pre-grant tokens).
   * Revoked grants are returned as-is — their TTL must not be extended.
   */
  public async ensureGrant(params: {
    clientId: string;
    userId: string;
    scope?: string;
    resource?: string;
  }): Promise<OAuthGrantInterface> {
    const { grant, created } = await this.getOrCreateGrant({
      clientId: params.clientId,
      userId: params.userId,
      scope: params.scope,
      resource: params.resource,
      revoked: false,
      expiresAt: grantExpiry(),
    });
    if (created || grant.revoked) return grant;
    return this.update(grant, { expiresAt: grantExpiry() });
  }

  /**
   * Mark revoked. Upserts a tombstone when missing so an in-flight refresh's
   * post-write re-check still sees `revoked`.
   */
  public async markRevoked(clientId: string, userId: string): Promise<void> {
    const { grant, created } = await this.getOrCreateGrant({
      clientId,
      userId,
      revoked: true,
      expiresAt: grantExpiry(),
    });
    if (created || grant.revoked) return;
    await this.update(grant, { revoked: true, expiresAt: grantExpiry() });
  }
}
