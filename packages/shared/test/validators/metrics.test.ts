import { listMetricsValidator } from "../../src/validators";

describe("listMetricsValidator query", () => {
  it("accepts includeArchived and keeps it optional", () => {
    expect(listMetricsValidator.querySchema.safeParse({}).success).toBe(true);
    expect(
      listMetricsValidator.querySchema.safeParse({ includeArchived: "false" })
        .success,
    ).toBe(true);
    expect(
      listMetricsValidator.querySchema.safeParse({ includeArchived: false })
        .success,
    ).toBe(true);
  });

  it("rejects unknown query params", () => {
    expect(
      listMetricsValidator.querySchema.safeParse({ archived: "false" }).success,
    ).toBe(false);
  });
});
