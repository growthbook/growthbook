import {
  revisionAuditDetails,
  scrubAuditDetails,
  sdkConnectionAuditDetails,
} from "back-end/src/models/AuditModel";

const revision = {
  id: "rev_1",
  organization: "org_1",
  authorId: "u_1",
  version: 3,
  status: "draft",
  title: "Add the VIP list",
  comment: "for launch",
  target: {
    type: "saved-group",
    id: "grp_1",
    snapshot: { values: ["secret@example.com"] },
    proposedChanges: [{ op: "replace", path: "/values", value: ["x"] }],
  },
  reviews: [{ comment: "looks good" }],
  activityLog: [{ proposedChangesSnapshot: [{ value: ["x"] }] }],
  dateCreated: "2026-11-01T00:00:00.000Z",
  dateUpdated: "2026-11-02T00:00:00.000Z",
};

const metadata = {
  id: "rev_1",
  organization: "org_1",
  authorId: "u_1",
  version: 3,
  status: "draft",
  target: { type: "saved-group", id: "grp_1" },
  dateCreated: "2026-11-01T00:00:00.000Z",
  dateUpdated: "2026-11-02T00:00:00.000Z",
};

describe("revision audit details", () => {
  it("keeps who, what and when, never contents", () => {
    expect(revisionAuditDetails(revision)).toEqual(metadata);
  });

  it("trims entries stored with full contents as they're read", () => {
    const stored = JSON.stringify({
      pre: revision,
      post: { ...revision, status: "merged" },
      context: { source: "api" },
    });
    expect(JSON.parse(scrubAuditDetails("revision", stored))).toEqual({
      pre: metadata,
      post: { ...metadata, status: "merged" },
      context: { source: "api" },
    });
  });

  it("leaves other entities' entries as stored", () => {
    const stored = JSON.stringify({ pre: { name: "a" }, post: { name: "b" } });
    expect(scrubAuditDetails("feature", stored)).toBe(stored);
  });

  it("drops details it can't parse", () => {
    expect(scrubAuditDetails("revision", "{not json")).toBe("");
  });
});

describe("SDK connection audit details", () => {
  it("keeps the connection's settings but not its keys", () => {
    const connection = {
      id: "sdk_1",
      key: "sdk-abc",
      encryptPayload: true,
      encryptionKey: "decrypt-me",
      proxy: { enabled: true, host: "https://p.example", signingKey: "sign" },
    };
    expect(sdkConnectionAuditDetails(connection)).toEqual({
      id: "sdk_1",
      key: "sdk-abc",
      encryptPayload: true,
      proxy: { enabled: true, host: "https://p.example" },
    });
    expect(sdkConnectionAuditDetails({ id: "sdk_2" })).toEqual({ id: "sdk_2" });
  });
});
