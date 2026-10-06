import {
  interleavingMetricConfigValidator,
  interleavingValidator,
} from "../src/validators/interleaving";
import {
  getInterleavingSnapshotRunSettings,
  parseInterleavingRankerConfig,
} from "../src/util/interleaving";

const ranker = (id: string, key: string, config = "{}") => ({
  id,
  key,
  name: key,
  config,
});

const baseDoc = {
  id: "il_1",
  organization: "org_1",
  dateCreated: new Date("2026-10-01"),
  dateUpdated: new Date("2026-10-01"),
  name: "Featured products ranker",
  owner: "",
  tags: [],
  archived: false,
  status: "draft" as const,
  trackingKey: "featured-products-ranker",
  hashAttribute: "id",
  seed: "seed",
  variations: [
    ranker("var_a", "buyers-pick", '{"algorithm":"buyers-pick"}'),
    ranker("var_b", "price-first", '{"algorithm":"price-first"}'),
  ],
  datasource: "ds_1",
  interleavingQueryId: "ilq_1",
  userIdType: "user_id",
  metrics: [{ id: "fact__clicks", attributionType: "paired" as const }],
  environmentSettings: { production: { enabled: true } },
};

describe("interleavingValidator", () => {
  it("accepts a two-ranker experiment", () => {
    expect(interleavingValidator.safeParse(baseDoc).success).toBe(true);
  });

  it.each([1, 3])("rejects %i rankers", (n) => {
    const variations = Array.from({ length: n }, (_, i) =>
      ranker(`var_${i}`, `k${i}`),
    );
    expect(
      interleavingValidator.safeParse({ ...baseDoc, variations }).success,
    ).toBe(false);
  });

  it.each(["", " ", "\t"])("rejects a blank ranker key: %j", (key) => {
    expect(
      interleavingValidator.safeParse({
        ...baseDoc,
        variations: [ranker("var_a", key), baseDoc.variations[1]],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(
      interleavingValidator.safeParse({
        ...baseDoc,
        measurementArmPercent: 0.1,
      }).success,
    ).toBe(false);
  });
});

describe("interleavingMetricConfigValidator", () => {
  it.each(["paired", "ownershipByExposureCount"])(
    "accepts %s",
    (attributionType) => {
      expect(
        interleavingMetricConfigValidator.safeParse({
          id: "fact__m",
          attributionType,
        }).success,
      ).toBe(true);
    },
  );

  it("rejects an unknown attribution type", () => {
    expect(
      interleavingMetricConfigValidator.safeParse({
        id: "fact__m",
        attributionType: "lastClick",
      }).success,
    ).toBe(false);
  });
});

describe("getInterleavingSnapshotRunSettings", () => {
  it("maps the parent onto the snapshot's run settings", () => {
    const dateStarted = new Date("2026-10-05");
    expect(
      getInterleavingSnapshotRunSettings({ ...baseDoc, dateStarted }),
    ).toEqual({
      interleavingId: "il_1",
      trackingKey: "featured-products-ranker",
      interleavingQueryId: "ilq_1",
      userIdType: "user_id",
      variationNames: ["buyers-pick", "price-first"],
      metrics: baseDoc.metrics,
      startDate: dateStarted,
      endDate: null,
    });
  });

  it("carries the stop date as the end date", () => {
    const dateStopped = new Date("2026-10-20");
    expect(
      getInterleavingSnapshotRunSettings({
        ...baseDoc,
        dateStarted: new Date("2026-10-05"),
        dateStopped,
      }).endDate,
    ).toEqual(dateStopped);
  });

  it("refuses an experiment that hasn't started", () => {
    expect(() => getInterleavingSnapshotRunSettings(baseDoc)).toThrow();
  });
});

describe("parseInterleavingRankerConfig", () => {
  it("parses a JSON object", () => {
    expect(parseInterleavingRankerConfig('{"weight":0.3}')).toEqual({
      weight: 0.3,
    });
  });

  it.each(["not json", "[]", "null", "3", '"x"'])("rejects %j", (config) => {
    expect(() => parseInterleavingRankerConfig(config)).toThrow();
  });
});
