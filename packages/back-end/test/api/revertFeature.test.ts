import type { OrganizationInterface } from "shared/types/organization";
import type { EventUser } from "shared/types/events/event-types";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  createAndPublishRevision: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentMapForFeature: jest.fn(),
}));

jest.mock("back-end/src/services/features", () => ({
  getApiFeatureObj: jest.fn(),
  getSavedGroupMap: jest.fn(),
}));

jest.mock("back-end/src/services/audit", () => ({
  auditDetailsUpdate: jest.fn(() => ({})),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getEnvironments: jest.fn(() => [
    { id: "production", description: "" },
    { id: "dev", description: "" },
  ]),
}));

jest.mock("back-end/src/util/features", () => ({
  getEnabledEnvironments: jest.fn(() => new Set(["production", "dev"])),
}));

jest.mock("back-end/src/util/organization.util", () => ({
  getEnvironmentIdsFromOrg: jest.fn(() => ["production", "dev"]),
}));

import { revertFeatureCore } from "back-end/src/api/features/revertFeature";
import {
  createAndPublishRevision,
  getFeature,
} from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";

const mockGetFeature = getFeature as jest.MockedFunction<typeof getFeature>;
const mockGetRevision = getRevision as jest.MockedFunction<typeof getRevision>;
const mockCreateAndPublish = createAndPublishRevision as jest.MockedFunction<
  typeof createAndPublishRevision
>;
const mockGetExperimentMap = getExperimentMapForFeature as jest.MockedFunction<
  typeof getExperimentMapForFeature
>;

const ctx = {
  org: { id: "org_1", settings: {} },
  permissions: {
    canUpdateFeature: jest.fn(() => true),
    canPublishFeature: jest.fn(() => true),
    canBypassApprovalChecks: jest.fn(() => true),
    throwPermissionError: jest.fn(() => {
      throw new Error("forbidden");
    }),
  },
  hasPremiumFeature: jest.fn(() => true),
  models: {
    safeRollout: {
      getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
    },
  },
} as never;

const org = { id: "org_1", settings: {} } as unknown as OrganizationInterface;
const eventAudit = { type: "api_key" } as unknown as EventUser;

function makeFeature(overrides: Record<string, unknown> = {}) {
  return {
    id: "feat_1",
    organization: "org_1",
    version: 5,
    defaultValue: "live-default",
    rules: [],
    environmentSettings: {
      production: { enabled: true },
      dev: { enabled: true },
    },
    prerequisites: [],
    description: "live description",
    owner: "live owner",
    project: "",
    tags: [],
    ...overrides,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetExperimentMap.mockResolvedValue(new Map() as never);
});

describe("revertFeatureCore empty-diff guard", () => {
  it("throws 'Nothing to revert' when target revision matches the live feature", async () => {
    mockGetFeature.mockResolvedValue(makeFeature());
    // Sparse legacy revision with no envelope fields and the same defaultValue
    // and rules as the live feature — diff comes back empty.
    mockGetRevision.mockResolvedValue({
      version: 3,
      status: "published",
      defaultValue: "live-default",
      rules: [],
    } as never);

    await expect(
      revertFeatureCore(
        ctx,
        org,
        eventAudit,
        { id: "feat_1" },
        { revision: 3 },
        jest.fn(),
        false,
      ),
    ).rejects.toThrow(/Nothing to revert/);

    expect(mockCreateAndPublish).not.toHaveBeenCalled();
  });

  it("proceeds to createAndPublishRevision when defaultValue differs", async () => {
    mockGetFeature.mockResolvedValue(makeFeature());
    mockGetRevision.mockResolvedValue({
      version: 3,
      status: "published",
      defaultValue: "old-default",
      rules: [],
    } as never);
    const updatedFeature = makeFeature({
      version: 6,
      defaultValue: "old-default",
    });
    mockCreateAndPublish.mockResolvedValue({
      revision: { version: 6 } as never,
      updatedFeature,
    });

    await revertFeatureCore(
      ctx,
      org,
      eventAudit,
      { id: "feat_1" },
      { revision: 3 },
      jest.fn(),
      false,
    );

    expect(mockCreateAndPublish).toHaveBeenCalledTimes(1);
    expect(mockCreateAndPublish.mock.calls[0][0].changes).toEqual({
      defaultValue: "old-default",
    });
  });

  it("restores the target revision's default value overrides", async () => {
    // Live feature has prod overridden to "live-prod"; the target revision had
    // it set to "old-prod". Revert should restore the old override list.
    mockGetFeature.mockResolvedValue(
      makeFeature({
        defaultValueOverrides: [
          { id: "live", value: "live-prod", environments: ["production"] },
        ],
      }),
    );
    const targetOverrides = [
      { id: "old", value: "old-prod", environments: ["production"] },
    ];
    mockGetRevision.mockResolvedValue({
      version: 3,
      status: "published",
      defaultValue: "live-default",
      rules: [],
      defaultValueOverrides: targetOverrides,
    } as never);
    mockCreateAndPublish.mockResolvedValue({
      revision: { version: 6 } as never,
      updatedFeature: makeFeature({ version: 6 }),
    });

    await revertFeatureCore(
      ctx,
      org,
      eventAudit,
      { id: "feat_1" },
      { revision: 3 },
      jest.fn(),
      false,
    );

    expect(mockCreateAndPublish).toHaveBeenCalledTimes(1);
    expect(mockCreateAndPublish.mock.calls[0][0].changes).toEqual({
      defaultValueOverrides: targetOverrides,
    });
  });

  it("clears overrides the target revision did not have (full-replace)", async () => {
    // Live feature has prod overridden, but the target revision had no overrides.
    // Revert carries the COMPLETE target snapshot ([]), so publishing full-
    // replaces and clears the override (inherit the base default again).
    mockGetFeature.mockResolvedValue(
      makeFeature({
        defaultValueOverrides: [
          { id: "live", value: "live-prod", environments: ["production"] },
        ],
      }),
    );
    mockGetRevision.mockResolvedValue({
      version: 3,
      status: "published",
      defaultValue: "live-default",
      rules: [],
      // Field present but empty — the clear case.
      defaultValueOverrides: [],
    } as never);
    mockCreateAndPublish.mockResolvedValue({
      revision: { version: 6 } as never,
      updatedFeature: makeFeature({ version: 6 }),
    });

    await revertFeatureCore(
      ctx,
      org,
      eventAudit,
      { id: "feat_1" },
      { revision: 3 },
      jest.fn(),
      false,
    );

    expect(mockCreateAndPublish).toHaveBeenCalledTimes(1);
    expect(mockCreateAndPublish.mock.calls[0][0].changes).toEqual({
      defaultValueOverrides: [],
    });
  });
});
