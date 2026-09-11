import {
  postExperimentValidator,
  updateExperimentValidator,
} from "../../src/validators/experiments";

const body = (phase: Record<string, unknown>) => ({
  datasourceId: "ds_1",
  assignmentQueryId: "user_id",
  trackingKey: "exp-key",
  name: "My experiment",
  variations: [
    { key: "0", name: "Control" },
    { key: "1", name: "Treatment" },
  ],
  phases: [{ name: "Main", dateStarted: "2026-01-01T00:00:00Z", ...phase }],
});

const split = (a: number, b: number) => [
  { variationId: "var_a", weight: a },
  { variationId: "var_b", weight: b },
];

describe.each([
  ["postExperiment body", postExperimentValidator.bodySchema],
  ["updateExperiment body", updateExperimentValidator.bodySchema],
] as const)("%s phase coverage / weight bounds", (_name, schema) => {
  const parse = (phase: Record<string, unknown>) =>
    schema.safeParse(body(phase));

  it("accepts coverage and weights within [0, 1]", () => {
    expect(
      parse({
        coverage: 0.5,
        variationWeights: [0.5, 0.5],
        trafficSplit: split(0.5, 0.5),
      }).success,
    ).toBe(true);
    expect(
      parse({
        coverage: 0,
        variationWeights: [1, 0],
        trafficSplit: split(1, 0),
      }).success,
    ).toBe(true);
    expect(parse({ coverage: 1 }).success).toBe(true);
  });

  it.each([1.7, -0.1])("rejects coverage %p", (coverage) => {
    expect(parse({ coverage }).success).toBe(false);
  });

  it.each([
    [2, 0],
    [1, -1],
  ])("rejects trafficSplit weights %p / %p", (a, b) => {
    expect(parse({ trafficSplit: split(a, b) }).success).toBe(false);
  });

  it.each([
    [1.5, 0],
    [1, -0.5],
    [50, 50],
  ])("rejects variationWeights %p / %p", (a, b) => {
    expect(parse({ variationWeights: [a, b] }).success).toBe(false);
  });
});
