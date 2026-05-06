import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { CreateMetricTimeSeriesSingleDataPoint } from "shared/validators";
import { MetricTimeSeriesModel } from "back-end/src/models/MetricTimeSeriesModel";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import type { Context } from "back-end/src/models/BaseModel";

const context = {
  org: { id: "org_1" },
  populateForeignRefs: jest.fn().mockResolvedValue(undefined),
  models: {},
} as unknown as Context;

function makeSingleDataPoint(
  overrides: Partial<CreateMetricTimeSeriesSingleDataPoint> = {},
): CreateMetricTimeSeriesSingleDataPoint {
  return {
    source: "experiment",
    sourceId: "exp_1",
    sourcePhase: 0,
    metricId: "met_1",
    lastExperimentSettingsHash: "experiment_hash",
    lastMetricSettingsHash: "metric_hash",
    singleDataPoint: {
      date: new Date("2025-01-01T00:00:00Z"),
      variations: [
        { id: "0", name: "Control" },
        {
          id: "1",
          name: "Variation",
          absolute: { value: 1, ci: [0.5, 1.5] },
        },
      ],
    },
    ...overrides,
  };
}

describe("MetricTimeSeriesModel", () => {
  let mongod: MongoMemoryServer;
  let model: MetricTimeSeriesModel;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    model = new MetricTimeSeriesModel(context);
    await waitForIndexes();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  it("stores main and dimension series as distinct tuples", async () => {
    await model.upsertMultipleSingleDataPoint([
      makeSingleDataPoint(),
      makeSingleDataPoint({
        dimensionId: "precomputed:country",
        dimensionValue: "US",
      }),
    ]);

    const docs = await mongoose.connection
      .db!.collection("metrictimeseries")
      .find({})
      .toArray();

    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.dimensionValue).sort()).toEqual(["US", undefined]);
  });

  it("fetches main series only when no dimension ids are requested", async () => {
    await model.upsertMultipleSingleDataPoint([
      makeSingleDataPoint(),
      makeSingleDataPoint({
        dimensionId: "precomputed:country",
        dimensionValue: "US",
      }),
    ]);

    const docs = await model.getBySourceAndMetricIds({
      source: "experiment",
      sourceId: "exp_1",
      sourcePhase: 0,
      metricIds: ["met_1"],
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].dimensionId).toBeUndefined();
  });

  it("fetches the requested dimension family", async () => {
    await model.upsertMultipleSingleDataPoint([
      makeSingleDataPoint(),
      makeSingleDataPoint({
        dimensionId: "precomputed:country",
        dimensionValue: "US",
      }),
      makeSingleDataPoint({
        dimensionId: "precomputed:country",
        dimensionValue: "CA",
      }),
      makeSingleDataPoint({
        dimensionId: "precomputed:browser",
        dimensionValue: "Firefox",
      }),
    ]);

    const docs = await model.getBySourceAndMetricIds({
      source: "experiment",
      sourceId: "exp_1",
      sourcePhase: 0,
      metricIds: ["met_1"],
      dimensions: [{ id: "precomputed:country" }],
    });

    expect(docs.map((d) => d.dimensionValue).sort()).toEqual(["CA", "US"]);
  });

  it("fetches only the requested dimension value when provided", async () => {
    await model.upsertMultipleSingleDataPoint([
      makeSingleDataPoint(),
      makeSingleDataPoint({
        dimensionId: "precomputed:country",
        dimensionValue: "US",
      }),
      makeSingleDataPoint({
        dimensionId: "precomputed:country",
        dimensionValue: "CA",
      }),
    ]);

    const docs = await model.getBySourceAndMetricIds({
      source: "experiment",
      sourceId: "exp_1",
      sourcePhase: 0,
      metricIds: ["met_1"],
      dimensions: [
        {
          id: "precomputed:country",
          value: "US",
        },
      ],
    });

    expect(docs.map((d) => d.dimensionValue)).toEqual(["US"]);
  });

  it("fetches any matching dimension id or exact dimension value", async () => {
    await model.upsertMultipleSingleDataPoint([
      makeSingleDataPoint({
        dimensionId: "precomputed:country",
        dimensionValue: "US",
      }),
      makeSingleDataPoint({
        dimensionId: "precomputed:country",
        dimensionValue: "CA",
      }),
      makeSingleDataPoint({
        dimensionId: "precomputed:browser",
        dimensionValue: "Chrome",
      }),
      makeSingleDataPoint({
        dimensionId: "precomputed:browser",
        dimensionValue: "Firefox",
      }),
    ]);

    const docs = await model.getBySourceAndMetricIds({
      source: "experiment",
      sourceId: "exp_1",
      sourcePhase: 0,
      metricIds: ["met_1"],
      dimensions: [
        { id: "precomputed:country" },
        { id: "precomputed:browser", value: "Chrome" },
      ],
    });

    expect(docs.map((d) => d.dimensionValue).sort()).toEqual([
      "CA",
      "Chrome",
      "US",
    ]);
  });

  it("stores and fetches an empty string dimension value", async () => {
    await model.upsertMultipleSingleDataPoint([
      makeSingleDataPoint({
        dimensionId: "precomputed:country",
        dimensionValue: "",
      }),
      makeSingleDataPoint({
        dimensionId: "precomputed:country",
        dimensionValue: "US",
      }),
    ]);

    const docs = await model.getBySourceAndMetricIds({
      source: "experiment",
      sourceId: "exp_1",
      sourcePhase: 0,
      metricIds: ["met_1"],
      dimensions: [
        {
          id: "precomputed:country",
          value: "",
        },
      ],
    });

    expect(docs).toHaveLength(1);
    expect(docs[0].dimensionValue).toBe("");
  });

  it("matches dimension values exactly on upsert", async () => {
    await model.upsertMultipleSingleDataPoint([
      makeSingleDataPoint({
        dimensionId: "precomputed:country",
        dimensionValue: "US",
      }),
      makeSingleDataPoint({
        dimensionId: "precomputed:country",
        dimensionValue: "CA",
      }),
    ]);

    await model.upsertMultipleSingleDataPoint([
      makeSingleDataPoint({
        dimensionId: "precomputed:country",
        dimensionValue: "US",
        singleDataPoint: {
          ...makeSingleDataPoint().singleDataPoint,
          date: new Date("2025-01-02T00:00:00Z"),
        },
      }),
    ]);

    const docs = await model.getBySourceAndMetricIds({
      source: "experiment",
      sourceId: "exp_1",
      sourcePhase: 0,
      metricIds: ["met_1"],
      dimensions: [{ id: "precomputed:country" }],
    });

    const us = docs.find((d) => d.dimensionValue === "US");
    const ca = docs.find((d) => d.dimensionValue === "CA");

    expect(us?.dataPoints).toHaveLength(2);
    expect(ca?.dataPoints).toHaveLength(1);
  });
});
