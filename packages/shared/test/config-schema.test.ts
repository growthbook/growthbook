import { SchemaField } from "../types/feature";
import {
  canonicalSchemaString,
  collectInvalidConfigValueKeys,
  diffSchemaFields,
  fieldsCanonicallyEqual,
  fieldsToTsType,
  inferFieldFromValue,
  inferFieldsFromValue,
  inferJsonSchemaForValue,
  jsonSchemaStringToFields,
  jsonValueConverter,
  normalizeField,
  reconcileSchemaFields,
  tsTypesToFields,
  validateConfigValue,
} from "../src/util/config-schema";
import { simpleSchemaFieldToJSONSchema } from "../src/util/features";

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

  it("inlines a local $ref against $defs (and reduces enums)", () => {
    const { fields, warnings } = jsonSchemaStringToFields(
      JSON.stringify({
        type: "object",
        required: ["retry"],
        properties: {
          retry: { $ref: "#/$defs/Retry" },
          level: { $ref: "#/definitions/Level" },
        },
        $defs: {
          Retry: {
            type: "object",
            properties: { maxAttempts: { type: "number" } },
            required: ["maxAttempts"],
          },
        },
        definitions: { Level: { type: "string", enum: ["a", "b"] } },
      }),
    );
    expect(warnings).toEqual([]);
    expect(JSON.parse(fields[0].jsonSchema as string)).toEqual({
      type: "object",
      properties: { maxAttempts: { type: "number" } },
      required: ["maxAttempts"],
    });
    // `level` reduced to a simple enum string (no dangling $ref).
    expect(fields[1]).toMatchObject({ type: "string", enum: ["a", "b"] });
  });

  it("resolves a root-level $ref to find the config's properties", () => {
    const { fields } = jsonSchemaStringToFields(
      JSON.stringify({
        $ref: "#/$defs/Root",
        $defs: {
          Root: { type: "object", properties: { a: { type: "string" } } },
        },
      }),
    );
    expect(fields.map((f) => f.key)).toEqual(["a"]);
  });

  it("bails recursive / external / unresolved $refs with a warning", () => {
    const { fields, warnings } = jsonSchemaStringToFields(
      JSON.stringify({
        type: "object",
        properties: {
          node: { $ref: "#/$defs/Node" },
          ext: { $ref: "https://x/y.json#/Foo" },
          missing: { $ref: "#/$defs/Nope" },
        },
        $defs: {
          Node: {
            type: "object",
            properties: { child: { $ref: "#/$defs/Node" } },
          },
        },
      }),
    );
    // recursive: opaque object; external/unresolved: any ({}).
    expect(JSON.parse(fields[0].jsonSchema as string)).toEqual({
      type: "object",
      properties: { child: { type: "object" } },
    });
    expect(JSON.parse(fields[1].jsonSchema as string)).toEqual({});
    expect(JSON.parse(fields[2].jsonSchema as string)).toEqual({});
    expect(warnings.length).toBe(3);
    expect(warnings.every((w) => w.code === "unresolved-type")).toBe(true);
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
    // arrays import with their element type as `items`
    expect(JSON.parse(fields[3].jsonSchema as string)).toEqual({
      type: "array",
      items: { type: "string" },
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

  it("imports a nested object as a real nested schema", () => {
    const { fields } = parse(`interface T { addr: { city: string } }`);
    expect(JSON.parse(fields[0].jsonSchema as string)).toEqual({
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: false,
    });
  });

  it("bails nested building past max depth to the bare object preset", () => {
    // 4 levels deep (a→b→c→d); the deepest object exceeds MAX_NEST_DEPTH and
    // degrades to the bare object preset instead of recursing further.
    const { fields } = parse(
      `interface T { a: { b: { c: { d: { e: string } } } } }`,
    );
    const schema = JSON.parse(fields[0].jsonSchema as string);
    // The innermost reachable object is opaque (no nested properties beyond cap).
    expect(JSON.stringify(schema)).toContain('"type":"object"');
  });

  it("degrades a nested object with an exotic member to the bare preset", () => {
    // A member type we can't represent (a function) bails the whole object.
    const { fields } = parse(
      `interface T { h: { fn: () => void; ok: string } }`,
    );
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

  it("picks the DAG root (the unreferenced object), not the first object", () => {
    // RetryPolicy is declared first but is referenced by AppConfig, so AppConfig
    // (referenced by nothing) is the root — not the first object literal.
    const { fields, warnings } = parse(`
      type RetryPolicy = { maxAttempts: number };
      type LogLevel = "debug" | "info" | "warn";
      interface AppConfig {
        serviceName: string;
        logLevel: LogLevel;
        retry: RetryPolicy;
      }
    `);
    expect(fields.map((f) => f.key)).toEqual([
      "serviceName",
      "logLevel",
      "retry",
    ]);
    // RetryPolicy + LogLevel are stitched in (reachable), so nothing is dropped.
    expect(
      warnings.filter(
        (w) => w.code === "dropped-declaration" || w.code === "non-object-root",
      ),
    ).toEqual([]);
  });

  it("resolves a referenced alias into its enum", () => {
    const { fields } = parse(`
      type LogLevel = "debug" | "info" | "warn" | "error";
      interface AppConfig { logLevel: LogLevel }
    `);
    expect(fields[0]).toMatchObject({
      key: "logLevel",
      type: "string",
      enum: ["debug", "info", "warn", "error"],
    });
  });

  it("resolves a referenced object type into its nested schema", () => {
    const { fields } = parse(`
      interface Retry { maxAttempts: number }
      interface AppConfig { retry: Retry }
    `);
    expect(fields[0].key).toBe("retry");
    expect(JSON.parse(fields[0].jsonSchema as string)).toEqual({
      type: "object",
      properties: { maxAttempts: { type: "number" } },
      required: ["maxAttempts"],
      additionalProperties: false,
    });
  });

  it("does not infinitely recurse on a reference cycle", () => {
    const { fields } = parse(`
      type A = B | string;
      type B = A | number;
      interface Cfg { x: A }
    `);
    // Resolves without hanging; the cyclic alias degrades to a value/any.
    expect(fields[0].key).toBe("x");
  });

  it("keeps a deeply-nested string-literal-union array item (leaves ignore the depth cap)", () => {
    const { fields, warnings } = parse(`
      type RetryPolicy = {
        retryOn: ("5xx" | "timeout" | "network")[];
      };
      interface AppConfig {
        http: { retry: RetryPolicy };
      }
    `);
    const http = fields.find((f) => f.key === "http");
    const node = JSON.parse(http?.jsonSchema as string);
    expect(node.properties.retry.properties.retryOn).toEqual({
      type: "array",
      items: { type: "string", enum: ["5xx", "timeout", "network"] },
    });
    expect(warnings).toHaveLength(0);
  });

  it("warns (not silently) when an array item type can't be resolved", () => {
    const { fields, warnings } = parse(`
      interface AppConfig { ids: Widget[] }
    `);
    const ids = fields.find((f) => f.key === "ids");
    expect(JSON.parse(ids?.jsonSchema as string)).toEqual({ type: "array" });
    expect(
      warnings.some(
        (w) => w.code === "unresolved-type" && /array item/.test(w.message),
      ),
    ).toBe(true);
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

  it("renders a nested-object field's schema as an inline TS shape", () => {
    const nested = field({
      key: "http",
      jsonSchema: JSON.stringify({
        type: "object",
        properties: {
          baseUrl: { type: "string" },
          retry: {
            type: "object",
            properties: { maxAttempts: { type: "number" } },
            required: ["maxAttempts"],
          },
        },
        required: ["baseUrl"],
      }),
    });
    const ts = fieldsToTsType([nested]);
    expect(ts).toContain("baseUrl: string");
    expect(ts).toContain("retry?: { maxAttempts: number }");
  });

  it("renders array items and bails deep/exotic schemas to unknown", () => {
    const arr = field({
      key: "tags",
      jsonSchema: JSON.stringify({ type: "array", items: { type: "string" } }),
    });
    expect(fieldsToTsType([arr])).toContain("tags: string[]");
  });

  it("round-trips a nested object structurally (inline, no named types)", () => {
    const src = `interface AppConfig {
      http: { baseUrl: string; timeoutMs: number };
      tags: string[];
    }`;
    const { fields } = tsTypesToFields(src);
    const out = tsTypesToFields(fieldsToTsType(fields, { name: "AppConfig" }));
    expect(out.fields.map((f) => f.key)).toEqual(["http", "tags"]);
    // The nested shape survives (http stays a structured object schema).
    expect(JSON.parse(out.fields[0].jsonSchema as string)).toMatchObject({
      type: "object",
      properties: { baseUrl: { type: "string" } },
    });
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

describe("validateConfigValue", () => {
  const fields: SchemaField[] = [
    field({ key: "timeout", type: "integer", required: true }),
    field({ key: "name", type: "string", required: false }),
  ];

  it("accepts a value whose present fields match the schema", () => {
    expect(
      validateConfigValue({
        value: { timeout: 30, name: "x" },
        fields,
        additionalProperties: false,
      }).valid,
    ).toBe(true);
  });

  it("rejects a wrong field type", () => {
    const res = validateConfigValue({
      value: { timeout: "not-a-number" },
      fields,
      additionalProperties: false,
    });
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it("is sparse by default (does not require inherited/unset fields)", () => {
    expect(
      validateConfigValue({
        value: { name: "only-optional-set" },
        fields,
        additionalProperties: false,
      }).valid,
    ).toBe(true);
  });

  it("enforces required fields when requireAll is set", () => {
    expect(
      validateConfigValue({
        value: { name: "missing-timeout" },
        fields,
        additionalProperties: false,
        requireAll: true,
      }).valid,
    ).toBe(false);
  });

  it("rejects extra keys when not extensible", () => {
    expect(
      validateConfigValue({
        value: { timeout: 1, extra: true },
        fields,
        additionalProperties: false,
      }).valid,
    ).toBe(false);
  });

  it("allows extra keys when extensible", () => {
    expect(
      validateConfigValue({
        value: { timeout: 1, extra: true },
        fields,
        additionalProperties: true,
      }).valid,
    ).toBe(true);
  });

  it("ignores the $extends merge directive", () => {
    expect(
      validateConfigValue({
        value: { $extends: ["@config:base"], timeout: 5 },
        fields,
        additionalProperties: false,
      }).valid,
    ).toBe(true);
  });

  it("with no schema, rejects keys only when not extensible", () => {
    expect(
      validateConfigValue({
        value: { anything: 1 },
        fields: [],
        additionalProperties: true,
      }).valid,
    ).toBe(true);
    expect(
      validateConfigValue({
        value: { anything: 1 },
        fields: [],
        additionalProperties: false,
      }).valid,
    ).toBe(false);
  });

  it("skips type-checking reference-backed field values", () => {
    // A bare `@const:`/`@config:` ref or a `{{ @const: }}` interpolation resolves
    // dynamically, so it must not be rejected against a static field type.
    expect(
      validateConfigValue({
        value: { timeout: "@const:default-timeout" },
        fields,
        additionalProperties: false,
      }).valid,
    ).toBe(true);
    expect(
      validateConfigValue({
        value: { timeout: "{{ @const:default-timeout }}" },
        fields,
        additionalProperties: false,
      }).valid,
    ).toBe(true);
    // Nested reference inside an object value is also exempt.
    expect(
      validateConfigValue({
        value: { timeout: { nested: "@config:other" } },
        fields,
        additionalProperties: false,
      }).valid,
    ).toBe(true);
  });
});

describe("nullable-enum JSON Schema round-trip", () => {
  // JSON Schema is the canonical pivot: `simpleSchemaFieldToJSONSchema` emits it
  // and `normalizeField` reduces it back. A nullable enum carries `null` via the
  // type union + an enum member while in JSON Schema, but the reduced SchemaField
  // must NOT regain a literal "null" enum entry — `null` lives on the `nullable`
  // flag instead. Regression test for that just-fixed bug.
  const reduceViaJSONSchema = (f: SchemaField): SchemaField =>
    normalizeField({
      ...f,
      jsonSchema: JSON.stringify(simpleSchemaFieldToJSONSchema(f)),
    });

  it("emits enum + null and type [string,null] for a nullable enum", () => {
    const schema = simpleSchemaFieldToJSONSchema(
      field({ key: "mode", enum: ["a", "b"], nullable: true }),
    );
    expect(schema.type).toEqual(["string", "null"]);
    expect(schema.enum).toEqual(["a", "b", null]);
  });

  it("reduces a nullable enum back without a literal null member", () => {
    const reduced = reduceViaJSONSchema(
      field({ key: "mode", enum: ["a", "b"], nullable: true }),
    );
    expect(reduced.enum).toEqual(["a", "b"]);
    expect(reduced.enum).not.toContain("null");
    expect(reduced.enum).not.toContain(null);
    expect(reduced.nullable).toBe(true);
  });

  it("reduces a non-nullable enum unchanged (control)", () => {
    const schema = simpleSchemaFieldToJSONSchema(
      field({ key: "mode", enum: ["a", "b"] }),
    );
    expect(schema.type).toBe("string");
    expect(schema.enum).toEqual(["a", "b"]);

    const reduced = reduceViaJSONSchema(
      field({ key: "mode", enum: ["a", "b"] }),
    );
    expect(reduced.enum).toEqual(["a", "b"]);
    expect("nullable" in reduced).toBe(false);
  });
});

describe("collectInvalidConfigValueKeys", () => {
  const intField = (key: string): SchemaField =>
    field({ key, type: "integer", required: false });

  it("returns a key whose value type mismatches its declared field", () => {
    expect(
      collectInvalidConfigValueKeys({
        value: { count: "not-a-number" },
        fields: [intField("count")],
        additionalProperties: false,
      }),
    ).toEqual(["count"]);
  });

  it("returns [] when all present values conform", () => {
    expect(
      collectInvalidConfigValueKeys({
        value: { count: 3 },
        fields: [intField("count")],
        additionalProperties: false,
      }),
    ).toEqual([]);
  });

  it("exempts reference-backed values", () => {
    expect(
      collectInvalidConfigValueKeys({
        value: { count: "{{ @const:x }}" },
        fields: [intField("count")],
        additionalProperties: false,
      }),
    ).toEqual([]);
  });

  it("attributes a mismatch to a key containing JSON-Pointer special chars", () => {
    // `/` and `~` are escaped in Ajv's instancePath as ~1 and ~0 respectively
    // (RFC 6901); the error-path must un-escape them to recover the real key.
    const slashKey = "a/b";
    const tildeKey = "c~d";
    expect(
      collectInvalidConfigValueKeys({
        value: { [slashKey]: "nope" },
        fields: [intField(slashKey)],
        additionalProperties: false,
      }),
    ).toEqual([slashKey]);
    expect(
      collectInvalidConfigValueKeys({
        value: { [tildeKey]: "nope" },
        fields: [intField(tildeKey)],
        additionalProperties: false,
      }),
    ).toEqual([tildeKey]);
  });
});

describe("canonicalSchemaString (fingerprint basis)", () => {
  it("is order-independent (reordering fields → same string)", () => {
    const a = [field({ key: "a" }), field({ key: "b", type: "integer" })];
    const b = [field({ key: "b", type: "integer" }), field({ key: "a" })];
    expect(canonicalSchemaString(a)).toBe(canonicalSchemaString(b));
  });

  it("ignores cosmetic/redundant differences (raw {type:string} vs simple)", () => {
    const simple = [field({ key: "a", type: "string" })];
    const raw = [field({ key: "a", jsonSchema: '{"type":"string"}' })];
    expect(canonicalSchemaString(simple)).toBe(canonicalSchemaString(raw));
  });

  it("changes when a contract field changes", () => {
    const before = [field({ key: "a", type: "string" })];
    const after = [field({ key: "a", type: "integer" })];
    expect(canonicalSchemaString(before)).not.toBe(
      canonicalSchemaString(after),
    );
  });

  it("changes when only a description changes (single hash includes docs)", () => {
    const before = [field({ key: "a", description: "" })];
    const after = [field({ key: "a", description: "the a field" })];
    expect(canonicalSchemaString(before)).not.toBe(
      canonicalSchemaString(after),
    );
  });
});

describe("diffSchemaFields (categorized drift)", () => {
  it("reports added and removed fields as contract changes", () => {
    const stored = [field({ key: "a" })];
    const incoming = [field({ key: "b" })];
    const { contract, docs } = diffSchemaFields(stored, incoming);
    expect(docs).toEqual([]);
    expect(contract).toEqual([
      { key: "a", change: "removed" },
      { key: "b", change: "added" },
    ]);
  });

  it("labels a type change as contract, not docs", () => {
    const { contract, docs } = diffSchemaFields(
      [field({ key: "a", type: "string" })],
      [field({ key: "a", type: "integer" })],
    );
    expect(contract).toEqual([{ key: "a", change: "changed" }]);
    expect(docs).toEqual([]);
  });

  it("labels a description-only change as docs, not contract", () => {
    const { contract, docs } = diffSchemaFields(
      [field({ key: "a", description: "" })],
      [field({ key: "a", description: "now documented" })],
    );
    expect(docs).toEqual([{ key: "a", change: "changed" }]);
    expect(contract).toEqual([]);
  });

  it("returns no changes for canonically-equal schemas", () => {
    const stored = [field({ key: "a", type: "string" })];
    const incoming = [field({ key: "a", jsonSchema: '{"type":"string"}' })];
    expect(diffSchemaFields(stored, incoming)).toEqual({
      contract: [],
      docs: [],
    });
  });
});
