import {
  putFeatureRevisionMetadataValidator,
  putFeatureRevisionMetadataV2Validator,
} from "../../src/validators";

const jsonSchema = {
  schemaType: "schema",
  schema: '{"type":"string"}',
  simple: { type: "primitive", fields: [] },
  enabled: true,
};

describe.each([
  { version: "v1", validator: putFeatureRevisionMetadataValidator },
  { version: "v2", validator: putFeatureRevisionMetadataV2Validator },
])("$version revision metadata jsonSchema", ({ validator }) => {
  it("accepts a schema from a JSON body without date", () => {
    const body = JSON.parse(JSON.stringify({ jsonSchema }));
    expect(validator.bodySchema.safeParse(body).success).toBe(true);
  });

  it("rejects a caller-supplied date", () => {
    const result = validator.bodySchema.safeParse({
      jsonSchema: { ...jsonSchema, date: "2026-01-01T00:00:00.000Z" },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('"date"');
  });
});
