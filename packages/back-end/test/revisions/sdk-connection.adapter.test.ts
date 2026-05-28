import type { Revision, JsonPatchOperation } from "shared/enterprise";
import type { SDKConnectionRevisionSnapshot } from "shared/validators";
import type { SDKConnectionInterface } from "shared/types/sdk-connection";
import type { Context } from "back-end/src/models/BaseModel";
import { sdkConnectionAdapter } from "back-end/src/revisions/adapters/sdk-connection.adapter";
import { getAdapter } from "back-end/src/revisions/index";
import { isRevisionRequired } from "back-end/src/revisions/util";
import {
  editSDKConnection,
  findSDKConnectionById,
} from "back-end/src/models/SdkConnectionModel";

// The adapter's applyChanges / getModel call straight into the model module;
// mock just the two functions it uses.
jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  editSDKConnection: jest.fn(),
  findSDKConnectionById: jest.fn(),
}));

const mockedEdit = editSDKConnection as jest.Mock;
const mockedFind = findSDKConnectionById as jest.Mock;

const buildRevision = (
  proposedChanges: JsonPatchOperation[],
  snapshot: Record<string, unknown> = {},
): Revision =>
  ({
    id: "rev-1",
    target: {
      type: "sdk-connection",
      id: "sdk-1",
      snapshot,
      proposedChanges,
    },
    status: "draft",
    authorId: "user-1",
    reviews: [],
    activityLog: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: "org-1",
  }) as unknown as Revision;

// A full live connection (nested proxy + secret/system fields) as returned by
// findSDKConnectionById.
const baseConnection = {
  id: "sdk-1",
  organization: "org-1",
  name: "Prod Web",
  languages: ["javascript"],
  sdkVersion: "1.0.0",
  environment: "production",
  projects: ["prj-1"],
  encryptPayload: false,
  encryptionKey: "secret-enc-key",
  hashSecureAttributes: false,
  includeDraftExperiments: true,
  remoteEvalEnabled: false,
  savedGroupReferencesEnabled: false,
  archived: false,
  key: "sdk-abc123",
  connected: true,
  proxy: {
    enabled: true,
    host: "https://proxy.example.com",
    signingKey: "proxy-secret",
    connected: true,
    version: "1.2.3",
    error: "",
    lastError: null,
  },
  dateCreated: new Date("2025-01-01"),
  dateUpdated: new Date("2025-01-02"),
} as unknown as SDKConnectionInterface;

// The flattened, secret-free snapshot the adapter produces / consumes.
const baseSnapshot = sdkConnectionAdapter.buildSnapshot(
  baseConnection as unknown as SDKConnectionRevisionSnapshot,
);

function makeContext(overrides: {
  approvalRequired?: boolean;
  hasRequireApprovals?: boolean;
  requireMetadataReview?: boolean;
  // Custom scoped rules; takes precedence over the approvalRequired shorthand.
  rules?: Record<string, unknown>[];
  permissions?: Partial<Record<string, (...args: unknown[]) => boolean>>;
}): Context {
  const permissions = {
    canReadMultiProjectResource: () => true,
    canUpdateSDKConnection: () => true,
    canBypassApprovalChecks: () => true,
    ...(overrides.permissions ?? {}),
  };
  const sdkConnections =
    overrides.rules ??
    (overrides.approvalRequired
      ? [
          {
            required: true,
            ...(overrides.requireMetadataReview !== undefined
              ? { requireMetadataReview: overrides.requireMetadataReview }
              : {}),
          },
        ]
      : [{ required: false }]);
  return {
    org: {
      settings: {
        approvalFlows: { sdkConnections },
      },
    },
    permissions,
    hasPremiumFeature: (feature: string) =>
      feature === "require-approvals"
        ? (overrides.hasRequireApprovals ?? true)
        : false,
    userId: "user-1",
  } as unknown as Context;
}

beforeEach(() => {
  mockedEdit.mockReset();
  mockedFind.mockReset();
});

describe("sdkConnectionAdapter", () => {
  describe("buildSnapshot", () => {
    it("flattens proxy and strips secret / system fields", () => {
      expect(baseSnapshot).toEqual({
        id: "sdk-1",
        organization: "org-1",
        name: "Prod Web",
        languages: ["javascript"],
        sdkVersion: "1.0.0",
        environment: "production",
        projects: ["prj-1"],
        encryptPayload: false,
        hashSecureAttributes: false,
        includeDraftExperiments: true,
        remoteEvalEnabled: false,
        savedGroupReferencesEnabled: false,
        archived: false,
        proxyEnabled: true,
        proxyHost: "https://proxy.example.com",
        dateCreated: new Date("2025-01-01"),
        dateUpdated: new Date("2025-01-02"),
      });
      // secrets / system fields are not carried
      expect(baseSnapshot).not.toHaveProperty("encryptionKey");
      expect(baseSnapshot).not.toHaveProperty("key");
      expect(baseSnapshot).not.toHaveProperty("connected");
      expect(baseSnapshot).not.toHaveProperty("proxy");
    });

    it("drops nullish optional fields and unknown/legacy keys", () => {
      const withNulls = {
        ...baseConnection,
        _id: "internal",
        sdkVersion: null as unknown as string,
        legacyField: "x",
      } as unknown as SDKConnectionRevisionSnapshot;
      const snap = sdkConnectionAdapter.buildSnapshot(withNulls);
      expect(snap).not.toHaveProperty("_id");
      expect(snap).not.toHaveProperty("legacyField");
      expect(snap.sdkVersion).toBeUndefined();
      expect(snap.id).toBe("sdk-1");
    });

    it("is idempotent on an already-flattened snapshot", () => {
      expect(sdkConnectionAdapter.buildSnapshot(baseSnapshot)).toEqual(
        baseSnapshot,
      );
    });
  });

  describe("getUpdatableFields", () => {
    it("includes editable payload / proxy / archived fields", () => {
      const fields = sdkConnectionAdapter.getUpdatableFields();
      [
        "name",
        "languages",
        "sdkVersion",
        "environment",
        "projects",
        "encryptPayload",
        "proxyEnabled",
        "proxyHost",
        "remoteEvalEnabled",
        "archived",
      ].forEach((f) => expect(fields.has(f)).toBe(true));
    });

    it("excludes identity / secret / system fields", () => {
      const fields = sdkConnectionAdapter.getUpdatableFields();
      ["id", "organization", "dateCreated", "dateUpdated"].forEach((f) =>
        expect(fields.has(f)).toBe(false),
      );
    });
  });

  describe("isRevisionRequired / isApprovalRequired", () => {
    it("is true when org requires approval for SDK connections", () => {
      const ctx = makeContext({ approvalRequired: true });
      expect(sdkConnectionAdapter.isRevisionRequired(ctx)).toBe(true);
      expect(sdkConnectionAdapter.isApprovalRequired(ctx)).toBe(true);
    });

    it("is false when approval is disabled", () => {
      const ctx = makeContext({ approvalRequired: false });
      expect(sdkConnectionAdapter.isRevisionRequired(ctx)).toBe(false);
      expect(sdkConnectionAdapter.isApprovalRequired(ctx)).toBe(false);
    });

    it("is false when the org lacks the require-approvals feature", () => {
      const ctx = makeContext({
        approvalRequired: true,
        hasRequireApprovals: false,
      });
      expect(sdkConnectionAdapter.isRevisionRequired(ctx)).toBe(false);
    });
  });

  describe("isApprovalRequiredForRevision", () => {
    const metadataOnly: JsonPatchOperation[] = [
      { op: "replace", path: "/name", value: "Renamed" },
    ];
    const contentChange: JsonPatchOperation[] = [
      { op: "replace", path: "/encryptPayload", value: true },
    ];

    it("requires approval for any revision when metadata review is on (default)", () => {
      const ctx = makeContext({ approvalRequired: true });
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(metadataOnly),
        ),
      ).toBe(true);
    });

    it("releases approval for name-only revisions when metadata review is off", () => {
      const ctx = makeContext({
        approvalRequired: true,
        requireMetadataReview: false,
      });
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(metadataOnly),
        ),
      ).toBe(false);
    });

    it("still requires approval for payload changes when metadata review is off", () => {
      const ctx = makeContext({
        approvalRequired: true,
        requireMetadataReview: false,
      });
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(contentChange),
        ),
      ).toBe(true);
    });

    it("does not require approval when org approval is off", () => {
      const ctx = makeContext({ approvalRequired: false });
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(contentChange),
        ),
      ).toBe(false);
    });
  });

  describe("isApprovalRequiredForRevision — project/environment scoping", () => {
    const contentChange: JsonPatchOperation[] = [
      { op: "replace", path: "/encryptPayload", value: true },
    ];
    // Rule gated to the production environment only.
    const prodRule = [{ required: true, environments: ["production"] }];

    it("requires approval when the connection scope matches the rule", () => {
      const ctx = makeContext({ rules: prodRule });
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(contentChange, { environment: "production" }),
        ),
      ).toBe(true);
    });

    it("does NOT require approval when the connection is out of the rule's scope", () => {
      const ctx = makeContext({ rules: prodRule });
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(contentChange, { environment: "staging" }),
        ),
      ).toBe(false);
    });

    it("requires approval when the revision MOVES the connection into a gated scope", () => {
      const ctx = makeContext({ rules: prodRule });
      // Baseline is out of scope (staging), but the change moves it to production.
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(
            [{ op: "replace", path: "/environment", value: "production" }],
            { environment: "staging" },
          ),
        ),
      ).toBe(true);
    });

    it("matches a project-scoped rule when any of the connection's projects intersect", () => {
      const ctx = makeContext({
        rules: [{ required: true, projects: ["prj-secure"] }],
      });
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(contentChange, {
            environment: "staging",
            projects: ["prj-a", "prj-secure"],
          }),
        ),
      ).toBe(true);
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(contentChange, {
            environment: "staging",
            projects: ["prj-other"],
          }),
        ),
      ).toBe(false);
    });
  });

  describe("permission helpers", () => {
    it("canRead delegates to canReadMultiProjectResource with snapshot projects", () => {
      const canReadMultiProjectResource = jest.fn(() => true);
      const ctx = makeContext({
        permissions: { canReadMultiProjectResource },
      });
      expect(sdkConnectionAdapter.canRead(ctx, baseSnapshot)).toBe(true);
      expect(canReadMultiProjectResource).toHaveBeenCalledWith(["prj-1"]);
    });

    it("canCreate / canUpdate both delegate to canUpdateSDKConnection", () => {
      const canUpdateSDKConnection = jest.fn(() => true);
      const ctx = makeContext({ permissions: { canUpdateSDKConnection } });
      expect(sdkConnectionAdapter.canCreate(ctx, baseSnapshot)).toBe(true);
      expect(sdkConnectionAdapter.canUpdate(ctx, baseSnapshot)).toBe(true);
      expect(canUpdateSDKConnection).toHaveBeenCalledTimes(2);
      expect(canUpdateSDKConnection).toHaveBeenNthCalledWith(
        1,
        baseSnapshot,
        {},
      );
    });

    it("canBypassApproval requires bypass on every project", () => {
      const partialDeny = jest.fn(
        ({ project }: { project: string }) => project !== "prj-2",
      );
      const ctx = makeContext({
        permissions: { canBypassApprovalChecks: partialDeny },
      });
      const multi = { ...baseSnapshot, projects: ["prj-1", "prj-2"] };
      expect(sdkConnectionAdapter.canBypassApproval(ctx, multi)).toBe(false);
    });

    it("canBypassApproval treats no-projects as the empty global project", () => {
      const canBypassApprovalChecks = jest.fn(() => true);
      const ctx = makeContext({ permissions: { canBypassApprovalChecks } });
      const noProjects = { ...baseSnapshot, projects: [] };
      expect(sdkConnectionAdapter.canBypassApproval(ctx, noProjects)).toBe(
        true,
      );
      expect(canBypassApprovalChecks).toHaveBeenCalledWith({ project: "" });
    });
  });

  describe("applyChanges", () => {
    it("filters to differing updatable fields and writes via editSDKConnection", async () => {
      mockedFind.mockResolvedValue(baseConnection);
      const ctx = makeContext({});

      await sdkConnectionAdapter.applyChanges(ctx, baseSnapshot, {
        name: "New Name", // updatable, differs
        encryptPayload: true, // updatable, differs (was false)
        proxyHost: "https://proxy.example.com", // unchanged → skip
        organization: "other-org", // NOT updatable
        id: "sdk-2", // NOT updatable
      });

      expect(mockedFind).toHaveBeenCalledWith(ctx, "sdk-1");
      expect(mockedEdit).toHaveBeenCalledTimes(1);
      const [, conn, changes] = mockedEdit.mock.calls[0];
      expect(conn).toBe(baseConnection);
      expect(changes).toEqual({ name: "New Name", encryptPayload: true });
    });

    it("does not reload or write when there are no effective changes", async () => {
      const ctx = makeContext({});
      await sdkConnectionAdapter.applyChanges(ctx, baseSnapshot, {
        name: baseSnapshot.name,
        proxyEnabled: baseSnapshot.proxyEnabled,
      });
      expect(mockedFind).not.toHaveBeenCalled();
      expect(mockedEdit).not.toHaveBeenCalled();
    });

    it("throws when the live connection can no longer be found", async () => {
      mockedFind.mockResolvedValue(null);
      const ctx = makeContext({});
      await expect(
        sdkConnectionAdapter.applyChanges(ctx, baseSnapshot, {
          name: "New Name",
        }),
      ).rejects.toThrow("Could not find SDK Connection");
      expect(mockedEdit).not.toHaveBeenCalled();
    });
  });
});

describe("revisions registry (sdk-connection)", () => {
  it("getAdapter returns the sdk-connection adapter", () => {
    expect(getAdapter("sdk-connection")).toBe(sdkConnectionAdapter);
  });

  it("isRevisionRequired delegates to the adapter", () => {
    expect(
      isRevisionRequired(
        makeContext({ approvalRequired: true }),
        "sdk-connection",
        "sdk-1",
      ),
    ).toBe(true);
    expect(
      isRevisionRequired(
        makeContext({ approvalRequired: false }),
        "sdk-connection",
        "sdk-1",
      ),
    ).toBe(false);
  });
});
