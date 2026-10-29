import type { ExperimentDimensionWithSpecifiedSlices } from "shared/types/integrations";
import { getStatisticsQueryVariants } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";

const dim = (id: string): ExperimentDimensionWithSpecifiedSlices => ({
  type: "experiment",
  id,
  specifiedSlices: [],
});

describe("getStatisticsQueryVariants", () => {
  const baseName = "statistics_grp0";

  it("emits a single grouped query for non-cluster experiments", () => {
    const parent = [dim("browser"), dim("country")];
    const variants = getStatisticsQueryVariants({
      baseName,
      precomputationDisabled: false,
      parentPrecomputedDimensions: parent,
      isolatedPrecomputedDimensions: [],
    });

    expect(variants).toEqual([
      { name: baseName, dimensionsForPrecomputation: parent },
    ]);
  });

  it("emits a dimensionless query with no breakdowns when precomputation is disabled", () => {
    const variants = getStatisticsQueryVariants({
      baseName,
      precomputationDisabled: true,
      // Even if callers pass dimensions, a disabled run stays dimensionless.
      parentPrecomputedDimensions: [dim("browser")],
      isolatedPrecomputedDimensions: [dim("browser")],
    });

    expect(variants).toEqual([
      { name: baseName, dimensionsForPrecomputation: [] },
    ]);
  });

  it("emits a dimensionless overall query plus one isolated query per cluster breakdown", () => {
    const browser = dim("browser");
    const country = dim("country");
    const variants = getStatisticsQueryVariants({
      baseName,
      precomputationDisabled: false,
      // Cluster experiments keep the overall query dimensionless.
      parentPrecomputedDimensions: [],
      isolatedPrecomputedDimensions: [browser, country],
    });

    expect(variants).toEqual([
      { name: baseName, dimensionsForPrecomputation: [] },
      {
        name: "unitdim:precomputed:browser:statistics_grp0",
        dimensionsForPrecomputation: [browser],
      },
      {
        name: "unitdim:precomputed:country:statistics_grp0",
        dimensionsForPrecomputation: [country],
      },
    ]);
  });

  it("names isolated queries so they round-trip through the unit-dimension parser", () => {
    const variants = getStatisticsQueryVariants({
      baseName,
      precomputationDisabled: false,
      parentPrecomputedDimensions: [],
      isolatedPrecomputedDimensions: [dim("browser")],
    });

    // The isolated query is excluded from the dimensionless overall pass and
    // routed to the `precomputed:browser` breakdown analysis.
    expect(variants[1].name).toBe(
      "unitdim:precomputed:browser:statistics_grp0",
    );
  });
});
