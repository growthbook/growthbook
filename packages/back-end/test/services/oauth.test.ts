import crypto from "crypto";
import {
  hashToken,
  verifyPkceS256,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_PREFIX,
} from "back-end/src/util/oauth-token.util";
import {
  exchangeRefreshToken,
  listOrgGrants,
  mintAuthorizationCode,
  OAuthError,
  revokeMemberGrant,
  revokeToken,
} from "back-end/src/services/oauth";
import { getUsersByIds } from "back-end/src/models/UserModel";
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

jest.mock("back-end/src/models/UserModel", () => ({
  getUsersByIds: jest.fn(),
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
    getActiveForOrg?: jest.Mock;
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
  const getActiveForOrg =
    overrides.getActiveForOrg ?? jest.fn().mockResolvedValue([]);

  const context = {
    org: { id: "org-1" },
    userId: overrides.userId ?? "user-1",
    throwNotFoundError: jest.fn(() => {
      throw new Error("not found");
    }),
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
        getActiveForOrg,
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

describe("org OAuth apps: client authentication, org binding, access policy", () => {
  const APP_ID = "gbapp_0123456789abcdef";
  const APP_SECRET = "gbcs_correct-secret";

  function mockOrgApp(organization = "org-1") {
    mockGetOAuthClientById.mockResolvedValue({
      clientId: APP_ID,
      redirectUris: ["https://mcp.example.com/cb"],
      tokenEndpointAuthMethod: "client_secret_basic",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      organization,
      clientSecretHash: hashToken(APP_SECRET),
      dateCreated: new Date(),
    });
  }

  function mockDcrClient() {
    mockGetOAuthClientById.mockResolvedValue({
      clientId: "gbc_dcr",
      redirectUris: ["http://localhost/cb"],
      tokenEndpointAuthMethod: "none",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      dateCreated: new Date(),
    });
  }

  function mockRefreshToken(clientId: string) {
    mockDangerousFindByHash.mockResolvedValue({
      tokenHash: hashToken(OAUTH_REFRESH_TOKEN_PREFIX + "secret"),
      clientId,
      userId: "user-1",
      organization: "org-1",
      expiresAt: new Date(Date.now() + 60_000),
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  }

  function mockOrgSettings(settings: Record<string, unknown>) {
    mockFindOrganizationById.mockResolvedValue({
      id: "org-1",
      settings,
    } as never);
  }

  function refresh(clientId: string, clientSecret?: string) {
    return exchangeRefreshToken({
      refreshToken: OAUTH_REFRESH_TOKEN_PREFIX + "secret",
      clientId,
      clientSecret,
    });
  }

  it.each([
    ["a missing", undefined],
    ["a wrong", "gbcs_wrong-secret"],
  ])(
    "rejects %s client secret for a confidential client",
    async (_, secret) => {
      mockOrgApp();
      mockRefreshToken(APP_ID);
      const { consumeByTokenHash } = mockOrgContext();

      await expect(refresh(APP_ID, secret)).rejects.toMatchObject({
        error: "invalid_client",
        status: 401,
      } satisfies Partial<OAuthError>);
      expect(consumeByTokenHash).not.toHaveBeenCalled();
    },
  );

  it("issues tokens to an org app presenting its secret while PATs are disabled", async () => {
    mockOrgApp();
    mockRefreshToken(APP_ID);
    const { createApiKey } = mockOrgContext();
    mockOrgSettings({
      disablePersonalAccessTokens: true,
      oauthAccess: "org-apps",
    });

    await refresh(APP_ID, APP_SECRET);

    expect(createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ oauthClientId: APP_ID }),
    );
  });

  it("refuses an org app registered to a different organization", async () => {
    mockOrgApp("org-other");
    mockRefreshToken(APP_ID);
    const { createApiKey, markRevoked } = mockOrgContext();

    await expect(refresh(APP_ID, APP_SECRET)).rejects.toMatchObject({
      error: "invalid_grant",
      errorDescription:
        "This application is registered to a different organization",
    } satisfies Partial<OAuthError>);
    expect(createApiKey).not.toHaveBeenCalled();
    expect(markRevoked).not.toHaveBeenCalled();
  });

  it.each([
    ["org-apps policy", { oauthAccess: "org-apps" }],
    ["none policy", { oauthAccess: "none" }],
    ["legacy PAT kill switch", { disablePersonalAccessTokens: true }],
  ])(
    "refuses a DCR client under the %s without tearing down its grant",
    async (_, settings) => {
      mockDcrClient();
      mockRefreshToken("gbc_dcr");
      const { createApiKey, markRevoked } = mockOrgContext();
      mockOrgSettings(settings);

      await expect(refresh("gbc_dcr")).rejects.toMatchObject({
        error: "invalid_grant",
        errorDescription:
          "This organization does not allow this application to access GrowthBook",
      } satisfies Partial<OAuthError>);
      expect(createApiKey).not.toHaveBeenCalled();
      expect(markRevoked).not.toHaveBeenCalled();
    },
  );

  it("refuses to mint an authorization code for a disallowed client", async () => {
    mockDcrClient();
    const { context } = mockOrgContext();
    mockOrgSettings({ oauthAccess: "org-apps" });

    await expect(
      mintAuthorizationCode({
        clientId: "gbc_dcr",
        redirectUri: "http://localhost/cb",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        userId: "user-1",
        organization: "org-1",
      }),
    ).rejects.toMatchObject({ error: "access_denied" });
    expect(context.models.oauthAuthCodes.create).not.toHaveBeenCalled();
  });

  it("does not revoke a confidential client's token without its secret", async () => {
    mockOrgApp();
    mockRefreshToken(APP_ID);
    const { deleteForGrant } = mockOrgContext();

    await expect(
      revokeToken({
        token: OAUTH_REFRESH_TOKEN_PREFIX + "secret",
        clientId: APP_ID,
        clientSecret: "gbcs_wrong-secret",
      }),
    ).rejects.toMatchObject({ error: "invalid_client" });
    expect(deleteForGrant).not.toHaveBeenCalled();
  });
});

describe("admin view of member grants", () => {
  const mockGetUsersByIds = jest.mocked(getUsersByIds);

  it("lists the org's grants with client and member details, newest activity first", async () => {
    const { context } = mockOrgContext({
      getActiveForOrg: jest.fn().mockResolvedValue([
        {
          clientId: "gbc_gone",
          userId: "user-2",
          dateCreated: new Date("2026-01-01"),
          dateUpdated: new Date("2026-01-02"),
        },
        {
          clientId: "gbapp_internal",
          userId: "user-1",
          dateCreated: new Date("2026-02-01"),
          dateUpdated: new Date("2026-03-01"),
        },
      ]),
    });
    mockGetOAuthClientById.mockImplementation(async (id) =>
      id === "gbapp_internal"
        ? ({ clientId: id, clientName: "Internal MCP" } as never)
        : null,
    );
    mockGetUsersByIds.mockResolvedValue([
      { id: "user-1", name: "Ada", email: "ada@example.com" },
      { id: "user-2", name: "", email: "bob@example.com" },
    ] as never);

    const grants = await listOrgGrants(context as never);

    expect(grants.map((g) => [g.clientName, g.isOrgApp, g.userEmail])).toEqual([
      ["Internal MCP", true, "ada@example.com"],
      // A deleted DCR client still lists under its ID
      ["gbc_gone", false, "bob@example.com"],
    ]);
  });

  it("revokes only the named member's grant", async () => {
    const { context, markRevoked, deleteForGrant } = mockOrgContext({
      getGrant: jest
        .fn()
        .mockResolvedValue({ clientId: "client-a", userId: "user-2" }),
    });

    await revokeMemberGrant(context as never, "client-a", "user-2");

    expect(markRevoked).toHaveBeenCalledTimes(1);
    expect(markRevoked).toHaveBeenCalledWith("client-a", "user-2");
    expect(deleteForGrant).toHaveBeenCalledWith("client-a", "user-2");
    expect(mockDangerousDisableOAuthGrant).toHaveBeenCalledWith(
      "client-a",
      "user-2",
      "org-1",
    );
  });

  it.each([
    ["a missing", null],
    ["an already-revoked", { clientId: "client-a", revoked: true }],
  ])("refuses to revoke %s grant", async (_, grant) => {
    const { context, markRevoked } = mockOrgContext({
      getGrant: jest.fn().mockResolvedValue(grant),
    });

    await expect(
      revokeMemberGrant(context as never, "client-a", "user-2"),
    ).rejects.toThrow("not found");
    expect(markRevoked).not.toHaveBeenCalled();
  });
});
