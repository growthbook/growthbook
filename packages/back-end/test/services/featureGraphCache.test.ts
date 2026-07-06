import {
  FEATURE_GRAPH_TTL_MS,
  getOrgFeatureGraph,
  invalidateFeatureGraph,
} from "back-end/src/services/featureGraphCache";
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

const mockFetchFeatures = fetchAllFeaturesForStaleGraphUnfiltered as jest.Mock;
const mockFetchExperiments =
  fetchAllExperimentsForStaleGraphUnfiltered as jest.Mock;
const mockGetRevisions = getRevisionsByStatus as jest.Mock;

const makeContext = (
  orgId: string,
  canRead: (project?: string) => boolean = () => true,
): ReqContext =>
  ({
    org: { id: orgId },
    permissions: { canReadSingleProjectResource: canRead },
  }) as unknown as ReqContext;

const FEATURES = [
  { id: "f1", project: "", archived: false },
  { id: "f2", project: "proj-a", archived: false },
  { id: "f3", project: "proj-b", archived: true },
];
const EXPERIMENTS = [
  { id: "e1", project: "", archived: false },
  { id: "e2", project: "proj-a", archived: true },
];
const REVISIONS = [
  { featureId: "f1", dateUpdated: new Date("2026-01-01T00:00:00Z") },
  { featureId: "f1", dateUpdated: new Date("2026-02-01T00:00:00Z") },
  { featureId: "f2", dateUpdated: new Date("2026-01-15T00:00:00Z") },
];

describe("featureGraphCache", () => {
  let nowSpy: jest.SpyInstance<number, []>;
  let now: number;

  beforeEach(() => {
    invalidateFeatureGraph();
    jest.clearAllMocks();
    mockFetchFeatures.mockResolvedValue(FEATURES);
    mockFetchExperiments.mockResolvedValue(EXPERIMENTS);
    mockGetRevisions.mockResolvedValue(REVISIONS);
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it("loads once per org within the TTL window", async () => {
    const ctx = makeContext("org1");
    await getOrgFeatureGraph(ctx);
    await getOrgFeatureGraph(ctx);
    await getOrgFeatureGraph(ctx, { includeArchived: true });

    expect(mockFetchFeatures).toHaveBeenCalledTimes(1);
    expect(mockFetchExperiments).toHaveBeenCalledTimes(1);
    expect(mockGetRevisions).toHaveBeenCalledTimes(1);
    // The snapshot fetch is always the archived-inclusive superset.
    expect(mockFetchFeatures).toHaveBeenCalledWith(ctx, {
      includeArchived: true,
    });
  });

  it("shares one in-flight load across concurrent cold requests", async () => {
    let resolveFeatures!: (v: typeof FEATURES) => void;
    mockFetchFeatures.mockReturnValue(
      new Promise((resolve) => {
        resolveFeatures = resolve;
      }),
    );
    const ctx = makeContext("org1");
    const p1 = getOrgFeatureGraph(ctx);
    const p2 = getOrgFeatureGraph(ctx);
    resolveFeatures(FEATURES);
    await Promise.all([p1, p2]);
    expect(mockFetchFeatures).toHaveBeenCalledTimes(1);
  });

  it("keeps coalescing onto a load that outlives the TTL window", async () => {
    // A load slower than the TTL must not trigger extra loads — the
    // in-flight promise is served until it settles (expiry is stamped at
    // resolution, not at load start).
    let resolveFeatures!: (v: typeof FEATURES) => void;
    mockFetchFeatures.mockReturnValue(
      new Promise((resolve) => {
        resolveFeatures = resolve;
      }),
    );
    const ctx = makeContext("org1");
    const p1 = getOrgFeatureGraph(ctx);
    now += FEATURE_GRAPH_TTL_MS * 2;
    const p2 = getOrgFeatureGraph(ctx);
    resolveFeatures(FEATURES);
    await Promise.all([p1, p2]);
    expect(mockFetchFeatures).toHaveBeenCalledTimes(1);

    // And the late-resolving snapshot still gets a full TTL window from its
    // resolution time.
    await getOrgFeatureGraph(ctx);
    expect(mockFetchFeatures).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL window expires", async () => {
    const ctx = makeContext("org1");
    await getOrgFeatureGraph(ctx);
    // Jitter extends the window by at most 10% of the TTL.
    now += FEATURE_GRAPH_TTL_MS * 1.1 + 1;
    await getOrgFeatureGraph(ctx);
    expect(mockFetchFeatures).toHaveBeenCalledTimes(2);
  });

  it("caches per org, not globally", async () => {
    await getOrgFeatureGraph(makeContext("org1"));
    await getOrgFeatureGraph(makeContext("org2"));
    expect(mockFetchFeatures).toHaveBeenCalledTimes(2);
  });

  it("excludes archived entities unless includeArchived is set", async () => {
    const ctx = makeContext("org1");
    const graph = await getOrgFeatureGraph(ctx);
    expect(graph.features.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(graph.experiments.map((e) => e.id)).toEqual(["e1"]);

    const withArchived = await getOrgFeatureGraph(ctx, {
      includeArchived: true,
    });
    expect(withArchived.features.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(withArchived.experiments.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("applies each requester's permission filter to the shared snapshot", async () => {
    const restricted = makeContext("org1", (project) => project !== "proj-a");
    const unrestricted = makeContext("org1");

    const restrictedGraph = await getOrgFeatureGraph(restricted, {
      includeArchived: true,
    });
    const unrestrictedGraph = await getOrgFeatureGraph(unrestricted, {
      includeArchived: true,
    });

    // One underlying load; two different per-user views.
    expect(mockFetchFeatures).toHaveBeenCalledTimes(1);
    expect(restrictedGraph.features.map((f) => f.id)).toEqual(["f1", "f3"]);
    expect(restrictedGraph.experiments.map((e) => e.id)).toEqual(["e1"]);
    expect(unrestrictedGraph.features.map((f) => f.id)).toEqual([
      "f1",
      "f2",
      "f3",
    ]);
  });

  it("derives the most recent draft date per feature", async () => {
    const graph = await getOrgFeatureGraph(makeContext("org1"));
    expect(graph.mostRecentDraftDateByFeatureId.get("f1")).toEqual(
      new Date("2026-02-01T00:00:00Z"),
    );
    expect(graph.mostRecentDraftDateByFeatureId.get("f2")).toEqual(
      new Date("2026-01-15T00:00:00Z"),
    );
    expect(graph.mostRecentDraftDateByFeatureId.has("f3")).toBe(false);
  });

  it("hides draft dates for features the requester cannot read", async () => {
    const restricted = makeContext("org1", (project) => project !== "proj-a");
    const graph = await getOrgFeatureGraph(restricted);
    // f2 lives in proj-a — its draft activity must not be visible.
    expect(graph.mostRecentDraftDateByFeatureId.has("f2")).toBe(false);
    expect(graph.mostRecentDraftDateByFeatureId.has("f1")).toBe(true);
  });

  it("returns a per-request Map — caller mutation cannot poison the cache", async () => {
    const ctx = makeContext("org1");
    const first = await getOrgFeatureGraph(ctx);
    first.mostRecentDraftDateByFeatureId.clear();
    const second = await getOrgFeatureGraph(ctx);
    expect(second.mostRecentDraftDateByFeatureId.size).toBe(2);
  });

  it("exposes the snapshot load time", async () => {
    const graph = await getOrgFeatureGraph(makeContext("org1"));
    expect(graph.loadedAt).toBeInstanceOf(Date);
  });

  it("does not cache a failed load", async () => {
    mockFetchFeatures.mockRejectedValueOnce(new Error("mongo down"));
    const ctx = makeContext("org1");
    await expect(getOrgFeatureGraph(ctx)).rejects.toThrow("mongo down");
    // The rejected entry self-evicts asynchronously.
    await new Promise((resolve) => setImmediate(resolve));
    const graph = await getOrgFeatureGraph(ctx);
    expect(graph.features.length).toBeGreaterThan(0);
    expect(mockFetchFeatures).toHaveBeenCalledTimes(2);
  });

  it("invalidate forces a refetch within the TTL window", async () => {
    const ctx = makeContext("org1");
    await getOrgFeatureGraph(ctx);
    invalidateFeatureGraph("org1");
    await getOrgFeatureGraph(ctx);
    expect(mockFetchFeatures).toHaveBeenCalledTimes(2);
  });

  it("bounds the number of cached orgs", async () => {
    // Zero out the expiry jitter so eviction order follows load order.
    const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0);
    try {
      for (let i = 0; i < 60; i++) {
        now += 1;
        await getOrgFeatureGraph(makeContext(`org${i}`));
      }
      expect(mockFetchFeatures).toHaveBeenCalledTimes(60);
      // org0 (soonest-expiring) was evicted to make room, so re-reading it
      // loads again...
      await getOrgFeatureGraph(makeContext("org0"));
      expect(mockFetchFeatures).toHaveBeenCalledTimes(61);
      // ...while a recently-loaded org is still served from cache.
      await getOrgFeatureGraph(makeContext("org59"));
      expect(mockFetchFeatures).toHaveBeenCalledTimes(61);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
