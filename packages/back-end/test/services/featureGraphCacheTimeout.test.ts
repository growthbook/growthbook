import { getOrgFeatureGraph } from "back-end/src/services/featureGraphCache";
import { fetchAllFeaturesForStaleGraphUnfiltered } from "back-end/src/models/FeatureModel";
import { fetchAllExperimentsForStaleGraphUnfiltered } from "back-end/src/models/ExperimentModel";
import { getRevisionsByStatus } from "back-end/src/models/FeatureRevisionModel";
import { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/FeatureModel", () => ({
  fetchAllFeaturesForStaleGraphUnfiltered: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  fetchAllExperimentsForStaleGraphUnfiltered: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevisionsByStatus: jest.fn(),
}));
// FEATURE_GRAPH_LOAD_TIMEOUT_MS is a module-load-time constant (secrets.ts
// convention), so the deadline behavior gets its own test file with the knob
// mocked small enough for real timers.
jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  FEATURE_GRAPH_LOAD_TIMEOUT_MS: 20,
}));

const mockFetchFeatures = fetchAllFeaturesForStaleGraphUnfiltered as jest.Mock;
const mockFetchExperiments =
  fetchAllExperimentsForStaleGraphUnfiltered as jest.Mock;
const mockGetRevisions = getRevisionsByStatus as jest.Mock;

const makeContext = (orgId: string): ReqContext =>
  ({
    org: { id: orgId },
    permissions: { canReadSingleProjectResource: () => true },
  }) as unknown as ReqContext;

describe("featureGraphCache load deadline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchExperiments.mockResolvedValue([]);
    mockGetRevisions.mockResolvedValue([]);
  });

  it("rejects a hung load and recovers on the next request", async () => {
    // A load that never settles must not pin the org: the deadline rejects,
    // the failed-load eviction drops the entry, and the next request retries.
    mockFetchFeatures.mockReturnValueOnce(new Promise(() => undefined));
    const ctx = makeContext("org1");
    await expect(getOrgFeatureGraph(ctx)).rejects.toThrow(
      "org feature-graph load exceeded 20ms",
    );

    // The rejected entry self-evicts asynchronously.
    await new Promise((resolve) => setImmediate(resolve));

    mockFetchFeatures.mockResolvedValue([
      { id: "f1", project: "", archived: false },
    ]);
    const graph = await getOrgFeatureGraph(ctx);
    expect(graph.features.map((f) => f.id)).toEqual(["f1"]);
    expect(mockFetchFeatures).toHaveBeenCalledTimes(2);
  });
});
