import { FeatureInterface } from "shared/types/feature";
import { getInitialFeatureJsonSchema } from "back-end/src/util/feature-json-schema";

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
