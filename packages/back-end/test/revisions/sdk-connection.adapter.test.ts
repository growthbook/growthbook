import type { Revision, JsonPatchOperation } from "shared/enterprise";
import {
  sdkConnectionUpdatableFieldsSchema,
  type SDKConnectionRevisionSnapshot,
  type SDKWebhookRevisionSnapshot,
} from "shared/validators";
import type { SDKConnectionInterface } from "shared/types/sdk-connection";
import { CasConflictError, type Context } from "back-end/src/models/BaseModel";
import { sdkConnectionAdapter } from "back-end/src/revisions/adapters/sdk-connection.adapter";
import { getAdapter } from "back-end/src/revisions/index";
import { isRevisionRequired } from "back-end/src/revisions/util";
import {
  editSDKConnection,
  findSDKConnectionById,
} from "back-end/src/models/SdkConnectionModel";

// The adapter's applyChanges / getModel call straight into the model module;
// mock just the functions it uses.
jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  editSDKConnection: jest.fn(),
  findSDKConnectionById: jest.fn(),
  findSDKConnectionsByIds: jest.fn(),
}));

const mockedEdit = editSDKConnection as jest.Mock;
const mockedFind = findSDKConnectionById as jest.Mock;

const buildRevision = (
  proposedChanges: JsonPatchOperation[],
  snapshot: Record<string, unknown>,
  overrides: Partial<Revision> = {},
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
    ...overrides,
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
  savedGroupFormat: "inline",
  includeReferencedPrerequisites: true,
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

const baseWebhook: SDKWebhookRevisionSnapshot = {
  id: "wh-1",
  name: "Hook",
  endpoint: "https://hooks.example.com/1",
  httpMethod: "POST",
  headers: "",
  disabled: false,
};

// The stored composite snapshot the adapter produces / consumes.
const baseSnapshot = sdkConnectionAdapter.buildSnapshot(
  baseConnection as unknown as SDKConnectionRevisionSnapshot,
);

// What `getModel().getById()` returns: the composite plus the live root fields
// the generic engine reads (`id`, `projects`, `dateUpdated`).
const liveEntity = {
  ...baseSnapshot,
  id: "sdk-1",
  projects: ["prj-1"],
  dateUpdated: new Date("2025-01-02"),
} as SDKConnectionRevisionSnapshot & { dateUpdated: Date };

const settings = (
  overrides: Partial<SDKConnectionRevisionSnapshot["sdkConnection"]>,
) => ({ ...baseSnapshot.sdkConnection, ...overrides });

const replaceSettings = (
  overrides: Partial<SDKConnectionRevisionSnapshot["sdkConnection"]>,
): JsonPatchOperation[] => [
  { op: "replace", path: "/sdkConnection", value: settings(overrides) },
];

const snapshotWith = (
  overrides: Partial<SDKConnectionRevisionSnapshot["sdkConnection"]>,
  sdkWebhooks: SDKWebhookRevisionSnapshot[] = [],
): SDKConnectionRevisionSnapshot => ({
  sdkConnection: settings(overrides),
  sdkWebhooks,
});

type PermissionOverrides = Partial<
  Record<string, (...args: never[]) => unknown>
>;

function makeContext(overrides: {
  approvalRequired?: boolean;
  hasRequireApprovals?: boolean;
  requireMetadataReview?: boolean;
  // Custom scoped rules; takes precedence over the approvalRequired shorthand.
  rules?: Record<string, unknown>[];
  premiumFeatures?: string[];
  requireProjectForSdkConnections?: boolean;
  webhookCount?: number;
  permissions?: PermissionOverrides;
}): Context {
  const permissions = {
    canReadMultiProjectResource: () => true,
    canUpdateSDKConnection: () => true,
    canBypassSDKConnectionApprovalChecks: () => true,
    canRevisionAction: () => true,
    canCreateSDKWebhook: () => true,
    canUpdateSDKWebhook: () => true,
    canDeleteSDKWebhook: () => true,
    throwPermissionError: () => {
      throw new Error("permission denied");
    },
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
  const premium = new Set(overrides.premiumFeatures ?? []);
  if (overrides.hasRequireApprovals ?? true) premium.add("require-approvals");
  return {
    org: {
      id: "org-1",
      settings: {
        approvalFlows: { sdkConnections },
        requireProjectForSdkConnections:
          overrides.requireProjectForSdkConnections ?? false,
      },
    },
    permissions,
    hasPremiumFeature: (feature: string) => premium.has(feature),
    userId: "user-1",
    models: {
      sdkWebhooks: {
        findAllSdkWebhooksByConnectionIds: jest.fn(async () => []),
        countSdkWebhooksByOrg: jest.fn(async () => overrides.webhookCount ?? 0),
        getDefaultCreateProps: (id: string) => ({ sdks: [id] }),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
        delete: jest.fn(async () => undefined),
        getById: jest.fn(async (id: string) => ({ id })),
      },
    },
  } as unknown as Context;
}

const webhooksModel = (ctx: Context) =>
  ctx.models.sdkWebhooks as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  mockedEdit.mockReset();
  mockedFind.mockReset();
  mockedFind.mockResolvedValue(baseConnection);
  mockedEdit.mockImplementation(
    async (
      _ctx: Context,
      conn: SDKConnectionInterface,
      changes: Record<string, unknown>,
    ) => ({ ...conn, ...changes, dateUpdated: new Date("2025-02-01") }),
  );
});

describe("sdkConnectionAdapter", () => {
  describe("buildSnapshot", () => {
    it("builds the composite: flattened proxy, no secrets, webhooks list", () => {
      expect(baseSnapshot).toEqual({
        sdkConnection: {
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
          savedGroupFormat: "inline",
          includeReferencedPrerequisites: true,
          archived: false,
          proxyEnabled: true,
          proxyHost: "https://proxy.example.com",
        },
        sdkWebhooks: [],
      });
      ["encryptionKey", "key", "connected", "proxy", "dateUpdated"].forEach(
        (f) => expect(baseSnapshot.sdkConnection).not.toHaveProperty(f),
      );
    });

    it("maps pre-fetched `_webhooks` into the snapshot shape", () => {
      const snap = sdkConnectionAdapter.buildSnapshot({
        ...baseConnection,
        _webhooks: [
          {
            id: "wh-1",
            name: "Hook",
            endpoint: "https://hooks.example.com/1",
            signingKey: "secret",
            headers: "",
          },
        ],
      } as unknown as SDKConnectionRevisionSnapshot);
      expect(snap.sdkWebhooks).toEqual([
        {
          id: "wh-1",
          name: "Hook",
          endpoint: "https://hooks.example.com/1",
          httpMethod: "POST",
          headers: "",
        },
      ]);
    });

    it("drops nullish optional fields and unknown/legacy keys", () => {
      const withNulls = {
        ...baseConnection,
        _id: "internal",
        sdkVersion: null as unknown as string,
        legacyField: "x",
      } as unknown as SDKConnectionRevisionSnapshot;
      const snap = sdkConnectionAdapter.buildSnapshot(withNulls);
      expect(snap.sdkConnection).not.toHaveProperty("_id");
      expect(snap.sdkConnection).not.toHaveProperty("legacyField");
      expect(snap.sdkConnection.sdkVersion).toBeUndefined();
      expect(snap.sdkConnection.id).toBe("sdk-1");
    });

    it("is idempotent on a stored snapshot and strips the live root fields", () => {
      expect(sdkConnectionAdapter.buildSnapshot(baseSnapshot)).toEqual(
        baseSnapshot,
      );
      expect(sdkConnectionAdapter.buildSnapshot(liveEntity)).toEqual(
        baseSnapshot,
      );
    });
  });

  describe("getUpdatableFields", () => {
    it("exposes only the two composite keys", () => {
      const fields = sdkConnectionAdapter.getUpdatableFields();
      expect([...fields].sort()).toEqual(["sdkConnection", "sdkWebhooks"]);
    });

    it("lets a revision carry the saved group format and prerequisite setting", () => {
      const keys = Object.keys(sdkConnectionUpdatableFieldsSchema.shape);
      expect(keys).toContain("savedGroupFormat");
      expect(keys).toContain("includeReferencedPrerequisites");
    });

    it("keeps identity / system fields out of the settings write list", () => {
      const keys = Object.keys(sdkConnectionUpdatableFieldsSchema.shape);
      ["id", "organization", "dateCreated", "dateUpdated"].forEach((f) =>
        expect(keys).not.toContain(f),
      );
    });
  });

  describe("getModel", () => {
    it("getById returns the composite with the live root fields", async () => {
      const ctx = makeContext({});
      webhooksModel(ctx).findAllSdkWebhooksByConnectionIds.mockResolvedValue([
        { ...baseWebhook, signingKey: "secret" },
      ]);
      const entity = await sdkConnectionAdapter.getModel(ctx)!.getById("sdk-1");
      expect(entity).toEqual({
        ...baseSnapshot,
        sdkWebhooks: [baseWebhook],
        id: "sdk-1",
        projects: ["prj-1"],
        dateUpdated: new Date("2025-01-02"),
      });
    });

    it("getById returns null when the connection is gone", async () => {
      mockedFind.mockResolvedValue(null);
      const ctx = makeContext({});
      expect(
        await sdkConnectionAdapter.getModel(ctx)!.getById("sdk-1"),
      ).toBeNull();
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
    const metadataOnly = replaceSettings({ name: "Renamed" });
    const contentChange = replaceSettings({ encryptPayload: true });

    it("requires approval for any revision when metadata review is on (default)", () => {
      const ctx = makeContext({ approvalRequired: true });
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(metadataOnly, baseSnapshot),
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
          buildRevision(metadataOnly, baseSnapshot),
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
          buildRevision(contentChange, baseSnapshot),
        ),
      ).toBe(true);
    });

    it("does not require approval when org approval is off", () => {
      const ctx = makeContext({ approvalRequired: false });
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(contentChange, baseSnapshot),
        ),
      ).toBe(false);
    });
  });

  describe("isApprovalRequiredForRevision — project/environment scoping", () => {
    const contentChange = replaceSettings({ encryptPayload: true });
    const prodRule = [{ required: true, environments: ["production"] }];

    it("requires approval when the connection scope matches the rule", () => {
      const ctx = makeContext({ rules: prodRule });
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(contentChange, snapshotWith({})),
        ),
      ).toBe(true);
    });

    it("does NOT require approval when the connection is out of the rule's scope", () => {
      const ctx = makeContext({ rules: prodRule });
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(
            replaceSettings({ environment: "staging", encryptPayload: true }),
            snapshotWith({ environment: "staging" }),
          ),
        ),
      ).toBe(false);
    });

    it("requires approval when the revision MOVES the connection into a gated scope", () => {
      const ctx = makeContext({ rules: prodRule });
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(
            replaceSettings({ environment: "production" }),
            snapshotWith({ environment: "staging" }),
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
          buildRevision(
            replaceSettings({
              projects: ["prj-a", "prj-secure"],
              encryptPayload: true,
            }),
            snapshotWith({ projects: ["prj-a", "prj-secure"] }),
          ),
        ),
      ).toBe(true);
      expect(
        sdkConnectionAdapter.isApprovalRequiredForRevision!(
          ctx,
          buildRevision(
            replaceSettings({ projects: ["prj-other"], encryptPayload: true }),
            snapshotWith({ projects: ["prj-other"] }),
          ),
        ),
      ).toBe(false);
    });
  });

  describe("rule-scoped policy", () => {
    const prodRule = {
      required: true,
      environments: ["production"],
      requiredApproverTeams: ["team-sec"],
      resetReviewOnChange: true,
      autopublishOnApproval: true,
    };
    const stagingRule = {
      required: true,
      environments: ["staging"],
      resetReviewOnChange: false,
      autopublishOnApproval: false,
    };
    const contentChange = replaceSettings({ encryptPayload: true });

    it("reviewRequirementForRevision returns only the rules covering the connection's environment", () => {
      const ctx = makeContext({ rules: [prodRule, stagingRule] });
      const requirement = sdkConnectionAdapter.reviewRequirementForRevision!(
        ctx,
        buildRevision(contentChange, snapshotWith({})),
      );
      expect(requirement.required).toBe(true);
      expect(requirement.rules).toEqual([prodRule]);
    });

    it("reviewRequirementForRevision drops metadata-exempt rules for a name-only change", () => {
      const ctx = makeContext({
        rules: [{ ...prodRule, requireMetadataReview: false }],
      });
      expect(
        sdkConnectionAdapter.reviewRequirementForRevision!(
          ctx,
          buildRevision(replaceSettings({ name: "Renamed" }), snapshotWith({})),
        ),
      ).toEqual({ required: false, rules: [] });
    });

    it("reviewRequirementForRevision is empty without the premium feature", () => {
      const ctx = makeContext({
        rules: [prodRule],
        hasRequireApprovals: false,
      });
      expect(
        sdkConnectionAdapter.reviewRequirementForRevision!(
          ctx,
          buildRevision(contentChange, snapshotWith({})),
        ),
      ).toEqual({ required: false, rules: [] });
    });

    it("shouldResetReviewOnChange follows the environment-scoped rule", () => {
      const ctx = makeContext({ rules: [prodRule, stagingRule] });
      const prod = buildRevision(contentChange, snapshotWith({}));
      const staging = buildRevision(
        replaceSettings({ environment: "staging", encryptPayload: true }),
        snapshotWith({ environment: "staging" }),
      );
      expect(
        sdkConnectionAdapter.shouldResetReviewOnChange!(ctx, prod, prod),
      ).toBe(true);
      expect(
        sdkConnectionAdapter.shouldResetReviewOnChange!(ctx, staging, staging),
      ).toBe(false);
    });

    it("isAutopublishOnApprovalEnabled follows the environment-scoped rule", () => {
      const ctx = makeContext({ rules: [prodRule, stagingRule] });
      expect(
        sdkConnectionAdapter.isAutopublishOnApprovalEnabled!(
          ctx,
          snapshotWith({}),
        ),
      ).toBe(true);
      expect(
        sdkConnectionAdapter.isAutopublishOnApprovalEnabled!(
          ctx,
          snapshotWith({ environment: "staging" }),
        ),
      ).toBe(false);
      expect(
        sdkConnectionAdapter.isAutopublishOnApprovalEnabled!(
          ctx,
          snapshotWith({ environment: "dev" }),
        ),
      ).toBe(false);
    });
  });

  describe("publishFootprint", () => {
    it("binds to the connection's environment", () => {
      expect(
        sdkConnectionAdapter.publishFootprint!(
          makeContext({}),
          baseSnapshot,
          replaceSettings({ name: "Renamed" }),
        ),
      ).toEqual({ scope: "environments", environments: ["production"] });
    });

    it("covers both environments when the revision moves the connection", () => {
      expect(
        sdkConnectionAdapter.publishFootprint!(
          makeContext({}),
          baseSnapshot,
          replaceSettings({ environment: "staging" }),
        ),
      ).toEqual({
        scope: "environments",
        environments: ["production", "staging"],
      });
    });

    it("never collapses to an empty footprint for an archive flip", () => {
      expect(
        sdkConnectionAdapter.publishFootprint!(
          makeContext({}),
          baseSnapshot,
          replaceSettings({ archived: true }),
        ),
      ).toEqual({ scope: "environments", environments: ["production"] });
    });
  });

  describe("revision action hooks", () => {
    it("scope publish / revert / delete to the connection's projects and environment", () => {
      const canRevisionAction = jest.fn(() => true);
      const ctx = makeContext({ permissions: { canRevisionAction } });
      sdkConnectionAdapter.canPublishRevision!(ctx, baseSnapshot);
      sdkConnectionAdapter.canRevert!(ctx, baseSnapshot);
      sdkConnectionAdapter.canDeleteEntity!(ctx, baseSnapshot);
      for (const [i, action] of ["publish", "revert", "delete"].entries()) {
        expect(canRevisionAction).toHaveBeenNthCalledWith(
          i + 1,
          "sdk-connection",
          action,
          { projects: ["prj-1"] },
          ["production"],
        );
      }
    });

    it("judges review on the caller's change-aware footprint when given", () => {
      const canRevisionAction = jest.fn(() => true);
      const ctx = makeContext({ permissions: { canRevisionAction } });
      sdkConnectionAdapter.canReview!(ctx, baseSnapshot, [
        "production",
        "staging",
      ]);
      expect(canRevisionAction).toHaveBeenCalledWith(
        "sdk-connection",
        "review",
        { projects: ["prj-1"] },
        ["production", "staging"],
      );
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
        baseSnapshot.sdkConnection,
        {},
      );
    });

    it("canBypassApproval requires bypass on every project", () => {
      const partialDeny = jest.fn(
        ({ project }: { project: string }) => project !== "prj-2",
      );
      const ctx = makeContext({
        permissions: { canBypassSDKConnectionApprovalChecks: partialDeny },
      });
      expect(
        sdkConnectionAdapter.canBypassApproval(
          ctx,
          snapshotWith({ projects: ["prj-1", "prj-2"] }),
        ),
      ).toBe(false);
    });

    it("canBypassApproval treats no-projects as the empty global project", () => {
      const canBypassSDKConnectionApprovalChecks = jest.fn(() => true);
      const ctx = makeContext({
        permissions: { canBypassSDKConnectionApprovalChecks },
      });
      expect(
        sdkConnectionAdapter.canBypassApproval(
          ctx,
          snapshotWith({ projects: [] }),
        ),
      ).toBe(true);
      expect(canBypassSDKConnectionApprovalChecks).toHaveBeenCalledWith({
        project: "",
      });
    });
  });

  describe("assertPublishable", () => {
    const revision = buildRevision([], baseSnapshot);
    const assert = (
      ctx: Context,
      desiredState: Record<string, unknown>,
      entity: SDKConnectionRevisionSnapshot = liveEntity,
    ) =>
      sdkConnectionAdapter.assertPublishable!(
        ctx,
        entity,
        desiredState,
        revision,
      );

    it.each([
      ["encryptPayload", "encrypt-features-endpoint"],
      ["hashSecureAttributes", "hash-secure-attributes"],
      ["remoteEvalEnabled", "remote-evaluation"],
    ])(
      "rejects enabling %s without the %s entitlement",
      async (field, feature) => {
        await expect(
          assert(makeContext({}), {
            sdkConnection: settings({ [field]: true }),
          }),
        ).rejects.toThrow(feature);
        await expect(
          assert(makeContext({ premiumFeatures: [feature] }), {
            sdkConnection: settings({ [field]: true }),
          }),
        ).resolves.toBeUndefined();
      },
    );

    it("only gates the off→on transition for a premium setting", async () => {
      const entity = snapshotWith({ encryptPayload: true });
      await expect(
        assert(
          makeContext({}),
          { sdkConnection: settings({ encryptPayload: true }) },
          entity,
        ),
      ).resolves.toBeUndefined();
    });

    it("rejects clearing projects when the org requires one", async () => {
      await expect(
        assert(makeContext({ requireProjectForSdkConnections: true }), {
          sdkConnection: settings({ projects: [] }),
        }),
      ).rejects.toThrow("at least one project");
      await expect(
        assert(makeContext({ requireProjectForSdkConnections: false }), {
          sdkConnection: settings({ projects: [] }),
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects settings the snapshot schema does not know", async () => {
      await expect(
        assert(makeContext({}), {
          sdkConnection: { ...baseSnapshot.sdkConnection, encryptionKey: "x" },
        }),
      ).rejects.toThrow();
    });

    it("enforces the single-webhook limit without multiple-sdk-webhooks", async () => {
      const added = [{ ...baseWebhook, id: "wh-new" }];
      await expect(
        assert(makeContext({ webhookCount: 1 }), { sdkWebhooks: added }),
      ).rejects.toThrow("webhook limit");
      await expect(
        assert(makeContext({ webhookCount: 0 }), { sdkWebhooks: added }),
      ).resolves.toBeUndefined();
    });

    it("lets a revision swap the only webhook under the limit", async () => {
      const entity = snapshotWith({}, [baseWebhook]);
      await expect(
        assert(
          makeContext({ webhookCount: 1 }),
          { sdkWebhooks: [{ ...baseWebhook, id: "wh-new" }] },
          entity,
        ),
      ).resolves.toBeUndefined();
    });

    it("skips the webhook count entirely with the entitlement", async () => {
      const ctx = makeContext({
        premiumFeatures: ["multiple-sdk-webhooks"],
        webhookCount: 5,
      });
      await expect(
        assert(ctx, { sdkWebhooks: [{ ...baseWebhook, id: "wh-new" }] }),
      ).resolves.toBeUndefined();
      expect(webhooksModel(ctx).countSdkWebhooksByOrg).not.toHaveBeenCalled();
    });

    it("rejects a malformed webhook list", async () => {
      await expect(
        assert(makeContext({}), { sdkWebhooks: [{ id: "wh-x" }] }),
      ).rejects.toThrow();
    });
  });

  describe("applyChanges", () => {
    it("filters to differing updatable settings and writes via editSDKConnection", async () => {
      const ctx = makeContext({});
      const onPersisted = jest.fn();

      const result = await sdkConnectionAdapter.applyChanges(
        ctx,
        liveEntity,
        {
          sdkConnection: {
            ...baseSnapshot.sdkConnection,
            name: "New Name",
            encryptPayload: true,
            proxyHost: "https://proxy.example.com",
            organization: "other-org",
            id: "sdk-2",
          },
        },
        { onPersisted },
      );

      expect(mockedFind).toHaveBeenCalledWith(ctx, "sdk-1");
      expect(mockedEdit).toHaveBeenCalledTimes(1);
      const [, conn, changes] = mockedEdit.mock.calls[0];
      expect(conn).toBe(baseConnection);
      expect(changes).toEqual({ name: "New Name", encryptPayload: true });
      expect(result.persistedKeys).toEqual(["sdkConnection"]);
      expect(onPersisted).toHaveBeenCalledWith(result);
    });

    it("reports `written` in the getById shape, stamped by the write", async () => {
      const result = await sdkConnectionAdapter.applyChanges(
        makeContext({}),
        liveEntity,
        { sdkConnection: settings({ name: "New Name" }) },
      );
      expect(result.written).toEqual({
        id: "sdk-1",
        projects: ["prj-1"],
        dateUpdated: new Date("2025-02-01"),
        sdkConnection: settings({ name: "New Name" }),
        sdkWebhooks: [],
      });
    });

    it("carries the saved group format and prerequisite setting through", async () => {
      const ctx = makeContext({});

      await sdkConnectionAdapter.applyChanges(ctx, baseSnapshot, {
        sdkConnection: {
          ...baseSnapshot.sdkConnection,
          savedGroupFormat: "referencesV2",
          includeReferencedPrerequisites: false,
        },
      });

      const [, , changes] = mockedEdit.mock.calls[0];
      expect(changes).toEqual({
        savedGroupFormat: "referencesV2",
        includeReferencedPrerequisites: false,
      });
    });

    it("does not reload or write when there are no effective changes", async () => {
      const onPersisted = jest.fn();
      const result = await sdkConnectionAdapter.applyChanges(
        makeContext({}),
        liveEntity,
        { sdkConnection: settings({}), sdkWebhooks: [] },
        { onPersisted },
      );
      expect(mockedFind).not.toHaveBeenCalled();
      expect(mockedEdit).not.toHaveBeenCalled();
      expect(result).toEqual({ persistedKeys: [], written: null });
      expect(onPersisted).toHaveBeenCalledWith(result);
    });

    it("throws when the live connection can no longer be found", async () => {
      mockedFind.mockResolvedValue(null);
      await expect(
        sdkConnectionAdapter.applyChanges(makeContext({}), liveEntity, {
          sdkConnection: settings({ name: "New Name" }),
        }),
      ).rejects.toThrow("Could not find SDK Connection");
      expect(mockedEdit).not.toHaveBeenCalled();
    });

    it("guarded: conditions the write on the landing baseline stamp, not the re-read", async () => {
      // The re-read already moved past the baseline; the CAS must still carry
      // the baseline so the model's write loses the race.
      mockedFind.mockResolvedValue({
        ...baseConnection,
        dateUpdated: new Date("2025-01-03"),
      });
      await sdkConnectionAdapter.applyChanges(
        makeContext({}),
        liveEntity,
        { sdkConnection: settings({ name: "New Name" }) },
        { guarded: true },
      );
      expect(mockedEdit).toHaveBeenCalledTimes(1);
      expect(mockedEdit.mock.calls[0][3]).toEqual({
        casOnDateUpdated: new Date("2025-01-02"),
      });
    });

    it("guarded: a baseline with no stamp guards on an unstamped connection", async () => {
      await sdkConnectionAdapter.applyChanges(
        makeContext({}),
        baseSnapshot,
        { sdkConnection: settings({ name: "New Name" }) },
        { guarded: true },
      );
      expect(mockedEdit.mock.calls[0][3]).toEqual({ casOnDateUpdated: null });
    });

    it("guarded: a lost CAS propagates and reports nothing persisted", async () => {
      const onPersisted = jest.fn();
      mockedEdit.mockRejectedValue(new CasConflictError());
      await expect(
        sdkConnectionAdapter.applyChanges(
          makeContext({}),
          liveEntity,
          { sdkConnection: settings({ name: "New Name" }) },
          { guarded: true, onPersisted },
        ),
      ).rejects.toBeInstanceOf(CasConflictError);
      expect(onPersisted).not.toHaveBeenCalled();
    });

    it("unguarded: writes without a CAS condition", async () => {
      mockedFind.mockResolvedValue({
        ...baseConnection,
        dateUpdated: new Date("2025-01-03"),
      });
      await sdkConnectionAdapter.applyChanges(makeContext({}), liveEntity, {
        sdkConnection: settings({ name: "New Name" }),
      });
      expect(mockedEdit).toHaveBeenCalledTimes(1);
      expect(mockedEdit.mock.calls[0][3]).toBeUndefined();
    });

    it("checks the destination scope when a revision relocates the connection", async () => {
      const canUpdateSDKConnection = jest.fn(() => false);
      const ctx = makeContext({ permissions: { canUpdateSDKConnection } });
      await expect(
        sdkConnectionAdapter.applyChanges(ctx, liveEntity, {
          sdkConnection: settings({ environment: "staging", projects: [] }),
        }),
      ).rejects.toThrow("permission denied");
      expect(canUpdateSDKConnection).toHaveBeenCalledWith(baseConnection, {
        projects: [],
        environment: "staging",
      });
      expect(mockedEdit).not.toHaveBeenCalled();
    });

    it("creates, updates and deletes webhooks against the baseline list", async () => {
      const ctx = makeContext({});
      const entity = {
        ...liveEntity,
        sdkWebhooks: [baseWebhook, { ...baseWebhook, id: "wh-2", name: "Two" }],
      };
      const proposed = [
        { ...baseWebhook, name: "Renamed" },
        { ...baseWebhook, id: "temp_3", name: "Three" },
      ];
      const result = await sdkConnectionAdapter.applyChanges(ctx, entity, {
        sdkWebhooks: proposed,
      });
      const model = webhooksModel(ctx);
      expect(model.create).toHaveBeenCalledTimes(1);
      expect(model.create.mock.calls[0][0]).toMatchObject({
        sdks: ["sdk-1"],
        name: "Three",
      });
      expect(model.create.mock.calls[0][0]).not.toHaveProperty("id");
      expect(model.update).toHaveBeenCalledTimes(1);
      expect(model.update.mock.calls[0][1]).toMatchObject({ name: "Renamed" });
      expect(model.delete).toHaveBeenCalledTimes(1);
      expect(model.delete.mock.calls[0][0]).toEqual({ id: "wh-2" });
      expect(mockedEdit).not.toHaveBeenCalled();
      expect(result.persistedKeys).toEqual(["sdkWebhooks"]);
      expect(result.written).toEqual({
        id: "sdk-1",
        projects: ["prj-1"],
        dateUpdated: new Date("2025-01-02"),
        sdkConnection: baseSnapshot.sdkConnection,
        sdkWebhooks: proposed,
      });
    });

    it("keeps a non-temp snapshot id when creating a webhook", async () => {
      const ctx = makeContext({});
      await sdkConnectionAdapter.applyChanges(ctx, liveEntity, {
        sdkWebhooks: [{ ...baseWebhook, id: "wh-kept" }],
      });
      expect(webhooksModel(ctx).create.mock.calls[0][0]).toMatchObject({
        id: "wh-kept",
      });
    });

    it("reports both keys when settings and webhooks change together", async () => {
      const onPersisted = jest.fn();
      const result = await sdkConnectionAdapter.applyChanges(
        makeContext({}),
        liveEntity,
        {
          sdkConnection: settings({ name: "New Name" }),
          sdkWebhooks: [baseWebhook],
        },
        { onPersisted },
      );
      expect(onPersisted).toHaveBeenCalledTimes(2);
      expect(onPersisted.mock.calls[0][0].persistedKeys).toEqual([
        "sdkConnection",
      ]);
      expect(result.persistedKeys).toEqual(["sdkConnection", "sdkWebhooks"]);
      expect(result.written).toMatchObject({
        dateUpdated: new Date("2025-02-01"),
        sdkConnection: settings({ name: "New Name" }),
        sdkWebhooks: [baseWebhook],
      });
    });

    it("refuses webhook changes without the env-scoped SDK webhook permission", async () => {
      const ctx = makeContext({
        permissions: { canDeleteSDKWebhook: () => false },
      });
      await expect(
        sdkConnectionAdapter.applyChanges(ctx, liveEntity, {
          sdkWebhooks: [baseWebhook],
        }),
      ).rejects.toThrow("permission denied");
      expect(webhooksModel(ctx).create).not.toHaveBeenCalled();
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
