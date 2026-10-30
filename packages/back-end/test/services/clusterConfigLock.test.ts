import { ExperimentInterface } from "shared/types/experiment";
import { CLUSTER_CONFIG_LOCKED_MESSAGE } from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { assertClusterConfigUnlocked } from "back-end/src/services/experiments";
import type { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

const context = {} as unknown as ReqContext;

// Saved before identifiers were stored, so the cluster comes from the query.
const experiment = {
  status: "running",
  linkedFeatures: ["feature_1"],
  isClusterExperiment: true,
  clusterSubUnitIdentifier: "user_id",
  datasource: "ds_1",
  exposureQueryId: "by_region",
  exposureQueryIdentifierType: undefined,
} as unknown as ExperimentInterface;

describe("assertClusterConfigUnlocked", () => {
  beforeEach(() => {
    jest.mocked(getDataSourceById).mockResolvedValue({
      id: "ds_1",
      settings: {
        queries: {
          exposure: [
            {
              id: "by_region",
              userIdType: "region_id",
              userIdTypes: ["region_id", "user_id"],
            },
            {
              id: "by_store",
              userIdType: "store_id",
              userIdTypes: ["store_id", "user_id"],
            },
          ],
        },
      },
    } as unknown as Awaited<ReturnType<typeof getDataSourceById>>);
  });

  it("blocks a query that changes a cluster identifier resolved from the query", async () => {
    await expect(
      assertClusterConfigUnlocked(context, experiment, {
        datasource: "ds_1",
        exposureQueryId: "by_store",
        exposureQueryIdentifierType: undefined,
      }),
    ).rejects.toThrow(CLUSTER_CONFIG_LOCKED_MESSAGE);
  });

  it("allows the same cluster identifier when it's stored explicitly", async () => {
    await expect(
      assertClusterConfigUnlocked(context, experiment, {
        datasource: "ds_1",
        exposureQueryId: "by_region",
        exposureQueryIdentifierType: "region_id",
      }),
    ).resolves.toBeUndefined();
  });
});
