import type { ReqContext } from "back-end/types/request";
import {
  canReadApiKeyHistory,
  getApiKeyIdsHiddenFromKeyViewers,
} from "back-end/src/services/apiKeyHistory";
import { getAuditedApiKeyKinds } from "back-end/src/models/AuditModel";

jest.mock("back-end/src/models/AuditModel", () => ({
  getAuditedApiKeyKinds: jest.fn(),
}));

const mockedKinds = jest.mocked(getAuditedApiKeyKinds);

type FakeKey = { id: string; userId?: string };

// Live keys: an org key and two members' tokens
const liveKeys: FakeKey[] = [
  { id: "key_org" },
  { id: "key_mine", userId: "u_me" },
  { id: "key_theirs", userId: "u_other" },
];

function setAuditedKinds({
  all = [],
  tokens = [],
  orgKeys = [],
}: {
  all?: string[];
  tokens?: string[];
  orgKeys?: string[];
}) {
  mockedKinds.mockResolvedValue({
    all,
    tokens: new Set(tokens),
    orgKeys: new Set(orgKeys),
  });
}

function makeContext({
  viewKeys = false,
  manageTokens = false,
}: {
  viewKeys?: boolean;
  manageTokens?: boolean;
}) {
  return {
    userId: "u_me",
    org: { id: "org_1" },
    permissions: {
      canViewApiKeys: () => viewKeys,
      canManagePersonalAccessTokens: () => manageTokens,
    },
    models: {
      apiKeys: {
        dangerousGetById: async (id: string) =>
          liveKeys.find((k) => k.id === id) ?? null,
        dangerousGetAllApiKeysInOrg: async () => liveKeys,
      },
    },
  } as unknown as ReqContext;
}

const nobody = makeContext({});
const keyViewer = makeContext({ viewKeys: true });
const tokenManager = makeContext({ manageTokens: true });
const both = makeContext({ viewKeys: true, manageTokens: true });

beforeEach(() => {
  mockedKinds.mockReset();
  setAuditedKinds({
    all: [
      "key_org",
      "key_mine",
      "key_theirs",
      "gone_org",
      "gone_token",
      "gone_unknown",
      "",
    ],
    tokens: ["key_mine", "key_theirs", "gone_token"],
    orgKeys: ["key_org", "gone_org"],
  });
});

describe("canReadApiKeyHistory", () => {
  it("needs key viewing for the whole API key history", async () => {
    expect(await canReadApiKeyHistory(keyViewer, undefined)).toBe(true);
    expect(await canReadApiKeyHistory(tokenManager, undefined)).toBe(false);
    expect(await canReadApiKeyHistory(nobody, undefined)).toBe(false);
  });

  it("lets owners read their own token's history", async () => {
    expect(await canReadApiKeyHistory(nobody, "key_mine")).toBe(true);
  });

  it("needs token management for another member's token", async () => {
    expect(await canReadApiKeyHistory(nobody, "key_theirs")).toBe(false);
    expect(await canReadApiKeyHistory(keyViewer, "key_theirs")).toBe(false);
    expect(await canReadApiKeyHistory(tokenManager, "key_theirs")).toBe(true);
  });

  it("needs key viewing for a live org key", async () => {
    expect(await canReadApiKeyHistory(keyViewer, "key_org")).toBe(true);
    expect(await canReadApiKeyHistory(tokenManager, "key_org")).toBe(false);
  });

  it("doesn't look at audits for a live key", async () => {
    await canReadApiKeyHistory(keyViewer, "key_org");
    expect(mockedKinds).not.toHaveBeenCalled();
  });

  it("classifies a deleted key by its audits", async () => {
    expect(await canReadApiKeyHistory(tokenManager, "gone_token")).toBe(true);
    expect(await canReadApiKeyHistory(keyViewer, "gone_token")).toBe(false);
    expect(await canReadApiKeyHistory(keyViewer, "gone_org")).toBe(true);
    expect(await canReadApiKeyHistory(tokenManager, "gone_org")).toBe(false);
    expect(mockedKinds).toHaveBeenCalledWith("org_1");
  });

  it("needs both permissions for a deleted key its audits can't place", async () => {
    expect(await canReadApiKeyHistory(keyViewer, "gone_unknown")).toBe(false);
    expect(await canReadApiKeyHistory(tokenManager, "gone_unknown")).toBe(
      false,
    );
    expect(await canReadApiKeyHistory(both, "gone_unknown")).toBe(true);
  });
});

describe("getApiKeyIdsHiddenFromKeyViewers", () => {
  it("hides members' tokens and deleted keys not known as org keys", async () => {
    const hidden = await getApiKeyIdsHiddenFromKeyViewers(keyViewer);
    expect(hidden.sort()).toEqual(
      ["gone_token", "gone_unknown", "key_mine", "key_theirs"].sort(),
    );
  });

  it("keeps live and deleted org keys visible", async () => {
    const hidden = await getApiKeyIdsHiddenFromKeyViewers(keyViewer);
    expect(hidden).not.toContain("key_org");
    expect(hidden).not.toContain("gone_org");
  });

  it("skips org-wide entries that name no key", async () => {
    const hidden = await getApiKeyIdsHiddenFromKeyViewers(keyViewer);
    expect(hidden).not.toContain("");
  });

  it("trusts the live key over its audits", async () => {
    // A live org key whose audits look like a token's stays visible, and a
    // live token stays hidden even if audits call it an org key
    setAuditedKinds({
      all: ["key_org", "key_mine"],
      tokens: ["key_org"],
      orgKeys: ["key_mine"],
    });
    expect(await getApiKeyIdsHiddenFromKeyViewers(keyViewer)).toEqual([
      "key_mine",
    ]);
  });

  it("returns nothing when no API key has audits", async () => {
    setAuditedKinds({});
    expect(await getApiKeyIdsHiddenFromKeyViewers(keyViewer)).toEqual([]);
  });
});
