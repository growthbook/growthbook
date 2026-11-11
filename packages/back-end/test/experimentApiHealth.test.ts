import { ExperimentInterface } from "shared/validators";
import { ReqContext } from "back-end/types/organization";
import { toExperimentApiInterface } from "back-end/src/services/experiments";

const context = {
  org: { id: "org_1", settings: {} },
  models: { projects: { getById: async () => null } },
} as unknown as ReqContext;

function experiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_1",
    organization: "org_1",
    trackingKey: "my-experiment",
    name: "My Experiment",
    project: "",
    owner: "u_1",
    dateCreated: new Date("2024-01-01"),
    dateUpdated: new Date("2024-01-02"),
    tags: [],
    variations: [
      { id: "v0", key: "0", name: "Control", screenshots: [] },
      { id: "v1", key: "1", name: "Variation 1", screenshots: [] },
    ],
    archived: false,
    status: "running",
    hashAttribute: "id",
    hashVersion: 2,
    autoSnapshots: false,
    releasedVariationId: "",
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    phases: [
      {
        name: "Main",
        dateStarted: new Date("2024-03-01T00:00:00.000Z"),
        reason: "",
        coverage: 1,
        condition: "",
        variationWeights: [0.5, 0.5],
        variations: [],
      },
    ],
    ...overrides,
  } as unknown as ExperimentInterface;
}

describe("toExperimentApiInterface health fields", () => {
  it("passes alert markers through", async () => {
    const api = await toExperimentApiInterface(
      context,
      experiment({ pastNotifications: ["srm", "multiple-exposures"] }),
    );
    expect(api.pastNotifications).toEqual(["srm", "multiple-exposures"]);
  });

  it("returns an empty marker list when none are stored", async () => {
    const api = await toExperimentApiInterface(context, experiment());
    expect(api.pastNotifications).toEqual([]);
  });

  it("omits analysisSummary when the experiment has none", async () => {
    const api = await toExperimentApiInterface(context, experiment());
    expect(api).not.toHaveProperty("analysisSummary");
  });

  it("emits only the snapshot id and health counts", async () => {
    const api = await toExperimentApiInterface(
      context,
      experiment({
        analysisSummary: {
          snapshotId: "snp_1",
          health: {
            srm: 0.0004,
            multipleExposures: 12,
            totalUsers: 1000,
            power: { type: "error", errorMessage: "no power" },
          },
          resultsStatus: {
            variations: [],
            settings: { sequentialTesting: false },
          },
        },
      } as unknown as Partial<ExperimentInterface>),
    );
    expect(api.analysisSummary).toEqual({
      snapshotId: "snp_1",
      health: { srm: 0.0004, multipleExposures: 12, totalUsers: 1000 },
    });
  });

  it("omits health when the summary has none", async () => {
    const api = await toExperimentApiInterface(
      context,
      experiment({ analysisSummary: { snapshotId: "snp_2" } }),
    );
    expect(api.analysisSummary).toEqual({ snapshotId: "snp_2" });
  });

  it("rounds a subnormal SRM p-value", async () => {
    const api = await toExperimentApiInterface(
      context,
      experiment({
        analysisSummary: {
          snapshotId: "snp_3",
          health: { srm: 2.7e-313, multipleExposures: 0, totalUsers: null },
        },
      }),
    );
    expect(api.analysisSummary?.health?.srm).toBe(0);
    expect(api.analysisSummary?.health?.totalUsers).toBeNull();
  });

  it("returns a null SRM when the stored p-value isn't finite", async () => {
    const api = await toExperimentApiInterface(
      context,
      experiment({
        analysisSummary: {
          snapshotId: "snp_4",
          health: { srm: NaN, multipleExposures: 0, totalUsers: 10 },
        },
      }),
    );
    expect(api.analysisSummary?.health?.srm).toBeNull();
  });
});
