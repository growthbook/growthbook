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
      breakdownsDisabled: false,
      parentFanOutDisabled: false,
      parentPrecomputedDimensions: parent,
      isolatedPrecomputedDimensions: [],
    });

    expect(variants).toEqual([
      { name: baseName, dimensionsForPrecomputation: parent },
    ]);
  });

  it("runs only the overall query when breakdowns are disabled (quantile path)", () => {
    const variants = getStatisticsQueryVariants({
      baseName,
      breakdownsDisabled: true,
      parentFanOutDisabled: false,
      // Quantiles support overall stats only, so even isolated breakdowns are
      // suppressed here.
      parentPrecomputedDimensions: [dim("country")],
      isolatedPrecomputedDimensions: [dim("browser")],
    });

    expect(variants).toEqual([
      { name: baseName, dimensionsForPrecomputation: [] },
    ]);
  });

  it("drops the parent fan-out but keeps isolated breakdowns when the fan-out is disabled", () => {
    const browser = dim("browser");
    const variants = getStatisticsQueryVariants({
      baseName,
      breakdownsDisabled: false,
      parentFanOutDisabled: true,
      // The eager parent fan-out is suppressed to save aggregation cost...
      parentPrecomputedDimensions: [dim("country")],
      // ...but an explicitly-requested breakdown (a cluster experiment's only
      // breakdown path, or a standalone unit dimension) still runs isolated,
      // so it no longer disappears silently.
      isolatedPrecomputedDimensions: [browser],
    });

    expect(variants).toEqual([
      { name: baseName, dimensionsForPrecomputation: [] },
      {
        name: "unitdim:precomputed:browser:statistics_grp0",
        dimensionsForPrecomputation: [browser],
      },
    ]);
  });

  it("emits a dimensionless overall query plus one isolated query per cluster breakdown", () => {
    const browser = dim("browser");
    const country = dim("country");
    const variants = getStatisticsQueryVariants({
      baseName,
      breakdownsDisabled: false,
      parentFanOutDisabled: false,
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
      breakdownsDisabled: false,
      parentFanOutDisabled: false,
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
