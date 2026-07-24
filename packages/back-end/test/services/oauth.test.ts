import crypto from "crypto";
import {
  hashToken,
  verifyPkceS256,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_PREFIX,
} from "back-end/src/util/oauth-token.util";
import {
  exchangeRefreshToken,
  OAuthError,
  revokeToken,
} from "back-end/src/services/oauth";
import { ApiKeyModel } from "back-end/src/models/ApiKeyModel";
import { getOAuthClientById } from "back-end/src/models/OAuthClientModel";
import { OAuthRefreshTokenModel } from "back-end/src/models/OAuthRefreshTokenModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";
import {
  getContextForAgendaJobByOrgObject,
  getContextForUserIdInOrg,
} from "back-end/src/services/organizations";

jest.mock("back-end/src/models/ApiKeyModel", () => ({
  ApiKeyModel: {
    dangerousFindByKeyHash: jest.fn(),
    dangerousDisableByKeyHash: jest.fn(),
    dangerousDisableOAuthGrant: jest.fn(),
  },
}));

jest.mock("back-end/src/models/OAuthAuthCodeModel", () => ({
  OAuthAuthCodeModel: {
    dangerousConsumeByHash: jest.fn(),
  },
}));

jest.mock("back-end/src/models/OAuthRefreshTokenModel", () => ({
  OAuthRefreshTokenModel: class {
    static dangerousFindByHash = jest.fn();
  },
}));

jest.mock("back-end/src/models/OAuthClientModel", () => ({
  createOAuthClient: jest.fn(),
  getOAuthClientById: jest.fn(),
  touchOAuthClient: jest.fn(),
}));

jest.mock("back-end/src/models/OrganizationModel", () => ({
  findOrganizationById: jest.fn(),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: jest.fn(),
  getContextForUserIdInOrg: jest.fn(),
}));

jest.mock("back-end/src/util/secrets", () => ({
  APP_ORIGIN: "http://localhost:3000",
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: 86400,
  OAUTH_ISSUER: "",
}));

const mockGetOAuthClientById = jest.mocked(getOAuthClientById);
const mockDangerousFindByHash = jest.mocked(
  OAuthRefreshTokenModel.dangerousFindByHash,
);
const mockFindOrganizationById = jest.mocked(findOrganizationById);
const mockGetContextForUserIdInOrg = jest.mocked(getContextForUserIdInOrg);
const mockGetContextForAgendaJobByOrgObject = jest.mocked(
  getContextForAgendaJobByOrgObject,
);
const mockDangerousFindByKeyHash = jest.mocked(
  ApiKeyModel.dangerousFindByKeyHash,
);
const mockDangerousDisableOAuthGrant = jest.mocked(
  ApiKeyModel.dangerousDisableOAuthGrant,
);
const mockDangerousDisableByKeyHash = jest.mocked(
  ApiKeyModel.dangerousDisableByKeyHash,
);

function mockOrgContext(
  overrides: {
    userId?: string;
    deleteForGrant?: jest.Mock;
    consumeByTokenHash?: jest.Mock;
    createRefresh?: jest.Mock;
    createApiKey?: jest.Mock;
    getGrant?: jest.Mock;
    ensureGrant?: jest.Mock;
    startGrant?: jest.Mock;
    markRevoked?: jest.Mock;
    getActiveForUser?: jest.Mock;
  } = {},
) {
  const activeGrant = {
    clientId: "client-a",
    userId: "user-1",
    revoked: false,
  };
  const deleteForGrant =
    overrides.deleteForGrant ?? jest.fn().mockResolvedValue(undefined);
  const consumeByTokenHash =
    overrides.consumeByTokenHash ??
    jest.fn().mockResolvedValue({ tokenHash: "old" });
  const createRefresh =
    overrides.createRefresh ?? jest.fn().mockResolvedValue({});
  const createApiKey =
    overrides.createApiKey ?? jest.fn().mockResolvedValue({});
  const getGrant =
    overrides.getGrant ?? jest.fn().mockResolvedValue(activeGrant);
  const ensureGrant =
    overrides.ensureGrant ?? jest.fn().mockResolvedValue(activeGrant);
  const startGrant =
    overrides.startGrant ?? jest.fn().mockResolvedValue(activeGrant);
  const markRevoked =
    overrides.markRevoked ?? jest.fn().mockResolvedValue(undefined);
  const getActiveForUser =
    overrides.getActiveForUser ?? jest.fn().mockResolvedValue([]);

  const context = {
    org: { id: "org-1" },
    userId: overrides.userId ?? "user-1",
    models: {
      oauthRefreshTokens: {
        deleteForGrant,
        consumeByTokenHash,
        create: createRefresh,
      },
      oauthGrants: {
        getGrant,
        ensureGrant,
        startGrant,
        markRevoked,
        getActiveForUser,
      },
      oauthAuthCodes: {
        create: jest.fn(),
      },
      apiKeys: {
        create: createApiKey,
      },
    },
  };

  mockFindOrganizationById.mockResolvedValue({ id: "org-1" } as never);
  mockGetContextForUserIdInOrg.mockResolvedValue(context as never);
  mockGetContextForAgendaJobByOrgObject.mockReturnValue(context as never);

  return {
    context,
    deleteForGrant,
    consumeByTokenHash,
    createRefresh,
    createApiKey,
    getGrant,
    ensureGrant,
    startGrant,
    markRevoked,
    getActiveForUser,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("oauth PKCE + token hashing", () => {
  it("verifies S256 code_challenge against code_verifier", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    // RFC 7636 appendix B example
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it("rejects a wrong verifier", () => {
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(verifyPkceS256("wrong-verifier-value-xxxxxxxxxx", challenge)).toBe(
      false,
    );
  });

  it("hashes tokens deterministically", () => {
    const token = OAUTH_ACCESS_TOKEN_PREFIX + "abc";
    const a = hashToken(token);
    const b = hashToken(token);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).toBe(
      crypto.createHash("sha256").update(token, "utf8").digest("hex"),
    );
  });

  it("produces different hashes for different tokens", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("revokeToken", () => {
  it("does not revoke an access token when client_id mismatches", async () => {
    mockDangerousFindByHash.mockResolvedValue(null);
    mockDangerousFindByKeyHash.mockResolvedValue({
      key: "hash",
      oauthClientId: "client-a",
      userId: "user-1",
      organization: "org-1",
    } as never);

    await revokeToken({
      token: OAUTH_ACCESS_TOKEN_PREFIX + "secret",
      clientId: "client-b",
    });

    expect(mockDangerousDisableByKeyHash).not.toHaveBeenCalled();
    expect(mockDangerousDisableOAuthGrant).not.toHaveBeenCalled();
  });

  it("disables access tokens and deletes refresh tokens for the grant", async () => {
    mockDangerousFindByHash.mockResolvedValue(null);
    mockDangerousFindByKeyHash.mockResolvedValue({
      key: "hash",
      oauthClientId: "client-a",
      userId: "user-1",
      organization: "org-1",
    } as never);
    const { deleteForGrant, markRevoked } = mockOrgContext();

    await revokeToken({
      token: OAUTH_ACCESS_TOKEN_PREFIX + "secret",
      clientId: "client-a",
    });

    expect(markRevoked).toHaveBeenCalledWith("client-a", "user-1");
    expect(deleteForGrant).toHaveBeenCalledWith("client-a", "user-1");
    expect(mockDangerousDisableOAuthGrant).toHaveBeenCalledWith(
      "client-a",
      "user-1",
      "org-1",
    );
  });

  it("cascades access-token disable when a refresh token is revoked", async () => {
    mockDangerousFindByHash.mockResolvedValue({
      tokenHash: "rhash",
      clientId: "client-a",
      userId: "user-1",
      organization: "org-1",
      expiresAt: new Date(Date.now() + 60_000),
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    const { deleteForGrant } = mockOrgContext();

    await revokeToken({
      token: OAUTH_REFRESH_TOKEN_PREFIX + "secret",
      clientId: "client-a",
    });

    expect(deleteForGrant).toHaveBeenCalledWith("client-a", "user-1");
    expect(mockDangerousDisableOAuthGrant).toHaveBeenCalledWith(
      "client-a",
      "user-1",
      "org-1",
    );
  });

  it("does not tear down a refresh-token grant when client_id is omitted", async () => {
    mockDangerousFindByHash.mockResolvedValue({
      tokenHash: "rhash",
      clientId: "client-a",
      userId: "user-1",
      organization: "org-1",
      expiresAt: new Date(Date.now() + 60_000),
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    const { deleteForGrant } = mockOrgContext();

    await revokeToken({ token: OAUTH_REFRESH_TOKEN_PREFIX + "secret" });

    expect(deleteForGrant).not.toHaveBeenCalled();
    expect(mockDangerousDisableOAuthGrant).not.toHaveBeenCalled();
  });

  it("does not tear down an access-token grant when client_id is omitted", async () => {
    mockDangerousFindByHash.mockResolvedValue(null);
    mockDangerousFindByKeyHash.mockResolvedValue({
      key: "hash",
      oauthClientId: "client-a",
      userId: "user-1",
      organization: "org-1",
    } as never);
    const { deleteForGrant } = mockOrgContext();

    await revokeToken({ token: OAUTH_ACCESS_TOKEN_PREFIX + "secret" });

    expect(deleteForGrant).not.toHaveBeenCalled();
    expect(mockDangerousDisableOAuthGrant).not.toHaveBeenCalled();
    expect(mockDangerousDisableByKeyHash).not.toHaveBeenCalled();
  });
});

describe("exchangeRefreshToken expiry", () => {
  it("reports expiry even when the organization no longer exists", async () => {
    mockGetOAuthClientById.mockResolvedValue({
      clientId: "client-a",
      redirectUris: ["http://localhost/cb"],
      tokenEndpointAuthMethod: "none",
      grantTypes: ["refresh_token"],
      responseTypes: ["code"],
      dateCreated: new Date(),
    });
    mockDangerousFindByHash.mockResolvedValue({
      tokenHash: "rhash",
      clientId: "client-a",
      userId: "user-1",
      organization: "org-gone",
      expiresAt: new Date(Date.now() - 60_000),
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    // Expiry must be checked before any org/context lookup
    mockFindOrganizationById.mockResolvedValue(null);

    await expect(
      exchangeRefreshToken({
        refreshToken: OAUTH_REFRESH_TOKEN_PREFIX + "secret",
        clientId: "client-a",
      }),
    ).rejects.toMatchObject({
      error: "invalid_grant",
      errorDescription: "Refresh token has expired",
    } satisfies Partial<OAuthError>);

    expect(mockFindOrganizationById).not.toHaveBeenCalled();
  });
});

describe("exchangeRefreshToken membership", () => {
  it("rejects refresh when the user is no longer in the org", async () => {
    mockGetOAuthClientById.mockResolvedValue({
      clientId: "client-a",
      redirectUris: ["http://localhost/cb"],
      tokenEndpointAuthMethod: "none",
      grantTypes: ["refresh_token"],
      responseTypes: ["code"],
      dateCreated: new Date(),
    });
    mockDangerousFindByHash.mockResolvedValue({
      tokenHash: "rhash",
      clientId: "client-a",
      userId: "user-1",
      organization: "org-1",
      expiresAt: new Date(Date.now() + 60_000),
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    const { deleteForGrant } = mockOrgContext();
    // Removed from the org: no member context, teardown uses agenda context
    mockGetContextForUserIdInOrg.mockResolvedValue(null);

    await expect(
      exchangeRefreshToken({
        refreshToken: OAUTH_REFRESH_TOKEN_PREFIX + "secret",
        clientId: "client-a",
      }),
    ).rejects.toMatchObject({
      error: "invalid_grant",
      errorDescription: "User is no longer a member of this organization",
    } satisfies Partial<OAuthError>);

    expect(deleteForGrant).toHaveBeenCalledWith("client-a", "user-1");
    expect(mockDangerousDisableOAuthGrant).toHaveBeenCalledWith(
      "client-a",
      "user-1",
      "org-1",
    );
  });

  it("rotates the token and issues the new pair through the member context", async () => {
    mockGetOAuthClientById.mockResolvedValue({
      clientId: "client-a",
      redirectUris: ["http://localhost/cb"],
      tokenEndpointAuthMethod: "none",
      grantTypes: ["refresh_token"],
      responseTypes: ["code"],
      dateCreated: new Date(),
    });
    mockDangerousFindByHash.mockResolvedValue({
      tokenHash: hashToken(OAUTH_REFRESH_TOKEN_PREFIX + "secret"),
      clientId: "client-a",
      userId: "user-1",
      organization: "org-1",
      scope: "openid offline_access",
      expiresAt: new Date(Date.now() + 60_000),
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    const { consumeByTokenHash, createRefresh, createApiKey } =
      mockOrgContext();

    const res = await exchangeRefreshToken({
      refreshToken: OAUTH_REFRESH_TOKEN_PREFIX + "secret",
      clientId: "client-a",
    });

    // Rotated via consume (not delete) so replay is detectable as reuse.
    expect(consumeByTokenHash).toHaveBeenCalledWith(
      hashToken(OAUTH_REFRESH_TOKEN_PREFIX + "secret"),
    );

    expect(createApiKey).toHaveBeenCalledTimes(1);
    expect(createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        key: hashToken(res.access_token),
        userId: "user-1",
        oauthClientId: "client-a",
        secret: true,
        role: "user",
        scopes: ["openid", "offline_access"],
      }),
    );

    expect(createRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: hashToken(res.refresh_token),
        clientId: "client-a",
        userId: "user-1",
        scope: "openid offline_access",
      }),
    );

    expect(res.token_type).toBe("Bearer");
    expect(res.scope).toBe("openid offline_access");
    expect(res.access_token).toMatch(
      new RegExp(`^${OAUTH_ACCESS_TOKEN_PREFIX}`),
    );
    expect(res.refresh_token).toMatch(
      new RegExp(`^${OAUTH_REFRESH_TOKEN_PREFIX}`),
    );
  });
});

describe("exchangeRefreshToken reuse detection + revoke race", () => {
  function mockValidClientAndToken() {
    mockGetOAuthClientById.mockResolvedValue({
      clientId: "client-a",
      redirectUris: ["http://localhost/cb"],
      tokenEndpointAuthMethod: "none",
      grantTypes: ["refresh_token"],
      responseTypes: ["code"],
      dateCreated: new Date(),
    });
    mockDangerousFindByHash.mockResolvedValue({
      tokenHash: hashToken(OAUTH_REFRESH_TOKEN_PREFIX + "secret"),
      clientId: "client-a",
      userId: "user-1",
      organization: "org-1",
      scope: "openid offline_access",
      expiresAt: new Date(Date.now() + 60_000),
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  }

  function refresh() {
    return exchangeRefreshToken({
      refreshToken: OAUTH_REFRESH_TOKEN_PREFIX + "secret",
      clientId: "client-a",
    });
  }

  it("tears down the whole grant when a consumed token is replayed", async () => {
    mockValidClientAndToken();
    const { deleteForGrant, markRevoked, createRefresh, createApiKey } =
      mockOrgContext({
        consumeByTokenHash: jest.fn().mockResolvedValue(null),
      });

    await expect(refresh()).rejects.toMatchObject({
      error: "invalid_grant",
      errorDescription: "Refresh token has already been used",
    } satisfies Partial<OAuthError>);

    expect(markRevoked).toHaveBeenCalledWith("client-a", "user-1");
    expect(deleteForGrant).toHaveBeenCalledWith("client-a", "user-1");
    expect(mockDangerousDisableOAuthGrant).toHaveBeenCalledWith(
      "client-a",
      "user-1",
      "org-1",
    );
    expect(createRefresh).not.toHaveBeenCalled();
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it("refuses to refresh a revoked grant", async () => {
    mockValidClientAndToken();
    const { consumeByTokenHash, createApiKey } = mockOrgContext({
      ensureGrant: jest
        .fn()
        .mockResolvedValue({ clientId: "client-a", revoked: true }),
    });

    await expect(refresh()).rejects.toMatchObject({
      error: "invalid_grant",
      errorDescription: "Grant has been revoked",
    } satisfies Partial<OAuthError>);

    expect(consumeByTokenHash).not.toHaveBeenCalled();
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it("self-heals when a revoke races an in-flight refresh", async () => {
    mockValidClientAndToken();
    // Active at start; concurrent revoke flips it before the post-write re-read.
    const { deleteForGrant, markRevoked, createRefresh, createApiKey } =
      mockOrgContext({
        ensureGrant: jest
          .fn()
          .mockResolvedValue({ clientId: "client-a", revoked: false }),
        getGrant: jest
          .fn()
          .mockResolvedValue({ clientId: "client-a", revoked: true }),
      });

    await expect(refresh()).rejects.toMatchObject({
      error: "invalid_grant",
      errorDescription: "Grant has been revoked",
    } satisfies Partial<OAuthError>);

    expect(createApiKey).toHaveBeenCalledTimes(1);
    expect(createRefresh).toHaveBeenCalledTimes(1);
    expect(markRevoked).toHaveBeenCalledWith("client-a", "user-1");
    expect(deleteForGrant).toHaveBeenCalledWith("client-a", "user-1");
  });
});
