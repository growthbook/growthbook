import {
  interleavingMetricConfigValidator,
  interleavingValidator,
} from "../src/validators/interleaving";
import { parseInterleavingRankerConfig } from "../src/util/interleaving";

const ranker = (id: string, key: string, config = "{}") => ({
  id,
  key,
  name: key,
  config,
});

const schema = (schemaString: string, enabled = true) => ({
  schemaType: "schema" as const,
  schema: schemaString,
  simple: { type: "object" as const, fields: [] },
  date: new Date("2026-10-01"),
  enabled,
});

const weightSchema = schema(
  JSON.stringify({
    type: "object",
    properties: { weight: { type: "number" } },
    required: ["weight"],
  }),
);

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
  jsonSchema: null,
  datasource: "ds_1",
  interleavingQueryId: "ilq_1",
  userIdType: "user_id",
  metrics: [{ id: "fact__clicks", paired: true, ownership: null }],
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
  it.each([
    ["paired only", { paired: true, ownership: null }],
    [
      "ownership only",
      { paired: false, ownership: { attribution: "exposureCount" } },
    ],
    [
      "both at once",
      { paired: true, ownership: { attribution: "engagementSignal" } },
    ],
  ])("accepts %s", (_label, analyses) => {
    expect(
      interleavingMetricConfigValidator.safeParse({
        id: "fact__m",
        ...analyses,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown ownership attribution", () => {
    expect(
      interleavingMetricConfigValidator.safeParse({
        id: "fact__m",
        paired: false,
        ownership: { attribution: "lastClick" },
      }).success,
    ).toBe(false);
  });

  it("rejects a metric with no analysis selected", () => {
    expect(
      interleavingMetricConfigValidator.safeParse({
        id: "fact__m",
        paired: false,
        ownership: null,
      }).success,
    ).toBe(false);
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

  it("accepts a config matching the schema", () => {
    expect(
      parseInterleavingRankerConfig('{"weight":0.3}', weightSchema),
    ).toEqual({ weight: 0.3 });
  });

  it("rejects a config that violates the schema", () => {
    expect(() =>
      parseInterleavingRankerConfig('{"weight":"heavy"}', weightSchema),
    ).toThrow(/weight/);
  });

  it("skips validation when the schema is disabled", () => {
    const disabled = { ...weightSchema, enabled: false };
    expect(parseInterleavingRankerConfig("{}", disabled)).toEqual({});
  });
});
