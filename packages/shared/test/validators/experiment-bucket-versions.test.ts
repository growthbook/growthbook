import {
  postExperimentValidator,
  updateExperimentValidator,
} from "../../src/validators/experiments";

const createBody = (fields: Record<string, unknown>) => ({
  datasourceId: "ds_1",
  assignmentQueryId: "user_id",
  trackingKey: "exp-key",
  name: "My experiment",
  variations: [
    { key: "0", name: "Control" },
    { key: "1", name: "Treatment" },
  ],
  ...fields,
});

describe.each([
  [
    "postExperiment body",
    (fields: Record<string, unknown>) =>
      postExperimentValidator.bodySchema.safeParse(createBody(fields)),
  ],
  [
    "updateExperiment body",
    (fields: Record<string, unknown>) =>
      updateExperimentValidator.bodySchema.safeParse(fields),
  ],
] as const)("%s bucket versions", (_name, parse) => {
  it("accepts non-negative integer versions", () => {
    expect(parse({ bucketVersion: 0, minBucketVersion: 0 }).success).toBe(true);
    expect(parse({ bucketVersion: 3, minBucketVersion: 2 }).success).toBe(true);
    expect(parse({}).success).toBe(true);
  });

  it.each([
    { bucketVersion: 1.5 },
    { bucketVersion: -1 },
    { minBucketVersion: 0.5 },
    { minBucketVersion: -2 },
  ])("rejects %p", (fields) => {
    expect(parse(fields).success).toBe(false);
  });
});
