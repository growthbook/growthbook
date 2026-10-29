import { ApiKeyInterface } from "shared/types/apikey";
import {
  loadApiKeys,
  toApiKey,
  toApiKeys,
} from "back-end/src/services/apiKeyResponse";
import { getUsersByIds } from "back-end/src/models/UserModel";
import { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/UserModel", () => ({
  getUsersByIds: jest.fn(),
}));

const base: ApiKeyInterface = {
  id: "key_1",
  key: "secret_admin_abc123",
  organization: "org_1",
  dateCreated: new Date("2026-01-01T00:00:00Z"),
  dateUpdated: new Date("2026-01-02T00:00:00Z"),
  secret: true,
  description: "Sync",
  role: "engineer",
  limitAccessByEnvironment: true,
  environments: ["production"],
  encryptionKey: "enc_xyz",
  previousKey: "secret_admin_old456",
  previousKeyExpiresAt: new Date("2026-02-01T00:00:00Z"),
  lastUsed: null,
};

const pat: ApiKeyInterface = {
  ...base,
  id: "key_pat",
  key: "secret_user_pat789",
  userId: "u_1",
  role: "user",
  limitAccessByEnvironment: false,
  environments: [],
};

describe("toApiKey", () => {
  it("never includes the key's value, previous value or encryption key", () => {
    // Dry runs build the response from a doc read without sanitization.
    const json = JSON.stringify(toApiKeys([base, pat], new Set(), new Map()));
    for (const secret of [
      "abc123",
      "old456",
      "pat789",
      "enc_xyz",
      '"key"',
      "encryptionKey",
      "previousKey",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("maps an org key", () => {
    expect(
      toApiKey({
        ...base,
        additionalRoles: [
          {
            role: "analyst",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
        projectRoles: [
          {
            project: "prj_1",
            role: "readonly",
            limitAccessByEnvironment: false,
            environments: [],
            teams: ["team_1"],
          },
        ],
        disabled: true,
        disabledBy: "u_2",
        lastUsed: new Date("2026-01-03T00:00:00Z"),
      }),
    ).toEqual({
      id: "key_1",
      type: "organization",
      description: "Sync",
      role: "engineer",
      limitAccessByEnvironment: true,
      environments: ["production"],
      additionalRoles: [
        { role: "analyst", limitAccessByEnvironment: false, environments: [] },
      ],
      projectRoles: [
        {
          project: "prj_1",
          role: "readonly",
          limitAccessByEnvironment: false,
          environments: [],
        },
      ],
      actAs: "system",
      disabled: true,
      disabledBy: "u_2",
      dateCreated: "2026-01-01T00:00:00.000Z",
      dateUpdated: "2026-01-02T00:00:00.000Z",
      lastUsed: "2026-01-03T00:00:00.000Z",
      expiresAt: null,
    });
  });

  it("maps an unscoped PAT without a role or actAs", () => {
    const apiKey = toApiKey(pat, "owner@example.com");
    expect(apiKey).toMatchObject({
      type: "personal",
      userId: "u_1",
      userEmail: "owner@example.com",
      scoped: false,
    });
    expect(apiKey).not.toHaveProperty("role");
    expect(apiKey).not.toHaveProperty("actAs");
  });

  it("keeps a scoped PAT's role", () => {
    expect(toApiKey({ ...pat, scoped: true, role: "readonly" })).toMatchObject({
      scoped: true,
      role: "readonly",
    });
  });

  it("returns an empty id for a key created before keys had ids", () => {
    expect(toApiKey({ ...base, id: undefined }).id).toBe("");
  });
});

describe("toApiKeys", () => {
  const emails = new Map([["u_1", "owner@example.com"]]);

  it("shows a token owner's email while they're a member", () => {
    expect(toApiKeys([pat], new Set(["u_1"]), emails)[0].userEmail).toBe(
      "owner@example.com",
    );
  });

  it("drops the owner's email once they leave", () => {
    const [apiKey] = toApiKeys([pat], new Set(), emails);
    expect(apiKey).not.toHaveProperty("userEmail");
    expect(apiKey.userId).toBe("u_1");
  });
});

describe("loadApiKeys", () => {
  const getUsers = getUsersByIds as jest.MockedFunction<typeof getUsersByIds>;
  const context = (memberIds: string[]) =>
    ({
      org: { members: memberIds.map((id) => ({ id })) },
    }) as unknown as ReqContext;

  beforeEach(() => {
    getUsers.mockReset();
    getUsers.mockImplementation(async (ids) =>
      ids.map((id) => ({
        id,
        email: `${id}@example.com`,
        name: id,
        verified: true,
      })),
    );
  });

  it("looks up only current members' emails", async () => {
    const formerPat = { ...pat, id: "key_former", userId: "u_gone" };
    const apiKeys = await loadApiKeys(context(["u_1"]), [base, pat, formerPat]);
    expect(getUsers).toHaveBeenCalledWith(["u_1"]);
    expect(apiKeys.map((k) => k.userEmail)).toEqual([
      undefined,
      "u_1@example.com",
      undefined,
    ]);
    expect(apiKeys[2].userId).toBe("u_gone");
  });

  it("skips the lookup when no key has a member owner", async () => {
    await loadApiKeys(context([]), [base, pat]);
    expect(getUsers).not.toHaveBeenCalled();
  });
});
