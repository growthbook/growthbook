import { SchemaField } from "../types/feature";
import {
  fieldsCanonicallyEqual,
  fieldsToTsType,
  inferFieldFromValue,
  inferFieldsFromValue,
  inferJsonSchemaForValue,
  jsonSchemaStringToFields,
  jsonValueConverter,
  reconcileSchemaFields,
  tsTypesToFields,
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
    expect(jsonSchemaStringToFields("{}")).toEqual({
      fields: [],
      error: null,
      warnings: [],
    });
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

describe("tsTypesToFields", () => {
  const parse = (src: string) => tsTypesToFields(src);

  it("parses an interface with primitives, optional, and arrays", () => {
    const { fields, error } = parse(`
      interface Config {
        name: string;
        count: number;
        enabled?: boolean;
        tags: string[];
      }
    `);
    expect(error).toBeNull();
    expect(fields.map((f) => [f.key, f.type, f.required])).toEqual([
      ["name", "string", true],
      ["count", "float", true],
      ["enabled", "boolean", false],
      ["tags", "string", true],
    ]);
    // arrays become the array preset
    expect(JSON.parse(fields[3].jsonSchema as string)).toEqual({
      type: "array",
    });
  });

  it("maps a string-literal union to an enum", () => {
    const { fields } = parse(`type T = { mode: "a" | "b" | "c" }`);
    expect(fields[0].type).toBe("string");
    expect(fields[0].enum).toEqual(["a", "b", "c"]);
  });

  it("lifts `| null` to nullable", () => {
    const { fields } = parse(`interface T { x: string | null }`);
    expect(fields[0].nullable).toBe(true);
  });

  it("treats nested objects as the object preset", () => {
    const { fields } = parse(`interface T { addr: { city: string } }`);
    expect(JSON.parse(fields[0].jsonSchema as string)).toEqual({
      type: "object",
    });
  });

  it("captures JSDoc as the field description", () => {
    const { fields } = parse(`
      interface T {
        /** The shipping method */
        ship: string;
      }
    `);
    expect(fields[0].description).toBe("The shipping method");
  });

  it("handles members separated only by newlines and multi-line unions", () => {
    const { fields } = parse(`
      interface T {
        a: string
        mode:
          | "x"
          | "y"
        b: number
      }
    `);
    expect(fields.map((f) => f.key)).toEqual(["a", "mode", "b"]);
    expect(fields[1].enum).toEqual(["x", "y"]);
  });

  it("degrades unknown / union types to any with a warning", () => {
    const { fields, warnings } = parse(`interface T { weird: Foo | Bar }`);
    expect(fields[0].jsonSchema).toBe(JSON.stringify({}));
    expect(warnings.some((w) => w.code === "unresolved-type")).toBe(true);
  });

  it("reports a missing type definition", () => {
    expect(parse("just some text").error).toMatch(/No type definition/);
  });

  it("warns about dropped sibling declarations and non-object roots", () => {
    const { fields, warnings } = parse(`
      type Node = File | Directory;
      interface File {
        path: string;
      }
      interface Directory {
        path: string;
      }
    `);
    // Only the first object type (File) is imported.
    expect(fields.map((f) => f.key)).toEqual(["path"]);
    // Directory is a dropped object declaration.
    expect(
      warnings.some(
        (w) => w.code === "dropped-declaration" && w.path === "Directory",
      ),
    ).toBe(true);
    // Node is a non-object (union) root.
    expect(
      warnings.some((w) => w.code === "non-object-root" && w.path === "Node"),
    ).toBe(true);
  });

  it("does not warn for a single interface", () => {
    const { warnings } = parse(`interface Solo { a: string }`);
    expect(
      warnings.filter(
        (w) => w.code === "dropped-declaration" || w.code === "non-object-root",
      ),
    ).toEqual([]);
  });

  it("flags skipped members as unsupported", () => {
    const { warnings } = parse(`interface T { [key: string]: unknown }`);
    expect(warnings.some((w) => w.code === "unsupported-member")).toBe(true);
  });
});

describe("fieldsToTsType", () => {
  it("serializes fields to an interface", () => {
    const fields = [
      field({ key: "name", type: "string" }),
      field({ key: "count", type: "integer", required: false }),
      field({ key: "mode", enum: ["a", "b"] }),
      field({ key: "host", type: "string", nullable: true }),
    ];
    const ts = fieldsToTsType(fields, { name: "Config" });
    expect(ts).toContain("interface Config {");
    expect(ts).toContain("name: string;");
    expect(ts).toContain("count?: number;");
    expect(ts).toContain('mode: "a" | "b";');
    expect(ts).toContain("host: string | null;");
  });

  it("adds an index signature when extensible", () => {
    const ts = fieldsToTsType([field({ key: "a" })], {
      additionalProperties: true,
    });
    expect(ts).toContain("[key: string]: unknown;");
  });

  it("round-trips through tsTypesToFields canonically", () => {
    const original = [
      field({ key: "name", type: "string" }),
      field({ key: "mode", enum: ["a", "b"] }),
      field({ key: "host", type: "string", nullable: true }),
    ];
    const { fields } = tsTypesToFields(fieldsToTsType(original));
    expect(fields.length).toBe(original.length);
    fields.forEach((f, i) => {
      expect(fieldsCanonicallyEqual(f, original[i])).toBe(true);
    });
  });
});

describe("jsonValueConverter", () => {
  it("infers fields from a JSON object", () => {
    const { fields, error, warnings } =
      jsonValueConverter.toFields('{"a":1,"b":"x"}');
    expect(error).toBeNull();
    expect(warnings).toEqual([]);
    expect(fields.map((f) => f.key)).toEqual(["a", "b"]);
  });

  it("errors on invalid JSON", () => {
    expect(jsonValueConverter.toFields("{bad").error).toBe("Invalid JSON");
  });

  it("errors when the top level is not an object", () => {
    expect(jsonValueConverter.toFields("[1,2]").error).toBe(
      "Expected a JSON object",
    );
  });
});
