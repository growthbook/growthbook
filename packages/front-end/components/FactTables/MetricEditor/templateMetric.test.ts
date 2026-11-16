import { mappedColumn, placeholderColumns } from "./templateMetric";
import type { IncompleteFactMetricSeed } from "./templateMetric";

describe("placeholderColumns", () => {
  it("puts the same placeholder name in both sets when it plays both roles", () => {
    // "shared" is the numerator's own (non-count-distinct) column, and also
    // the column a row filter references - nothing prevents a template
    // author from reusing a name across placeholder roles.
    const seed: IncompleteFactMetricSeed = {
      metricType: "mean",
      numerator: {
        factTableId: "",
        column: "shared",
        rowFilters: [{ operator: "=", column: "shared", values: ["a"] }],
      },
    };
    const { numeric, string } = placeholderColumns(seed);
    expect(numeric.has("shared")).toBe(true);
    expect(string.has("shared")).toBe(true);
  });
});

describe("mappedColumn", () => {
  it("resolves a colliding placeholder independently per map", () => {
    const numericMap = { shared: "revenue" };
    const stringMap = { shared: "plan" };
    expect(mappedColumn("shared", numericMap)).toBe("revenue");
    expect(mappedColumn("shared", stringMap)).toBe("plan");
  });

  it("returns the placeholder unchanged when it isn't in the given map", () => {
    expect(mappedColumn("$$distinctUsers", {})).toBe("$$distinctUsers");
  });

  it("returns an empty string, not the placeholder, when still unmapped", () => {
    expect(mappedColumn("shared", { shared: "" })).toBe("");
  });
});
