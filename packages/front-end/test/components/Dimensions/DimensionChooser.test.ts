import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { DimensionInterface } from "shared/types/dimension";
import { IncrementalRefreshInterface } from "shared/validators";
import {
  CUSTOM_COMBO_OPTION,
  CUSTOM_CUTOFF_OPTION,
  getCombinationConstituentOptions,
  getDimensionDisplayName,
  getDimensionOptions,
} from "@/components/Dimensions/DimensionChooser";

describe("getDimensionOptions", () => {
  it("does not hide exposure dimensions that share a label with precomputed unit dimensions", () => {
    const datasource = {
      id: "ds_1",
      settings: {
        pipelineSettings: {
          allowWriting: true,
          mode: "ephemeral",
          writeDataset: "gb",
        },
        queries: {
          exposure: [
            {
              id: "eq_1",
              name: "Assignment",
              userIdType: "user_id",
              query: "SELECT * FROM exposures",
              dimensions: ["country", "browser"],
            },
          ],
        },
      },
      properties: {
        supportsWritingTables: true,
      },
    } as DataSourceInterfaceWithParams;
    const dimensions = [
      {
        id: "dim_country",
        name: "country",
        datasource: "ds_1",
        userIdType: "user_id",
      },
    ] as DimensionInterface[];

    const options = getDimensionOptions({
      incrementalRefresh: null,
      precomputedDimensions: ["precomputed:browser"],
      precomputedUnitDimensionIds: ["dim_country"],
      hasPipelineModeFeature: true,
      datasource,
      dimensions,
      exposureQueryId: "eq_1",
      userIdType: "user_id",
    });
    const values = options.flatMap((group) =>
      group.options?.map((option) => option.value),
    );

    expect(values).toContain("dim_country");
    expect(values).toContain("exp:country");
    expect(values).not.toContain("exp:browser");
  });
});

function buildDatasource(): DataSourceInterfaceWithParams {
  return {
    id: "ds_1",
    settings: {
      queries: {
        exposure: [
          {
            id: "eq_1",
            name: "Assignment",
            userIdType: "user_id",
            query: "SELECT * FROM exposures",
            dimensions: ["country", "browser"],
          },
        ],
      },
    },
    properties: {},
  } as DataSourceInterfaceWithParams;
}

const unitDimensions = [
  {
    id: "dim_u1",
    name: "Plan Type",
    datasource: "ds_1",
    userIdType: "user_id",
  },
] as DimensionInterface[];

describe("getDimensionOptions custom dimensions", () => {
  it("omits custom options by default", () => {
    const options = getDimensionOptions({
      incrementalRefresh: null,
      datasource: buildDatasource(),
      dimensions: unitDimensions,
      exposureQueryId: "eq_1",
      userIdType: "user_id",
    });
    const values = options.flatMap((group) =>
      group.options?.map((option) => option.value),
    );
    expect(values).not.toContain(CUSTOM_CUTOFF_OPTION);
    expect(values).not.toContain(CUSTOM_COMBO_OPTION);
  });

  it("puts custom options in their own group when enabled", () => {
    const options = getDimensionOptions({
      incrementalRefresh: null,
      datasource: buildDatasource(),
      dimensions: unitDimensions,
      exposureQueryId: "eq_1",
      userIdType: "user_id",
      includeCustomDimensions: true,
    });
    const custom = options.find((group) => group.label === "Custom");
    const values = custom?.options?.map((option) => option.value) ?? [];
    expect(values).toEqual([CUSTOM_CUTOFF_OPTION, CUSTOM_COMBO_OPTION]);

    // They must not leak into the on-demand group
    const onDemand = options.find((group) => group.label === "On-demand");
    const onDemandValues =
      onDemand?.options?.map((option) => option.value) ?? [];
    expect(onDemandValues).not.toContain(CUSTOM_CUTOFF_OPTION);
    expect(onDemandValues).not.toContain(CUSTOM_COMBO_OPTION);
  });

  it("omits the combination option when fewer than two constituents exist", () => {
    const options = getDimensionOptions({
      incrementalRefresh: null,
      datasource: null,
      dimensions: [],
      includeCustomDimensions: true,
    });
    const values = options.flatMap((group) =>
      group.options?.map((option) => option.value),
    );
    expect(values).toContain(CUSTOM_CUTOFF_OPTION);
    expect(values).not.toContain(CUSTOM_COMBO_OPTION);
  });
});

describe("getCombinationConstituentOptions", () => {
  it("includes experiment and unit dimensions for the datasource", () => {
    const options = getCombinationConstituentOptions({
      incrementalRefresh: null,
      datasource: buildDatasource(),
      dimensions: [
        ...unitDimensions,
        {
          id: "dim_other",
          name: "Other DS",
          datasource: "ds_2",
          userIdType: "user_id",
        } as DimensionInterface,
      ],
      exposureQueryId: "eq_1",
      userIdType: "user_id",
    });
    const values = options.map((option) => option.value);
    expect(values).toEqual(["exp:country", "exp:browser", "dim_u1"]);
  });

  it("filters out experiment dimensions missing from the incremental refresh model", () => {
    const options = getCombinationConstituentOptions({
      incrementalRefresh: {
        unitsDimensions: ["country"],
      } as IncrementalRefreshInterface,
      datasource: buildDatasource(),
      dimensions: unitDimensions,
      exposureQueryId: "eq_1",
      userIdType: "user_id",
    });
    const values = options.map((option) => option.value);
    expect(values).toEqual(["exp:country", "dim_u1"]);
  });
});

describe("getDimensionDisplayName", () => {
  const resolve = (id: string) => (id === "dim_u1" ? "Plan Type" : undefined);

  it("keeps existing display names", () => {
    expect(getDimensionDisplayName("", resolve)).toBe("None");
    expect(getDimensionDisplayName("pre:date", resolve)).toBe(
      "Date Cohorts (First Exposure)",
    );
    expect(getDimensionDisplayName("pre:activation", resolve)).toBe(
      "Activation status",
    );
    expect(getDimensionDisplayName("exp:country", resolve)).toBe("country");
    expect(getDimensionDisplayName("dim_u1", resolve)).toBe("Plan Type");
  });

  it("formats datecutoff dimensions", () => {
    expect(
      getDimensionDisplayName("cutoff:2026-01-15T00:12:00.000Z", resolve),
    ).toMatch(/^First exposed after /);
  });

  it("formats combo dimensions with resolved constituent names", () => {
    expect(getDimensionDisplayName("combo:exp:country::dim_u1", resolve)).toBe(
      "country & Plan Type",
    );
    // Unresolvable constituents fall back to the raw id
    expect(
      getDimensionDisplayName("combo:exp:country::dim_missing", resolve),
    ).toBe("country & dim_missing");
  });
});
