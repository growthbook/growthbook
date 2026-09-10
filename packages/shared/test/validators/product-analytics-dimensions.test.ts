import {
  dimensionValidator,
  explorationConfigValidator,
} from "../../src/validators/product-analytics";

// A rejected discriminator has to name the values it accepts: Zod's own
// "Invalid input" tells an API caller nothing, and the closed sets here are
// exactly the ones callers guess at ("dimension", a chart type as a config type).
describe("discriminator errors name the accepted values", () => {
  it("lists every dimension type", () => {
    const result = dimensionValidator.safeParse({
      dimensionType: "dimension",
      column: "browser",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["dimensionType"],
      message: 'must be one of "date", "dynamic", "static", "slice"',
    });
  });

  it("lists every exploration config type", () => {
    const result = explorationConfigValidator.safeParse({
      type: "stackedBar",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["type"],
      message:
        'must be one of "metric", "fact_table", "data_source", "sql", "funnel"',
    });
  });
});
