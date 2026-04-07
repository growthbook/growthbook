import { FeatureInterface } from "shared/types/feature";
import { updateSingleFeature } from "back-end/src/jobs/updateScheduledFeatures";
import {
  getFeature,
  updateNextScheduledDate,
} from "back-end/src/models/FeatureModel";
import {
  getNextScheduledUpdate,
  refreshSDKPayloadCache,
} from "back-end/src/services/features";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  updateNextScheduledDate: jest.fn(),
  getScheduledFeaturesToUpdate: jest.fn(),
}));

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
});

describe("updateSingleFeature", () => {
  beforeEach(() => {
    (getContextForAgendaJobByOrgId as jest.Mock).mockResolvedValue(
      makeContext(),
    );
    (getFeature as jest.Mock).mockResolvedValue(makeFeature());
    (getNextScheduledUpdate as jest.Mock).mockReturnValue(null);
    (refreshSDKPayloadCache as jest.Mock).mockResolvedValue(undefined);
    (updateNextScheduledDate as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("calls refreshSDKPayloadCache then updateNextScheduledDate on success", async () => {
    const order: string[] = [];
    (refreshSDKPayloadCache as jest.Mock).mockImplementation(async () => {
      order.push("refresh");
    });
    (updateNextScheduledDate as jest.Mock).mockImplementation(async () => {
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

    expect(updateNextScheduledDate).not.toHaveBeenCalled();
  });

  it("does nothing when the feature does not exist", async () => {
    (getFeature as jest.Mock).mockResolvedValue(null);

    await updateSingleFeature(makeJob());

    expect(refreshSDKPayloadCache).not.toHaveBeenCalled();
    expect(updateNextScheduledDate).not.toHaveBeenCalled();
  });
});
