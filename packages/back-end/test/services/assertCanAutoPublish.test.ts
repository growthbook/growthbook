import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ReqContext } from "shared/types/organization";
import { assertCanAutoPublish } from "back-end/src/services/features";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { ApprovalRequiredError } from "back-end/src/util/errors";

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
}));

// services/features transitively pulls in the Presto integration, whose
// kerberos native module is not built in every dev environment.
jest.mock("back-end/src/util/kerberos.util", () => ({
  getKerberosHeader: jest.fn(),
}));

jest.mock("back-end/src/models/SdkConnectionCacheModel", () => ({
  getSDKPayloadCacheLocation: jest.fn().mockReturnValue("none"),
  SdkConnectionCacheModel: jest.fn(),
}));

jest.mock("back-end/src/init/config", () => ({
  usingFileConfig: false,
  getConfigMetrics: jest.fn().mockReturnValue([]),
  getConfigDimensions: jest.fn().mockReturnValue([]),
  getConfigSegments: jest.fn().mockReturnValue([]),
  getConfigOrganizationSettings: jest.fn().mockReturnValue({}),
}));

jest.mock("back-end/src/services/python", () => ({
  statsServerPool: { acquire: jest.fn(), release: jest.fn() },
}));

const getRevisionMock = getRevision as jest.MockedFunction<typeof getRevision>;

const feature = {
  id: "feature",
  organization: "org_1",
  project: "",
  version: 3,
  valueType: "string",
  defaultValue: "control",
  environmentSettings: { production: { enabled: true } },
  rules: [],
} as unknown as FeatureInterface;

// A draft off live that changes a rule in production — review-worthy whenever
// the org asks for review.
const draft = {
  organization: "org_1",
  featureId: "feature",
  version: 4,
  baseVersion: 3,
  status: "draft",
  rules: [
    {
      id: "fr_1",
      type: "force",
      description: "",
      value: "treatment",
      condition: "",
      enabled: true,
      allEnvironments: true,
    },
  ],
  environmentsEnabled: { production: true },
} as unknown as FeatureRevisionInterface;

const liveRevision = {
  organization: "org_1",
  featureId: "feature",
  version: 3,
  baseVersion: 3,
  status: "published",
  rules: [],
  environmentsEnabled: { production: true },
} as unknown as FeatureRevisionInterface;

function makeContext({
  requireReviews,
  canBypass = false,
  licensed = true,
}: {
  requireReviews?: unknown;
  canBypass?: boolean;
  licensed?: boolean;
}) {
  const throwPermissionError = jest.fn(() => {
    throw new Error("You do not have permission to perform this action");
  });
  return {
    org: {
      id: "org_1",
      settings: {
        environments: [{ id: "production" }],
        ...(requireReviews === undefined ? {} : { requireReviews }),
      },
    },
    hasPremiumFeature: () => licensed,
    permissions: {
      canBypassFlagApprovalChecks: () => canBypass,
      throwPermissionError,
    },
  } as unknown as ReqContext;
}

describe("assertCanAutoPublish", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRevisionMock.mockResolvedValue(liveRevision);
  });

  describe("approvals off", () => {
    it("allows an implicit publish (respectApprovalFlow) with no review settings", async () => {
      const context = makeContext({});
      await expect(
        assertCanAutoPublish(context, feature, draft, {
          respectApprovalFlow: true,
        }),
      ).resolves.toBeUndefined();
    });

    it("allows an implicit publish when requireReviews is explicitly false", async () => {
      const context = makeContext({ requireReviews: false });
      await expect(
        assertCanAutoPublish(context, feature, draft, {
          respectApprovalFlow: true,
        }),
      ).resolves.toBeUndefined();
    });

    it("allows an implicit publish when every project rule has requireReviewOn: false", async () => {
      const context = makeContext({
        requireReviews: [{ requireReviewOn: false, projects: [] }],
      });
      await expect(
        assertCanAutoPublish(context, feature, draft, {
          respectApprovalFlow: true,
        }),
      ).resolves.toBeUndefined();
    });

    it("allows an implicit publish even when the base revision cannot be resolved", async () => {
      // Fail-closed on an unresolved base must not fire for an org that never
      // asks for review.
      getRevisionMock.mockResolvedValue(null);
      const context = makeContext({});
      await expect(
        assertCanAutoPublish(context, feature, draft, {
          respectApprovalFlow: true,
        }),
      ).resolves.toBeUndefined();
    });

    it("allows an implicit publish when approvals are unlicensed, even if configured", async () => {
      const context = makeContext({ requireReviews: true, licensed: false });
      await expect(
        assertCanAutoPublish(context, feature, draft, {
          respectApprovalFlow: true,
        }),
      ).resolves.toBeUndefined();
    });

    it("allows a normal auto-publish (default mode) for a caller who cannot bypass", async () => {
      const context = makeContext({ canBypass: false });
      await expect(
        assertCanAutoPublish(context, feature, draft),
      ).resolves.toBeUndefined();
    });
  });

  describe("approvals on", () => {
    it("refuses an implicit publish even for a caller who could bypass", async () => {
      const context = makeContext({ requireReviews: true, canBypass: true });
      await expect(
        assertCanAutoPublish(context, feature, draft, {
          respectApprovalFlow: true,
        }),
      ).rejects.toThrow(ApprovalRequiredError);
    });

    it("allows an implicit publish of an already-approved draft", async () => {
      const context = makeContext({ requireReviews: true, canBypass: false });
      await expect(
        assertCanAutoPublish(
          context,
          feature,
          { ...draft, status: "approved" } as FeatureRevisionInterface,
          { respectApprovalFlow: true },
        ),
      ).resolves.toBeUndefined();
    });

    it("still lets a bypass-capable caller auto-publish when bypass is allowed", async () => {
      const context = makeContext({ requireReviews: true, canBypass: true });
      await expect(
        assertCanAutoPublish(context, feature, draft),
      ).resolves.toBeUndefined();
    });

    it("blocks a caller who cannot bypass", async () => {
      const context = makeContext({ requireReviews: true, canBypass: false });
      await expect(
        assertCanAutoPublish(context, feature, draft),
      ).rejects.toThrow(/permission/i);
    });

    it("fails closed when the base revision cannot be resolved", async () => {
      getRevisionMock.mockResolvedValue(null);
      const context = makeContext({ requireReviews: true, canBypass: true });
      await expect(
        assertCanAutoPublish(context, feature, draft, {
          respectApprovalFlow: true,
        }),
      ).rejects.toThrow(ApprovalRequiredError);
    });
  });
});
