import { DataSourceInterface } from "shared/types/datasource";
import { DimensionInterface } from "shared/types/dimension";
import { ExperimentInterface } from "shared/validators";
import {
  assertExperimentPrecomputedUnitDimensionIdsAreValid,
  datasourceHasWritableEphemeralPipeline,
  getEligiblePrecomputedUnitDimensionIds,
} from "back-end/src/services/dimensions";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { findDimensionsByIds } from "back-end/src/models/DimensionModel";
import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";

jest.mock("back-end/src/services/datasource", () => ({
  getSourceIntegrationObject: jest.fn(),
}));

jest.mock("back-end/src/enterprise", () => ({
  orgHasPremiumFeature: jest.fn(),
}));

jest.mock("back-end/src/models/DimensionModel", () => ({
  findDimensionsByIds: jest.fn(),
}));

jest.mock("back-end/src/integrations/sql/queries/exposure-query", () => ({
  getExposureQuery: jest.fn(),
}));

function makeDatasource(
  pipelineSettings: Record<string, unknown> | undefined,
): DataSourceInterface {
  return {
    id: "ds_1",
    settings: { pipelineSettings },
  } as unknown as DataSourceInterface;
}

function makeDimension(
  overrides: Partial<DimensionInterface> = {},
): DimensionInterface {
  return {
    id: "dim_country",
    datasource: "ds_1",
    userIdType: "user_id",
    name: "Country",
    sql: "",
    organization: "org_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...overrides,
  } as DimensionInterface;
}

const writableEphemeralPipeline = {
  allowWriting: true,
  mode: "ephemeral",
  writeDataset: "gb",
};

const context = { org: { id: "org_1" } } as never;

function mockPipelineEligible() {
  (getSourceIntegrationObject as jest.Mock).mockReturnValue({
    getSourceProperties: () => ({ supportsWritingTables: true }),
  });
  (orgHasPremiumFeature as jest.Mock).mockReturnValue(true);
}

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

  beforeEach(() => {
    jest.clearAllMocks();
    mockPipelineEligible();
    (getExposureQuery as jest.Mock).mockReturnValue({ userIdType: "user_id" });
  });

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

  it("throws if a saved config has more than three requested dimensions", async () => {
    await expect(
      getEligiblePrecomputedUnitDimensionIds({
        context,
        experiment,
        datasource: makeDatasource(writableEphemeralPipeline),
        dimensionIds: ["dim_1", "dim_2", "dim_3", "dim_4"],
      }),
    ).rejects.toThrow("A maximum of 3 precomputed unit dimensions are allowed");
  });

  it("returns ids whose datasource and userIdType match, dropping the rest", async () => {
    (findDimensionsByIds as jest.Mock).mockResolvedValue([
      makeDimension({ id: "dim_country" }),
      makeDimension({ id: "dim_wrong_ds", datasource: "ds_other" }),
      makeDimension({ id: "dim_wrong_idtype", userIdType: "anonymous_id" }),
    ]);

    await expect(
      getEligiblePrecomputedUnitDimensionIds({
        context,
        experiment,
        datasource: makeDatasource(writableEphemeralPipeline),
        dimensionIds: ["dim_country", "dim_wrong_ds", "dim_wrong_idtype"],
      }),
    ).resolves.toEqual(["dim_country"]);
  });

  it("returns empty when the exposure query lookup throws", async () => {
    (findDimensionsByIds as jest.Mock).mockResolvedValue([
      makeDimension({ id: "dim_country" }),
    ]);
    (getExposureQuery as jest.Mock).mockImplementation(() => {
      throw new Error("Unknown experiment assignment table - exposure");
    });

    await expect(
      getEligiblePrecomputedUnitDimensionIds({
        context,
        experiment,
        datasource: makeDatasource(writableEphemeralPipeline),
        dimensionIds: ["dim_country"],
      }),
    ).resolves.toEqual([]);
  });
});

describe("assertExperimentPrecomputedUnitDimensionIdsAreValid", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPipelineEligible();
    (getExposureQuery as jest.Mock).mockReturnValue({ userIdType: "user_id" });
    (findDimensionsByIds as jest.Mock).mockResolvedValue([]);
  });

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

  it("throws when no datasource is provided", async () => {
    await expect(
      assertExperimentPrecomputedUnitDimensionIdsAreValid({
        context,
        datasource: null,
        exposureQueryId: "exposure",
        dimensionIds: ["dim_country"],
      }),
    ).rejects.toThrow(
      "precomputedUnitDimensionIds requires the experiment to have a datasource",
    );
  });

  it("throws on more than three dimensions", async () => {
    await expect(
      assertExperimentPrecomputedUnitDimensionIdsAreValid({
        context,
        datasource: makeDatasource(writableEphemeralPipeline),
        exposureQueryId: "exposure",
        dimensionIds: ["dim_1", "dim_2", "dim_3", "dim_4"],
      }),
    ).rejects.toThrow("A maximum of 3 precomputed unit dimensions are allowed");
  });

  it("throws when a requested dimension id does not exist", async () => {
    (findDimensionsByIds as jest.Mock).mockResolvedValue([]);
    await expect(
      assertExperimentPrecomputedUnitDimensionIdsAreValid({
        context,
        datasource: makeDatasource(writableEphemeralPipeline),
        exposureQueryId: "exposure",
        dimensionIds: ["dim_missing"],
      }),
    ).rejects.toThrow("Unknown precomputedUnitDimensionIds: dim_missing");
  });

  it("throws when the experiment has no valid exposure query", async () => {
    (findDimensionsByIds as jest.Mock).mockResolvedValue([
      makeDimension({ id: "dim_country" }),
    ]);
    (getExposureQuery as jest.Mock).mockImplementation(() => {
      throw new Error("Unknown experiment assignment table - exposure");
    });

    await expect(
      assertExperimentPrecomputedUnitDimensionIdsAreValid({
        context,
        datasource: makeDatasource(writableEphemeralPipeline),
        exposureQueryId: "exposure",
        dimensionIds: ["dim_country"],
      }),
    ).rejects.toThrow(
      "precomputedUnitDimensionIds requires a valid experiment exposure query",
    );
  });

  it("throws when a dimension's datasource does not match the experiment's", async () => {
    (findDimensionsByIds as jest.Mock).mockResolvedValue([
      makeDimension({ id: "dim_country", datasource: "ds_other" }),
    ]);

    await expect(
      assertExperimentPrecomputedUnitDimensionIdsAreValid({
        context,
        datasource: makeDatasource(writableEphemeralPipeline),
        exposureQueryId: "exposure",
        dimensionIds: ["dim_country"],
      }),
    ).rejects.toThrow(
      'precomputedUnitDimension "dim_country" datasource does not match the experiment datasource',
    );
  });

  it("throws when a dimension's userIdType does not match the exposure query", async () => {
    (findDimensionsByIds as jest.Mock).mockResolvedValue([
      makeDimension({ id: "dim_country", userIdType: "anonymous_id" }),
    ]);

    await expect(
      assertExperimentPrecomputedUnitDimensionIdsAreValid({
        context,
        datasource: makeDatasource(writableEphemeralPipeline),
        exposureQueryId: "exposure",
        dimensionIds: ["dim_country"],
      }),
    ).rejects.toThrow(
      'precomputedUnitDimension "dim_country" userIdType does not match the experiment exposure query',
    );
  });

  it("resolves without error when every dimension is valid", async () => {
    (findDimensionsByIds as jest.Mock).mockResolvedValue([
      makeDimension({ id: "dim_country" }),
    ]);

    await expect(
      assertExperimentPrecomputedUnitDimensionIdsAreValid({
        context,
        datasource: makeDatasource(writableEphemeralPipeline),
        exposureQueryId: "exposure",
        dimensionIds: ["dim_country"],
      }),
    ).resolves.toBeUndefined();
  });
});
