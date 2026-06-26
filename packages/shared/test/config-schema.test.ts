import { SchemaField } from "../types/feature";
import {
  fieldsCanonicallyEqual,
  inferFieldFromValue,
  inferFieldsFromValue,
  inferJsonSchemaForValue,
  jsonSchemaStringToFields,
  jsonValueImporter,
  reconcileSchemaFields,
} from "../src/util/config-schema";

const field = (over: Partial<SchemaField>): SchemaField => ({
  key: "k",
  type: "string",
  required: true,
  default: "",
  description: "",
  enum: [],
  ...over,
});

describe("inferFieldFromValue", () => {
  it("types primitives", () => {
    expect(inferFieldFromValue("a", "x").type).toBe("string");
    expect(inferFieldFromValue("a", 3).type).toBe("integer");
    expect(inferFieldFromValue("a", 3.5).type).toBe("float");
    expect(inferFieldFromValue("a", true).type).toBe("boolean");
  });

  it("marks null values as nullable strings", () => {
    const f = inferFieldFromValue("a", null);
    expect(f.type).toBe("string");
    expect(f.nullable).toBe(true);
  });

  it("uses the array preset for arrays", () => {
    expect(inferFieldFromValue("a", [1, 2]).jsonSchema).toBe(
      JSON.stringify({ type: "array" }),
    );
  });

  it("uses the object preset for objects", () => {
    expect(inferFieldFromValue("a", { b: 1 }).jsonSchema).toBe(
      JSON.stringify({ type: "object" }),
    );
  });

  it("leaves reference tokens untyped (any)", () => {
    expect(inferFieldFromValue("a", "@const:flags").jsonSchema).toBe(
      JSON.stringify({}),
    );
    expect(inferFieldFromValue("a", "@config:base").jsonSchema).toBe(
      JSON.stringify({}),
    );
  });
});

describe("inferFieldsFromValue", () => {
  it("skips $extends and known keys", () => {
    const fields = inferFieldsFromValue(
      { $extends: ["@const:flags"], a: 1, b: "x", c: true },
      new Set(["b"]),
    );
    expect(fields.map((f) => f.key)).toEqual(["a", "c"]);
  });
});

describe("inferJsonSchemaForValue", () => {
  it("emits JSON Schema types", () => {
    expect(inferJsonSchemaForValue("x")).toEqual({ type: "string" });
    expect(inferJsonSchemaForValue(3)).toEqual({ type: "integer" });
    expect(inferJsonSchemaForValue(3.5)).toEqual({ type: "number" });
    expect(inferJsonSchemaForValue(true)).toEqual({ type: "boolean" });
    expect(inferJsonSchemaForValue([1])).toEqual({ type: "array" });
    expect(inferJsonSchemaForValue({ a: 1 })).toEqual({ type: "object" });
    expect(inferJsonSchemaForValue(null)).toEqual({ type: ["string", "null"] });
    expect(inferJsonSchemaForValue("@const:x")).toEqual({});
  });
});

describe("jsonSchemaStringToFields", () => {
  it("maps properties to fields with required flags", () => {
    const { fields, error } = jsonSchemaStringToFields(
      JSON.stringify({
        type: "object",
        required: ["a"],
        properties: { a: { type: "string" }, b: { type: "integer" } },
      }),
    );
    expect(error).toBeNull();
    expect(fields.map((f) => [f.key, f.type, f.required])).toEqual([
      ["a", "string", true],
      ["b", "integer", false],
    ]);
  });

  it("treats a missing properties block as an empty schema", () => {
    expect(jsonSchemaStringToFields("{}")).toEqual({ fields: [], error: null });
  });

  it("reports invalid JSON and non-object schemas", () => {
    expect(jsonSchemaStringToFields("{bad").error).toBe("Invalid JSON");
    expect(jsonSchemaStringToFields("[1]").error).toBe(
      "Schema must be a JSON object",
    );
    expect(jsonSchemaStringToFields('{"properties":[]}').error).toBe(
      '"properties" must be an object',
    );
  });

  it("omits optional keys when not meaningful (no spurious nullable:false)", () => {
    const { fields } = jsonSchemaStringToFields(
      JSON.stringify({
        type: "object",
        required: ["a"],
        properties: { a: { type: "string" } },
      }),
    );
    expect("nullable" in fields[0]).toBe(false);
    expect("min" in fields[0]).toBe(false);
    expect("max" in fields[0]).toBe(false);
    expect("jsonSchema" in fields[0]).toBe(false);
  });

  it("round-trips a nullable string", () => {
    const { fields } = jsonSchemaStringToFields(
      JSON.stringify({
        type: "object",
        properties: { a: { type: ["string", "null"] } },
      }),
    );
    expect(fields[0].type).toBe("string");
    expect(fields[0].nullable).toBe(true);
  });
});

describe("fieldsCanonicallyEqual", () => {
  it("treats a redundant nullable:false as equal to absent", () => {
    expect(
      fieldsCanonicallyEqual(
        field({ key: "a", nullable: false }),
        field({ key: "a" }),
      ),
    ).toBe(true);
  });

  it("treats a redundant jsonSchema as equal to its reduced form", () => {
    // `{type:[string,null]}` reduces to a nullable string.
    expect(
      fieldsCanonicallyEqual(
        field({
          key: "a",
          nullable: true,
          jsonSchema: JSON.stringify({ type: ["string", "null"] }),
        }),
        field({ key: "a", nullable: true }),
      ),
    ).toBe(true);
  });

  it("distinguishes genuinely different fields", () => {
    expect(
      fieldsCanonicallyEqual(
        field({ key: "a", type: "string" }),
        field({ key: "a", type: "integer" }),
      ),
    ).toBe(false);
    expect(
      fieldsCanonicallyEqual(
        field({ key: "a", enum: ["x"] }),
        field({ key: "a", enum: ["y"] }),
      ),
    ).toBe(false);
  });
});

describe("reconcileSchemaFields", () => {
  it("reuses the exact stored object when a field is unchanged", () => {
    const stored = [
      field({ key: "a", enum: ["x"], nullable: false }),
      field({ key: "b", type: "integer" }),
    ];
    // Edited fields are the canonical (clean) forms of the same fields.
    const edited = [
      field({ key: "a", enum: ["x"] }),
      field({ key: "b", type: "integer" }),
    ];
    const result = reconcileSchemaFields(stored, edited);
    // Same references => serializes identically => no draft diff.
    expect(result[0]).toBe(stored[0]);
    expect(result[1]).toBe(stored[1]);
  });

  it("keeps the edited field when it genuinely changed", () => {
    const stored = [field({ key: "a", type: "string" })];
    const edited = [field({ key: "a", type: "integer" })];
    const result = reconcileSchemaFields(stored, edited);
    expect(result[0]).toBe(edited[0]);
  });

  it("preserves edited order and new keys", () => {
    const stored = [field({ key: "a" })];
    const edited = [field({ key: "b" }), field({ key: "a" })];
    const result = reconcileSchemaFields(stored, edited);
    expect(result.map((f) => f.key)).toEqual(["b", "a"]);
    expect(result[1]).toBe(stored[0]);
  });
});

describe("jsonValueImporter", () => {
  it("infers fields from a JSON object", () => {
    const { fields, warnings } = jsonValueImporter.parse('{"a":1,"b":"x"}');
    expect(warnings).toEqual([]);
    expect(fields.map((f) => f.key)).toEqual(["a", "b"]);
  });

  it("warns on invalid JSON", () => {
    expect(jsonValueImporter.parse("{bad").warnings).toEqual(["Invalid JSON"]);
  });

  it("warns when the top level is not an object", () => {
    expect(jsonValueImporter.parse("[1,2]").warnings).toEqual([
      "Expected a JSON object",
    ]);
  });
});
