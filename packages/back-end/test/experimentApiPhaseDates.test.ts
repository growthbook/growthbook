import { ExperimentInterface } from "shared/validators";
import { ReqContext } from "back-end/types/organization";
import { toExperimentApiInterface } from "back-end/src/services/experiments";

// Legacy experiment docs can carry a phase with no dateStarted. The serializer
// must not throw on them: one bad phase used to 400 an entire page of
// GET /api/v1/experiments (issue #3841).
const context = {
  org: { id: "org_1", settings: {} },
  models: { projects: { getById: async () => null } },
} as unknown as ReqContext;

function experimentWithPhaseDate(
  dateStarted: Date | null,
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
        dateStarted,
        reason: "",
        coverage: 1,
        condition: "",
        variationWeights: [0.5, 0.5],
        variations: [],
      },
    ],
  } as unknown as ExperimentInterface;
}

describe("toExperimentApiInterface phase dates", () => {
  it("serializes a phase that has a start date", async () => {
    const api = await toExperimentApiInterface(
      context,
      experimentWithPhaseDate(new Date("2024-03-01T00:00:00.000Z")),
    );
    expect(api.phases[0].dateStarted).toBe("2024-03-01T00:00:00.000Z");
  });

  it("serializes a phase with a missing start date instead of throwing", async () => {
    const api = await toExperimentApiInterface(
      context,
      experimentWithPhaseDate(null),
    );
    expect(api.phases[0].dateStarted).toBe("");
    expect(api.phases[0].dateEnded).toBe("");
  });
});
