import { DataSourceInterface } from "shared/types/datasource";
import { ExperimentInterface } from "shared/validators";
import {
  assertExperimentPrecomputedUnitDimensionIdsAreValid,
  datasourceHasWritableEphemeralPipeline,
  getEligiblePrecomputedUnitDimensionIds,
} from "back-end/src/services/dimensions";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { orgHasPremiumFeature } from "back-end/src/enterprise";

jest.mock("back-end/src/services/datasource", () => ({
  getSourceIntegrationObject: jest.fn(),
}));

jest.mock("back-end/src/enterprise", () => ({
  orgHasPremiumFeature: jest.fn(),
}));

function makeDatasource(
  pipelineSettings: Record<string, unknown> | undefined,
): DataSourceInterface {
  return {
    id: "ds_1",
    settings: { pipelineSettings },
  } as unknown as DataSourceInterface;
}

const context = { org: { id: "org_1" } } as never;

describe("datasourceHasWritableEphemeralPipeline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getSourceIntegrationObject as jest.Mock).mockReturnValue({
      getSourceProperties: () => ({ supportsWritingTables: true }),
    });
    (orgHasPremiumFeature as jest.Mock).mockReturnValue(true);
  });

  it("returns true when every condition holds", () => {
    expect(
      datasourceHasWritableEphemeralPipeline({
        context,
        datasource: makeDatasource({
          allowWriting: true,
          mode: "ephemeral",
          writeDataset: "gb",
        }),
      }),
    ).toBe(true);
  });

  it("returns false when the integration cannot write tables", () => {
    (getSourceIntegrationObject as jest.Mock).mockReturnValue({
      getSourceProperties: () => ({ supportsWritingTables: false }),
    });
    expect(
      datasourceHasWritableEphemeralPipeline({
        context,
        datasource: makeDatasource({
          allowWriting: true,
          mode: "ephemeral",
          writeDataset: "gb",
        }),
      }),
    ).toBe(false);
  });

  it("returns false for incremental pipeline mode", () => {
    expect(
      datasourceHasWritableEphemeralPipeline({
        context,
        datasource: makeDatasource({
          allowWriting: true,
          mode: "incremental",
          writeDataset: "gb",
        }),
      }),
    ).toBe(false);
  });

  it("returns false when writing is disabled or writeDataset is missing", () => {
    expect(
      datasourceHasWritableEphemeralPipeline({
        context,
        datasource: makeDatasource({
          allowWriting: false,
          mode: "ephemeral",
          writeDataset: "gb",
        }),
      }),
    ).toBe(false);
    expect(
      datasourceHasWritableEphemeralPipeline({
        context,
        datasource: makeDatasource({
          allowWriting: true,
          mode: "ephemeral",
          writeDataset: "",
        }),
      }),
    ).toBe(false);
  });

  it("returns false without the pipeline-mode premium feature", () => {
    (orgHasPremiumFeature as jest.Mock).mockReturnValue(false);
    expect(
      datasourceHasWritableEphemeralPipeline({
        context,
        datasource: makeDatasource({
          allowWriting: true,
          mode: "ephemeral",
          writeDataset: "gb",
        }),
      }),
    ).toBe(false);
  });

  it("returns false when pipelineSettings is undefined", () => {
    expect(
      datasourceHasWritableEphemeralPipeline({
        context,
        datasource: makeDatasource(undefined),
      }),
    ).toBe(false);
  });
});

describe("getEligiblePrecomputedUnitDimensionIds", () => {
  const experiment = {
    id: "exp_1",
    exposureQueryId: "exposure",
  } as ExperimentInterface;

  it("ignores requested dimensions when the datasource lacks a writable ephemeral pipeline", async () => {
    await expect(
      getEligiblePrecomputedUnitDimensionIds({
        context,
        experiment,
        datasource: makeDatasource({
          allowWriting: false,
          mode: "ephemeral",
          writeDataset: "gb",
        }),
        dimensionIds: ["dim_country"],
      }),
    ).resolves.toEqual([]);
  });

  it("throws if a saved config has more than five requested dimensions", async () => {
    await expect(
      getEligiblePrecomputedUnitDimensionIds({
        context,
        experiment,
        datasource: makeDatasource({
          allowWriting: true,
          mode: "ephemeral",
          writeDataset: "gb",
        }),
        dimensionIds: ["dim_1", "dim_2", "dim_3", "dim_4", "dim_5", "dim_6"],
      }),
    ).rejects.toThrow("A maximum of 5 precomputed unit dimensions are allowed");
  });
});

describe("assertExperimentPrecomputedUnitDimensionIdsAreValid", () => {
  it("throws when saving dimensions the datasource cannot honor", async () => {
    await expect(
      assertExperimentPrecomputedUnitDimensionIdsAreValid({
        context,
        datasource: makeDatasource({
          allowWriting: false,
          mode: "ephemeral",
          writeDataset: "gb",
        }),
        exposureQueryId: "exposure",
        dimensionIds: ["dim_country"],
      }),
    ).rejects.toThrow(
      "Precomputed unit dimensions require a datasource with ephemeral Pipeline Mode enabled",
    );
  });
});
