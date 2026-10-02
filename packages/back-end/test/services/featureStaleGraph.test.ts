import { loadStaleGraph } from "back-end/src/services/featureStaleGraph";
import { getFeaturesWithPrerequisitesOn } from "back-end/src/models/FeatureModel";
import { getAllExperimentsForStaleGraph } from "back-end/src/models/ExperimentModel";
import type { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeaturesWithPrerequisitesOn: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getAllExperimentsForStaleGraph: jest.fn(),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: jest.fn(() => ({})),
}));

// a <- b <- c (c depends on b, b on a); d is unrelated; b runs experiment exp_b
const features = [
  { id: "a", prerequisites: [] },
  {
    id: "b",
    prerequisites: [{ id: "a" }],
    rules: [{ type: "experiment-ref", experimentId: "exp_b" }],
  },
  { id: "c", prerequisites: [{ id: "b" }] },
  { id: "d", prerequisites: [] },
];

describe("loadStaleGraph", () => {
  beforeEach(() => {
    jest
      .mocked(getFeaturesWithPrerequisitesOn)
      .mockImplementation(
        async (_context, ids) =>
          features.filter(
            (f) =>
              ids.includes(f.id) ||
              f.prerequisites.some((p) => ids.includes(p.id)),
          ) as never,
      );
    jest
      .mocked(getAllExperimentsForStaleGraph)
      .mockImplementation(
        async (_context, { ids, prerequisiteIds } = {}) =>
          (ids
            ? ids.map((id) => ({ id }))
            : (prerequisiteIds ?? []).includes("c")
              ? [{ id: "exp_on_c" }]
              : []) as never,
      );
  });

  it("loads the requested flags, their transitive dependents and the experiments they touch", async () => {
    const graph = await loadStaleGraph({ org: {} } as ReqContext, ["a"]);
    expect(graph.features.map((f) => f.id).sort()).toEqual(["a", "b", "c"]);
    expect(graph.experiments.map((e) => e.id).sort()).toEqual([
      "exp_b",
      "exp_on_c",
    ]);
    // One query per dependency level: [a], then [b], then [c] finds nothing new
    expect(getFeaturesWithPrerequisitesOn).toHaveBeenCalledTimes(3);
  });
});
