import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { DimensionInterface } from "shared/types/dimension";
import { getDimensionOptions } from "@/components/Dimensions/DimensionChooser";

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
