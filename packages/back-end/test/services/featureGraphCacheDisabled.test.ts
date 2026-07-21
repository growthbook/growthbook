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
// FEATURE_GRAPH_CACHE_TTL_MS is a module-load-time constant (secrets.ts
// convention), so the disabled path gets its own test file with the knob
// mocked to 0.
jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  FEATURE_GRAPH_CACHE_TTL_MS: 0,
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

describe("featureGraphCache with FEATURE_GRAPH_CACHE_TTL_MS=0", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchFeatures.mockResolvedValue([
      { id: "f1", project: "", archived: false },
    ]);
    mockFetchExperiments.mockResolvedValue([]);
    mockGetRevisions.mockResolvedValue([]);
  });

  it("bypasses the cache entirely — every request loads fresh", async () => {
    const ctx = makeContext("org1");
    await getOrgFeatureGraph(ctx);
    await getOrgFeatureGraph(ctx);
    expect(mockFetchFeatures).toHaveBeenCalledTimes(2);
  });
});
