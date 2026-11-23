import { FeatureInterface } from "shared/types/feature";
import {
  getApiJsonSchema,
  getInitialFeatureJsonSchema,
  stampApiJsonSchema,
} from "back-end/src/util/feature-json-schema";

describe("getInitialFeatureJsonSchema", () => {
  it("preserves provided schema settings for duplicated features", () => {
    const sourceDate = new Date("2025-01-01T00:00:00.000Z");
    const sourceSchema: FeatureInterface["jsonSchema"] = {
      schemaType: "simple",
      schema: '{"type":"object"}',
      simple: {
        type: "object",
        fields: [],
      },
      date: sourceDate,
      enabled: true,
    };

    const schema = getInitialFeatureJsonSchema(sourceSchema);

    expect(schema).toEqual(
      expect.objectContaining({
        schemaType: "simple",
        schema: '{"type":"object"}',
        simple: {
          type: "object",
          fields: [],
        },
        enabled: true,
      }),
    );
    expect(schema.date).toBeInstanceOf(Date);
    expect(schema.date.getTime()).toBeGreaterThan(sourceDate.getTime());
  });

  it("uses a disabled default schema when no source schema is provided", () => {
    const schema = getInitialFeatureJsonSchema(undefined);

    expect(schema).toEqual(
      expect.objectContaining({
        schemaType: "schema",
        schema: "",
        simple: {
          type: "object",
          fields: [],
        },
        enabled: false,
      }),
    );
    expect(schema.date).toBeInstanceOf(Date);
  });

  it("falls back to schema mode when schemaType is invalid at runtime", () => {
    const sourceSchema = {
      schemaType: "custom",
      schema: '{"type":"object"}',
      simple: {
        type: "object",
        fields: [],
      },
      date: new Date("2025-01-01T00:00:00.000Z"),
      enabled: true,
    } as unknown as FeatureInterface["jsonSchema"];

    const schema = getInitialFeatureJsonSchema(sourceSchema);

    expect(schema.schemaType).toBe("schema");
    expect(schema.schema).toBe('{"type":"object"}');
    expect(schema.enabled).toBe(true);
  });
});

describe("stampApiJsonSchema", () => {
  const jsonSchema = {
    schemaType: "schema" as const,
    schema: '{"type":"string"}',
    simple: { type: "primitive" as const, fields: [] },
    enabled: true,
  };

  it("keeps the schema and sets date server-side", () => {
    const before = Date.now();
    const stamped = stampApiJsonSchema(jsonSchema, "string");

    expect(stamped).toEqual({ ...jsonSchema, date: expect.any(Date) });
    expect(stamped.date.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("rejects a schema on a boolean feature", () => {
    expect(() => stampApiJsonSchema(jsonSchema, "boolean")).toThrow(
      "Boolean features cannot have a validation schema.",
    );
  });

  it("rejects a schema whose type doesn't match the feature", () => {
    expect(() => stampApiJsonSchema(jsonSchema, "number")).toThrow(
      /must have a top-level type of "number" or "integer"/,
    );
  });
});

describe("getApiJsonSchema", () => {
  const jsonSchema: FeatureInterface["jsonSchema"] = {
    schemaType: "schema",
    schema: '{"type":"object","properties":{"color":{"type":"string"}}}',
    simple: { type: "object", fields: [] },
    date: new Date("2025-01-01T00:00:00.000Z"),
    enabled: true,
  };

  it("returns the schema string when validation is enabled", () => {
    expect(getApiJsonSchema({ jsonSchema })).toBe(jsonSchema.schema);
  });

  it("converts a simple schema to a JSON schema string", () => {
    const result = getApiJsonSchema({
      jsonSchema: {
        ...jsonSchema,
        schemaType: "simple",
        schema: "",
        simple: {
          type: "object",
          fields: [
            {
              key: "color",
              type: "string",
              required: true,
              default: "",
              description: "",
              enum: [],
            },
          ],
        },
      },
    });

    expect(result).toBeDefined();
    expect(JSON.parse(result ?? "")).toEqual(
      expect.objectContaining({
        type: "object",
        properties: { color: expect.objectContaining({ type: "string" }) },
        required: ["color"],
      }),
    );
  });

  it("omits a disabled schema so a round-trip doesn't enable it", () => {
    expect(
      getApiJsonSchema({ jsonSchema: { ...jsonSchema, enabled: false } }),
    ).toBeUndefined();
  });

  it("omits a missing or unparseable schema", () => {
    expect(getApiJsonSchema({ jsonSchema: undefined })).toBeUndefined();
    expect(
      getApiJsonSchema({ jsonSchema: { ...jsonSchema, schema: "{" } }),
    ).toBeUndefined();
  });
});
