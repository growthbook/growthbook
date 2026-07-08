import { FeatureInterface } from "shared/types/feature";
import { updateSingleFeature } from "back-end/src/jobs/updateScheduledFeatures";
import {
  getNextScheduledUpdate,
  refreshSDKPayloadCache,
} from "back-end/src/services/features";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

jest.mock("back-end/src/models/FeatureModel", () => ({
  FeatureModel: { dangerousGetScheduledFeaturesToUpdate: jest.fn() },
}));

// Feature lookups/updates now go through ctx.models.features.
const mockGetById = jest.fn();
const mockUpdateNextScheduledDate = jest.fn();

jest.mock("back-end/src/services/features", () => ({
  getNextScheduledUpdate: jest.fn(),
  refreshSDKPayloadCache: jest.fn(),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
}));

// getSDKPayloadKeysByDiff is not mocked — the real implementation is used so
// we exercise the actual diff logic against nextScheduledUpdate changes.

const makeJob = (featureId = "feat_1", organization = "org_1") =>
  ({ attrs: { data: { featureId, organization } } }) as never;

const makeFeature = (overrides: Partial<FeatureInterface> = {}) =>
  ({
    id: "feat_1",
    organization: "org_1",
    environmentSettings: {
      production: { enabled: true, rules: [] },
    },
    nextScheduledUpdate: new Date("2026-03-09T00:00:00Z"),
    ...overrides,
  }) as FeatureInterface;

const makeContext = () => ({
  org: {
    id: "org_1",
    settings: { environments: [{ id: "production" }] },
  },
  environments: ["production"],
  models: {
    features: {
      getById: mockGetById,
      updateNextScheduledDate: mockUpdateNextScheduledDate,
    },
  },
});

describe("updateSingleFeature", () => {
  beforeEach(() => {
    (getContextForAgendaJobByOrgId as jest.Mock).mockResolvedValue(
      makeContext(),
    );
    mockGetById.mockResolvedValue(makeFeature());
    (getNextScheduledUpdate as jest.Mock).mockReturnValue(null);
    (refreshSDKPayloadCache as jest.Mock).mockResolvedValue(undefined);
    mockUpdateNextScheduledDate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("calls refreshSDKPayloadCache then updateNextScheduledDate on success", async () => {
    const order: string[] = [];
    (refreshSDKPayloadCache as jest.Mock).mockImplementation(async () => {
      order.push("refresh");
    });
    mockUpdateNextScheduledDate.mockImplementation(async () => {
      order.push("ack");
    });

    await updateSingleFeature(makeJob());

    // Allow the fire-and-forget .then() to settle
    await new Promise(process.nextTick);

    expect(order).toEqual(["refresh", "ack"]);
  });

  it("does not call updateNextScheduledDate when refreshSDKPayloadCache rejects", async () => {
    (refreshSDKPayloadCache as jest.Mock).mockRejectedValue(
      new Error("cache write failed"),
    );

    await updateSingleFeature(makeJob());
    await new Promise(process.nextTick);

    expect(mockUpdateNextScheduledDate).not.toHaveBeenCalled();
  });

  it("does nothing when the feature does not exist", async () => {
    mockGetById.mockResolvedValue(null);

    await updateSingleFeature(makeJob());

    expect(refreshSDKPayloadCache).not.toHaveBeenCalled();
    expect(mockUpdateNextScheduledDate).not.toHaveBeenCalled();
  });
});
