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
import {
  deleteRefreshToken,
  deleteRefreshTokensForGrant,
  findRefreshToken,
  getOAuthClientById,
} from "back-end/src/models/OAuthModels";
import { findOrganizationsByMemberId } from "back-end/src/models/OrganizationModel";
import { getCollection } from "back-end/src/util/mongo.util";

jest.mock("back-end/src/models/ApiKeyModel", () => ({
  COLLECTION_NAME: "apikeys",
}));

jest.mock("back-end/src/models/OAuthModels", () => ({
  consumeAuthCode: jest.fn(),
  createOAuthClient: jest.fn(),
  deleteRefreshToken: jest.fn(),
  deleteRefreshTokensForGrant: jest.fn(),
  findRefreshToken: jest.fn(),
  getOAuthClientById: jest.fn(),
  insertAuthCode: jest.fn(),
  insertRefreshToken: jest.fn(),
}));

jest.mock("back-end/src/models/OrganizationModel", () => ({
  findOrganizationsByMemberId: jest.fn(),
}));

jest.mock("back-end/src/util/mongo.util", () => ({
  getCollection: jest.fn(),
}));

jest.mock("back-end/src/util/secrets", () => ({
  APP_ORIGIN: "http://localhost:3000",
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: 86400,
  OAUTH_ISSUER: "",
}));

const mockGetOAuthClientById = jest.mocked(getOAuthClientById);
const mockFindRefreshToken = jest.mocked(findRefreshToken);
const mockDeleteRefreshToken = jest.mocked(deleteRefreshToken);
const mockDeleteRefreshTokensForGrant = jest.mocked(
  deleteRefreshTokensForGrant,
);
const mockFindOrganizationsByMemberId = jest.mocked(
  findOrganizationsByMemberId,
);
const mockGetCollection = jest.mocked(getCollection);

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
    const findOne = jest.fn().mockResolvedValue({
      key: "hash",
      oauthClientId: "client-a",
      userId: "user-1",
      organization: "org-1",
    });
    const updateOne = jest.fn();
    const updateMany = jest.fn();
    mockGetCollection.mockReturnValue({
      findOne,
      updateOne,
      updateMany,
    } as never);

    await revokeToken({
      token: OAUTH_ACCESS_TOKEN_PREFIX + "secret",
      clientId: "client-b",
    });

    expect(updateOne).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(mockDeleteRefreshTokensForGrant).not.toHaveBeenCalled();
  });

  it("disables access tokens and deletes refresh tokens for the grant", async () => {
    const findOne = jest.fn().mockResolvedValue({
      key: "hash",
      oauthClientId: "client-a",
      userId: "user-1",
      organization: "org-1",
    });
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    mockGetCollection.mockReturnValue({
      findOne,
      updateOne: jest.fn(),
      updateMany,
    } as never);

    await revokeToken({
      token: OAUTH_ACCESS_TOKEN_PREFIX + "secret",
      clientId: "client-a",
    });

    expect(mockDeleteRefreshTokensForGrant).toHaveBeenCalledWith(
      "client-a",
      "user-1",
      "org-1",
    );
    expect(updateMany).toHaveBeenCalledWith(
      {
        oauthClientId: "client-a",
        userId: "user-1",
        organization: "org-1",
        disabled: { $ne: true },
      },
      { $set: { disabled: true } },
    );
  });

  it("cascades access-token disable when a refresh token is revoked", async () => {
    mockFindRefreshToken.mockResolvedValue({
      tokenHash: "rhash",
      clientId: "client-a",
      userId: "user-1",
      organization: "org-1",
      expiresAt: new Date(Date.now() + 60_000),
      dateCreated: new Date(),
    });
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    mockGetCollection.mockReturnValue({ updateMany } as never);

    await revokeToken({
      token: OAUTH_REFRESH_TOKEN_PREFIX + "secret",
      clientId: "client-a",
    });

    expect(mockDeleteRefreshTokensForGrant).toHaveBeenCalledWith(
      "client-a",
      "user-1",
      "org-1",
    );
    expect(updateMany).toHaveBeenCalled();
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
    mockFindRefreshToken.mockResolvedValue({
      tokenHash: "rhash",
      clientId: "client-a",
      userId: "user-1",
      organization: "org-1",
      expiresAt: new Date(Date.now() + 60_000),
      dateCreated: new Date(),
    });
    mockFindOrganizationsByMemberId.mockResolvedValue([]);
    mockGetCollection.mockReturnValue({
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as never);

    await expect(
      exchangeRefreshToken({
        refreshToken: OAUTH_REFRESH_TOKEN_PREFIX + "secret",
        clientId: "client-a",
      }),
    ).rejects.toMatchObject({
      error: "invalid_grant",
      errorDescription: "User is no longer a member of this organization",
    } satisfies Partial<OAuthError>);

    expect(mockDeleteRefreshTokensForGrant).toHaveBeenCalledWith(
      "client-a",
      "user-1",
      "org-1",
    );
    expect(mockDeleteRefreshToken).not.toHaveBeenCalled();
  });
});
