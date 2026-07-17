import { SchemaField } from "../types/feature";
import {
  canonicalSchemaString,
  collectInvalidConfigValueKeys,
  diffSchemaFields,
  fieldsCanonicallyEqual,
  fieldsToProto,
  fieldsToTsType,
  fieldsToGolang,
  golangToFields,
  fieldsToRust,
  rustToFields,
  fieldsToPython,
  pythonToFields,
  protoToFields,
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
import { splitGoFieldStatements } from "../src/util/config-schema/go-fields";

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

  it("resolves $refs nested under `not` so the stored subschema is self-contained", () => {
    const { fields, warnings } = jsonSchemaStringToFields(
      JSON.stringify({
        type: "object",
        properties: { a: { type: "string", not: { $ref: "#/$defs/Banned" } } },
        $defs: { Banned: { enum: ["x"] } },
      }),
    );
    const a = JSON.parse(fields[0].jsonSchema as string);
    // The $ref must be inlined (no dangling reference to a stripped $def).
    expect(JSON.stringify(a)).not.toContain("$ref");
    expect(a.not).toEqual({ enum: ["x"] });
    expect(warnings).toEqual([]);
    // The whole point: validation no longer bricks with "can't resolve reference".
    expect(
      validateConfigValue({
        value: { a: "hello" },
        fields,
        additionalProperties: false,
      }).valid,
    ).toBe(true);
    expect(
      validateConfigValue({
        value: { a: "x" },
        fields,
        additionalProperties: false,
      }).valid,
    ).toBe(false);
  });

  it("resolves $refs under if/then/else", () => {
    const { fields } = jsonSchemaStringToFields(
      JSON.stringify({
        type: "object",
        properties: {
          a: {
            if: { $ref: "#/$defs/Cond" },
            then: { $ref: "#/$defs/Then" },
            else: { $ref: "#/$defs/Else" },
          },
        },
        $defs: {
          Cond: { const: "c" },
          Then: { type: "string" },
          Else: { type: "number" },
        },
      }),
    );
    const a = JSON.parse(fields[0].jsonSchema as string);
    expect(JSON.stringify(a)).not.toContain("$ref");
    expect(a.if).toEqual({ const: "c" });
    expect(a.then).toEqual({ type: "string" });
    expect(a.else).toEqual({ type: "number" });
  });

  it("resolves $refs under patternProperties / propertyNames / contains", () => {
    const { fields } = jsonSchemaStringToFields(
      JSON.stringify({
        type: "object",
        properties: {
          a: {
            type: "object",
            patternProperties: { "^x": { $ref: "#/$defs/V" } },
            propertyNames: { $ref: "#/$defs/N" },
          },
          b: { type: "array", contains: { $ref: "#/$defs/V" } },
        },
        $defs: {
          V: { type: "integer" },
          N: { type: "string" },
        },
      }),
    );
    const a = JSON.parse(fields[0].jsonSchema as string);
    const b = JSON.parse(fields[1].jsonSchema as string);
    expect(JSON.stringify(a)).not.toContain("$ref");
    expect(JSON.stringify(b)).not.toContain("$ref");
    expect(a.patternProperties["^x"]).toEqual({ type: "integer" });
    expect(a.propertyNames).toEqual({ type: "string" });
    expect(b.contains).toEqual({ type: "integer" });
  });

  it("resolves $refs under prefixItems / dependentSchemas", () => {
    const { fields } = jsonSchemaStringToFields(
      JSON.stringify({
        type: "object",
        properties: {
          a: {
            type: "array",
            prefixItems: [{ $ref: "#/$defs/First" }],
          },
          b: {
            type: "object",
            dependentSchemas: { c: { $ref: "#/$defs/Dep" } },
          },
        },
        $defs: {
          First: { type: "string" },
          Dep: { type: "object" },
        },
      }),
    );
    const a = JSON.parse(fields[0].jsonSchema as string);
    const b = JSON.parse(fields[1].jsonSchema as string);
    expect(JSON.stringify(a)).not.toContain("$ref");
    expect(JSON.stringify(b)).not.toContain("$ref");
    expect(a.prefixItems).toEqual([{ type: "string" }]);
    expect(b.dependentSchemas.c).toEqual({ type: "object" });
  });

  it("warns (not silently) when ref resolution overflows the depth cap", () => {
    // A chain of $defs deeper than MAX_REF_DEPTH forces the depth bail.
    const depth = 20;
    const defs: Record<string, unknown> = {};
    for (let i = 0; i < depth; i++) {
      defs[`D${i}`] =
        i === depth - 1
          ? { type: "string" }
          : {
              type: "object",
              properties: { next: { $ref: `#/$defs/D${i + 1}` } },
            };
    }
    const { warnings } = jsonSchemaStringToFields(
      JSON.stringify({
        type: "object",
        properties: { root: { $ref: "#/$defs/D0" } },
        $defs: defs,
      }),
    );
    expect(warnings.some((w) => w.code === "unresolved-type")).toBe(true);
    expect(warnings.some((w) => /depth/i.test(w.message))).toBe(true);
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

  it("keeps null in a nested nullable literal union's enum", () => {
    // A nullable enum must list null explicitly, else JSON Schema rejects the
    // null its widened type permits. Nested here because a top-level nullable
    // literal reduces to a simple field and recompiles correctly on its own.
    const { fields } = parse(
      `interface T { status: { code: "a" | "b" | null } }`,
    );
    const status = JSON.parse(fields[0].jsonSchema as string) as {
      properties: { code: { type: unknown; enum: unknown } };
    };
    expect(status.properties.code.type).toEqual(["string", "null"]);
    expect(status.properties.code.enum).toEqual(["a", "b", null]);
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

  it("renders a nullable+optional field as `?: T | null` (not loose `?: T`)", () => {
    const ts = fieldsToTsType(
      [
        field({
          key: "fallbackRegion",
          type: "string",
          nullable: true,
          required: false,
        }),
      ],
      { name: "Config" },
    );
    expect(ts).toContain("fallbackRegion?: string | null;");
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

  it("does not enforce NESTED required for a sparse patch", () => {
    // A field whose schema is a nested object with its own required keys. A
    // sparse patch that fills in only part of that object (inheriting the rest)
    // must not be rejected — completeness isn't enforced at any depth unless
    // requireAll is set.
    const nested: SchemaField[] = [
      field({
        key: "conn",
        jsonSchema: JSON.stringify({
          type: "object",
          properties: { host: { type: "string" }, port: { type: "integer" } },
          required: ["host", "port"],
        }),
      }),
    ];
    expect(
      validateConfigValue({
        value: { conn: { host: "db.internal" } },
        fields: nested,
        additionalProperties: false,
      }).valid,
    ).toBe(true);
    // But a fully-resolved value must satisfy the nested required.
    expect(
      validateConfigValue({
        value: { conn: { host: "db.internal" } },
        fields: nested,
        additionalProperties: false,
        requireAll: true,
      }).valid,
    ).toBe(false);
    // A present nested value with a wrong type is still rejected when sparse.
    expect(
      validateConfigValue({
        value: { conn: { host: 123 } },
        fields: nested,
        additionalProperties: false,
      }).valid,
    ).toBe(false);
  });

  it("does not enforce required nested under conditional/pattern subschemas for a sparse patch", () => {
    const nested: SchemaField[] = [
      field({
        key: "conn",
        jsonSchema: JSON.stringify({
          type: "object",
          properties: { mode: { type: "string" } },
          if: { properties: { mode: { const: "tls" } } },
          then: {
            properties: { cert: { type: "string" } },
            required: ["cert"],
          },
          patternProperties: {
            "^replica_": {
              type: "object",
              properties: { host: { type: "string" } },
              required: ["host"],
            },
          },
          // Draft-07 spelling (what the Ajv instance enforces): array form =
          // conditional required, schema form = dependentSchemas.
          dependencies: {
            mode: ["region"],
          },
        }),
      }),
    ];
    // Sparse: `then`/`dependencies`/`patternProperties` required keys are
    // inherited elsewhere — must not reject.
    expect(
      validateConfigValue({
        value: { conn: { mode: "tls", replica_a: {} } },
        fields: nested,
        additionalProperties: false,
      }).valid,
    ).toBe(true);
    // A present value with a wrong type under those positions is still rejected.
    expect(
      validateConfigValue({
        value: { conn: { mode: "tls", cert: 123 } },
        fields: nested,
        additionalProperties: false,
      }).valid,
    ).toBe(false);
    // requireAll enforces the conditional requireds.
    expect(
      validateConfigValue({
        value: { conn: { mode: "tls" } },
        fields: nested,
        additionalProperties: false,
        requireAll: true,
      }).valid,
    ).toBe(false);
  });

  it("preserves required under `not` (prohibition) and `if` (trigger) on sparse patches", () => {
    const nested: SchemaField[] = [
      field({
        key: "conn",
        jsonSchema: JSON.stringify({
          type: "object",
          properties: {
            mode: { type: "string" },
            tier: { type: "string" },
            legacy: { type: "boolean" },
          },
          // "legacy must be absent" — stripping this required would turn it
          // into not:{} and reject every value.
          not: { required: ["legacy"] },
          // "when mode is present, tier must be pro" — stripping the trigger's
          // required would apply the branch to every value.
          if: { required: ["mode"] },
          then: { properties: { tier: { const: "pro" } } },
        }),
      }),
    ];
    // No legacy, no mode: both constructs inert — valid.
    expect(
      validateConfigValue({
        value: { conn: { tier: "free" } },
        fields: nested,
        additionalProperties: false,
      }).valid,
    ).toBe(true);
    // The prohibition still enforces.
    expect(
      validateConfigValue({
        value: { conn: { legacy: true } },
        fields: nested,
        additionalProperties: false,
      }).valid,
    ).toBe(false);
    // The trigger still gates the branch: mode present + wrong tier rejects.
    expect(
      validateConfigValue({
        value: { conn: { mode: "x", tier: "free" } },
        fields: nested,
        additionalProperties: false,
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

describe("tsTypesToFields projection (named-type capture)", () => {
  it("captures named object types by JSON-Pointer path + root name", () => {
    const { projection } = tsTypesToFields(`
      type RetryPolicy = { maxAttempts: number; retryOn: ("5xx" | "timeout")[] };
      interface AppConfig {
        serviceName: string;
        http: { baseUrl: string; retry: RetryPolicy };
      }
    `);
    expect(projection?.rootName).toBe("AppConfig");
    // `retry` is a named type nested under the inline `http` object.
    expect(projection?.typeNames).toEqual({
      "/properties/http/properties/retry": "RetryPolicy",
    });
  });

  it("does not name inline objects, scalars, enums, or aliases", () => {
    const { projection } = tsTypesToFields(`
      type LogLevel = "debug" | "info";
      interface AppConfig {
        port: number;
        logLevel: LogLevel;
        nested: { a: string };
      }
    `);
    // LogLevel is an alias (not an object type) and `nested` is inline — neither
    // is reproduced as a named type, so no entries.
    expect(projection?.rootName).toBe("AppConfig");
    expect(projection?.typeNames).toEqual({});
  });

  it("does not run a name capture into a reference cycle", () => {
    const { projection } = tsTypesToFields(`
      interface Node { child: Node }
      interface Cfg { root: Node }
    `);
    // First Node is named; the self-cycle stops there.
    expect(projection?.typeNames).toEqual({ "/properties/root": "Node" });
  });
});

describe("fieldsToTsType with projection (named-type replay)", () => {
  const src = `
    type RetryPolicy = { maxAttempts: number; retryOn: ("5xx" | "timeout")[] };
    interface AppConfig {
      serviceName: string;
      http: { baseUrl: string; retry: RetryPolicy };
    }
  `;

  it("reproduces named interfaces from a captured projection", () => {
    const { fields, projection } = tsTypesToFields(src);
    const ts = fieldsToTsType(fields, { projection });
    // Root uses the captured name and references RetryPolicy (not inlined).
    expect(ts).toContain("interface AppConfig {");
    expect(ts).toContain("interface RetryPolicy {");
    expect(ts).toContain("retry: RetryPolicy");
    expect(ts).toContain('retryOn: ("5xx" | "timeout")[]');
    // The named type is emitted once, not inlined at the use site.
    expect(ts).not.toMatch(/retry: \{/);
  });

  it("inlines (no named subtypes) when no projection is supplied", () => {
    const { fields } = tsTypesToFields(src);
    const ts = fieldsToTsType(fields, { name: "AppConfig" });
    expect(ts).not.toContain("interface RetryPolicy");
    expect(ts).toMatch(/retry: \{/); // inlined object
  });

  it("renders against current fields, not stale source (drops a removed field)", () => {
    const { projection } = tsTypesToFields(src);
    // Simulate the schema losing `serviceName` in GB; projection is unchanged.
    const fields = [
      field({
        key: "http",
        jsonSchema: JSON.stringify({
          type: "object",
          additionalProperties: false,
          required: ["retry"],
          properties: {
            retry: {
              type: "object",
              additionalProperties: false,
              properties: { maxAttempts: { type: "number" } },
              required: ["maxAttempts"],
            },
          },
        }),
      }),
    ];
    const ts = fieldsToTsType(fields, { projection });
    expect(ts).toContain("interface RetryPolicy {");
    expect(ts).not.toContain("serviceName"); // reflects current schema, not the import
  });
});

describe("protoToFields", () => {
  it("maps scalars, repeated, optional, nested message, and enum fields", () => {
    const { fields, error } = protoToFields(`
      syntax = "proto3";
      enum LogLevel { DEBUG = 0; INFO = 1; }
      message Retry { int32 max_attempts = 1; repeated string retry_on = 2; }
      message AppConfig {
        string service_name = 1;
        int32 port = 2;
        bool enabled = 3;
        optional string region = 4;
        LogLevel log_level = 5;
        Retry retry = 6;
        repeated string origins = 7;
      }
    `);
    expect(error).toBeNull();
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.service_name.type).toBe("string");
    expect(byKey.port.type).toBe("integer");
    expect(byKey.enabled.type).toBe("boolean");
    expect(byKey.service_name.required).toBe(true);
    expect(byKey.region.required).toBe(false); // `optional` keyword
    expect(byKey.log_level.enum).toEqual(["DEBUG", "INFO"]);
    const retry = JSON.parse(byKey.retry.jsonSchema as string);
    expect(retry.properties.max_attempts).toEqual({ type: "integer" });
    expect(retry.properties.retry_on).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });

  it("picks the root message (the one nothing else references)", () => {
    const { fields } = protoToFields(`
      message Inner { string a = 1; }
      message Root { Inner inner = 1; string b = 2; }
    `);
    expect(fields.map((f) => f.key).sort()).toEqual(["b", "inner"]);
  });

  it("degrades unknown / exotic types with a warning", () => {
    const { warnings } = protoToFields(`
      message Cfg {
        google.protobuf.Timestamp ts = 1;
        bytes blob = 2;
      }
    `);
    expect(warnings.length).toBeGreaterThan(0);
    expect(
      warnings.some((w) => /unresolved type "google/.test(w.message)),
    ).toBe(true);
    expect(warnings.some((w) => /bytes/.test(w.message))).toBe(true);
  });
});

describe("fieldsToProto", () => {
  it("renders scalars, arrays, nested objects, and enums", () => {
    const fields = [
      field({ key: "service_name", type: "string" }),
      field({ key: "port", type: "integer" }),
      field({ key: "mode", enum: ["lru", "lfu"] }),
      field({
        key: "origins",
        jsonSchema: JSON.stringify({
          type: "array",
          items: { type: "string" },
        }),
      }),
      field({
        key: "http",
        jsonSchema: JSON.stringify({
          type: "object",
          properties: { base_url: { type: "string" } },
          required: ["base_url"],
        }),
      }),
    ];
    const proto = fieldsToProto(fields, { name: "AppConfig" });
    expect(proto).toContain('syntax = "proto3";');
    expect(proto).toContain("message AppConfig {");
    expect(proto).toContain("string service_name = 1;");
    expect(proto).toContain("int32 port = 2;");
    expect(proto).toMatch(/string mode = 3;.*one of/); // enum → string + comment
    expect(proto).toContain("repeated string origins = 4;");
    expect(proto).toContain("Http http = 5;"); // nested object → message ref
    expect(proto).toContain("message Http {");
    expect(proto).toContain("string base_url = 1;");
  });

  it("round-trips a message: proto → fields → proto", () => {
    const { fields } = protoToFields(
      `message Cfg { string name = 1; int32 count = 2; }`,
    );
    const proto = fieldsToProto(fields, { name: "Cfg" });
    expect(proto).toContain("string name = 1;");
    expect(proto).toContain("int32 count = 2;");
  });

  it("disambiguates colliding generated message names (valid proto3)", () => {
    // Two sibling object fields whose keys both PascalCase to `Retry`. Without
    // dedup this emitted two `message Retry {}` blocks (invalid proto3).
    const objA = JSON.stringify({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    });
    const objB = JSON.stringify({
      type: "object",
      properties: { b: { type: "integer" } },
      required: ["b"],
    });
    const proto = fieldsToProto(
      [
        field({ key: "retry", jsonSchema: objA }),
        field({ key: "Retry", jsonSchema: objB }),
      ],
      { name: "Cfg" },
    );
    const messageNames = [...proto.matchAll(/message (\w+) \{/g)].map(
      (m) => m[1],
    );
    // No duplicate message definitions, and both fields keep their own message.
    expect(new Set(messageNames).size).toBe(messageNames.length);
    expect(proto).toContain("message Retry {");
    expect(proto).toContain("message Retry2 {");
    expect(proto).toContain("string a = 1;");
    expect(proto).toContain("int32 b = 1;");
  });
});

describe("proto nullable (wrapper types)", () => {
  it("renders nullable scalars as well-known wrapper types + import", () => {
    const proto = fieldsToProto(
      [
        field({ key: "region", type: "string", nullable: true }),
        field({ key: "port", type: "integer", nullable: true }),
        field({ key: "ratio", type: "float", nullable: true }),
        field({ key: "enabled", type: "boolean", nullable: true }),
        field({ key: "name", type: "string" }), // non-nullable stays plain
      ],
      { name: "Cfg" },
    );
    expect(proto).toContain('import "google/protobuf/wrappers.proto";');
    expect(proto).toContain("google.protobuf.StringValue region = 1;");
    expect(proto).toContain("google.protobuf.Int32Value port = 2;");
    expect(proto).toContain("google.protobuf.DoubleValue ratio = 3;");
    expect(proto).toContain("google.protobuf.BoolValue enabled = 4;");
    expect(proto).toContain("string name = 5;");
  });

  it("omits the wrappers import when no nullable scalar is present", () => {
    const proto = fieldsToProto([field({ key: "name", type: "string" })], {
      name: "Cfg",
    });
    expect(proto).not.toContain("google/protobuf/wrappers.proto");
  });

  it("parses wrapper types back to nullable scalars", () => {
    const { fields } = protoToFields(`
      syntax = "proto3";
      import "google/protobuf/wrappers.proto";
      message Cfg {
        google.protobuf.StringValue region = 1;
        google.protobuf.Int32Value port = 2;
      }
    `);
    const region = fields.find((f) => f.key === "region");
    const port = fields.find((f) => f.key === "port");
    expect(region?.nullable).toBe(true);
    expect(region?.type).toBe("string");
    expect(port?.nullable).toBe(true);
    expect(port?.type).toBe("integer");
  });

  it("round-trips nullable through proto → fields → proto → fields", () => {
    const original = [
      field({ key: "region", type: "string", nullable: true }),
      field({ key: "port", type: "integer", nullable: true, required: false }),
      field({ key: "name", type: "string" }),
    ];
    const { fields } = protoToFields(fieldsToProto(original, { name: "Cfg" }));
    expect(fields.length).toBe(original.length);
    fields.forEach((f, i) => {
      expect(fieldsCanonicallyEqual(f, original[i])).toBe(true);
    });
  });
});

describe("proto projection (named-message round-trip)", () => {
  const src = `
    message RetryPolicy { int32 max_attempts = 1; }
    message AppConfig { string name = 1; RetryPolicy retry = 2; }
  `;

  it("captures proto message names by JSON-Pointer", () => {
    const { projection } = protoToFields(src);
    expect(projection?.language).toBe("protobuf");
    expect(projection?.rootName).toBe("AppConfig");
    expect(projection?.typeNames).toEqual({
      "/properties/retry": "RetryPolicy",
    });
  });

  it("replays captured message names on export", () => {
    const { fields, projection } = protoToFields(src);
    const proto = fieldsToProto(fields, { projection });
    expect(proto).toContain("message AppConfig {");
    expect(proto).toContain("message RetryPolicy {");
    expect(proto).toContain("RetryPolicy retry = 2;");
  });

  it("falls back to generated names without a projection", () => {
    const { fields } = protoToFields(src);
    const proto = fieldsToProto(fields, { name: "Cfg" });
    expect(proto).toContain("message Cfg {");
    // field key "retry" → generated "Retry", not the original "RetryPolicy"
    expect(proto).toContain("Retry retry = 2;");
    expect(proto).not.toContain("message RetryPolicy");
  });
});

describe("golang converter", () => {
  it("renders scalars, arrays, nested structs, and enums", () => {
    const fields = [
      field({ key: "service_name", type: "string" }),
      field({ key: "port", type: "integer" }),
      field({ key: "ratio", type: "float" }),
      field({ key: "enabled", type: "boolean" }),
      field({ key: "mode", enum: ["lru", "lfu"] }),
      field({
        key: "origins",
        jsonSchema: JSON.stringify({
          type: "array",
          items: { type: "string" },
        }),
      }),
      field({
        key: "http",
        jsonSchema: JSON.stringify({
          type: "object",
          properties: { base_url: { type: "string" } },
          required: ["base_url"],
        }),
      }),
    ];
    const go = fieldsToGolang(fields, { name: "AppConfig" });
    expect(go).toContain("type AppConfig struct {");
    expect(go).toContain('ServiceName string `json:"service_name"`');
    expect(go).toContain('Port int `json:"port"`');
    expect(go).toContain('Ratio float64 `json:"ratio"`');
    expect(go).toContain('Enabled bool `json:"enabled"`');
    expect(go).toMatch(/Mode string `json:"mode"` \/\/ one of/);
    expect(go).toContain('Origins []string `json:"origins"`');
    expect(go).toContain('Http Http `json:"http"`');
    expect(go).toContain("type Http struct {");
    expect(go).toContain('BaseUrl string `json:"base_url"`');
  });

  it("renders an optional/nullable field as a pointer with omitempty", () => {
    const go = fieldsToGolang([
      field({ key: "name", type: "string" }),
      field({ key: "note", type: "string", required: false }),
    ]);
    expect(go).toContain('Name string `json:"name"`');
    expect(go).toContain('Note *string `json:"note,omitempty"`');
  });

  it("round-trips a struct: go -> fields -> go (names + optionality preserved)", () => {
    const src =
      `type Cfg struct {
  Name string ` +
      '`json:"name"`' +
      `
  Count *int  ` +
      '`json:"count,omitempty"`' +
      `
}`;
    const { fields, error } = golangToFields(src);
    expect(error).toBeNull();
    const go = fieldsToGolang(fields, { name: "Cfg" });
    expect(go).toContain('Name string `json:"name"`');
    expect(go).toContain('Count *int `json:"count,omitempty"`');
  });

  it("captures and replays nested struct names by JSON-Pointer", () => {
    const src =
      `type RetryPolicy struct {
  MaxAttempts int ` +
      '`json:"max_attempts"`' +
      `
}
type AppConfig struct {
  Name  string      ` +
      '`json:"name"`' +
      `
  Retry RetryPolicy ` +
      '`json:"retry"`' +
      `
}`;
    const { fields, projection } = golangToFields(src);
    expect(projection?.language).toBe("go");
    expect(projection?.rootName).toBe("AppConfig");
    expect(projection?.typeNames).toEqual({
      "/properties/retry": "RetryPolicy",
    });
    const go = fieldsToGolang(fields, { projection });
    expect(go).toContain("type AppConfig struct {");
    expect(go).toContain("type RetryPolicy struct {");
    expect(go).toContain("Retry RetryPolicy");
  });

  it("disambiguates colliding generated struct names", () => {
    const objA = JSON.stringify({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    });
    const objB = JSON.stringify({
      type: "object",
      properties: { b: { type: "integer" } },
      required: ["b"],
    });
    const go = fieldsToGolang([
      field({ key: "retry", jsonSchema: objA }),
      field({ key: "Retry", jsonSchema: objB }),
    ]);
    const names = [...go.matchAll(/type (\w+) struct/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
    expect(go).toContain("type Retry struct {");
    expect(go).toContain("type Retry2 struct {");
  });

  it("does not hoist an inline anonymous struct's inner fields to the parent", () => {
    const src =
      `type Cfg struct {
  Nested struct {
    Inner int ` +
      '`json:"inner"`' +
      `
  } ` +
      '`json:"nested"`' +
      `
  Name string ` +
      '`json:"name"`' +
      `
}`;
    const { fields } = golangToFields(src);
    // "inner" must NOT leak up to the parent; the parent has exactly nested+name.
    expect(fields.map((f) => f.key).sort()).toEqual(["name", "nested"]);
    const nested = fields.find((f) => f.key === "nested");
    // The anonymous struct is preserved as a nested object with its own field.
    expect(JSON.parse(nested?.jsonSchema as string)).toMatchObject({
      type: "object",
      properties: { inner: { type: "integer" } },
    });
  });
});

describe("splitGoFieldStatements", () => {
  it("splits scalar field lines", () => {
    const body =
      `
  Name string ` +
      '`json:"name"`' +
      `
  Count int ` +
      '`json:"count"`' +
      `
`;
    const stmts = splitGoFieldStatements(body);
    expect(stmts.map((s) => s.kind)).toEqual(["scalar", "scalar"]);
    expect(stmts.map((s) => (s.kind === "scalar" ? s.line : ""))).toEqual([
      'Name string `json:"name"`',
      'Count int `json:"count"`',
    ]);
  });

  it("collapses an inline anonymous struct into a single field statement", () => {
    const body =
      `
  Nested struct {
    Inner int ` +
      '`json:"inner"`' +
      `
  } ` +
      '`json:"nested"`' +
      `
  Name string ` +
      '`json:"name"`' +
      `
`;
    const stmts = splitGoFieldStatements(body);
    expect(stmts.map((s) => s.kind)).toEqual(["anon-struct", "scalar"]);
    const anon = stmts[0];
    if (anon.kind !== "anon-struct") throw new Error("expected anon-struct");
    expect(anon.name).toBe("Nested");
    expect(anon.tag).toContain('json:"nested"');
    // Inner body is returned intact so it can be recursed as a nested object.
    expect(anon.innerBody).toContain('Inner int `json:"inner"`');
    // The inner line is NOT emitted as a sibling of the outer struct.
    expect(
      stmts.some((s) => s.kind === "scalar" && s.line.startsWith("Inner")),
    ).toBe(false);
  });

  it("handles nested anonymous structs (brace-balanced)", () => {
    const body =
      `
  Outer struct {
    Middle struct {
      Leaf string ` +
      '`json:"leaf"`' +
      `
    } ` +
      '`json:"middle"`' +
      `
  } ` +
      '`json:"outer"`' +
      `
`;
    const stmts = splitGoFieldStatements(body);
    expect(stmts).toHaveLength(1);
    const anon = stmts[0];
    if (anon.kind !== "anon-struct") throw new Error("expected anon-struct");
    expect(anon.name).toBe("Outer");
    // The full inner body (including the nested Middle struct) is captured.
    expect(anon.innerBody).toContain("Middle struct {");
    expect(anon.innerBody).toContain('Leaf string `json:"leaf"`');
  });
});

describe("rust converter", () => {
  it("renders scalars, arrays, nested structs, optionals, and enums", () => {
    const fields = [
      field({ key: "service_name", type: "string" }),
      field({ key: "port", type: "integer" }),
      field({ key: "note", type: "string", required: false }),
      field({ key: "mode", enum: ["lru", "lfu"] }),
      field({
        key: "origins",
        jsonSchema: JSON.stringify({
          type: "array",
          items: { type: "string" },
        }),
      }),
      field({
        key: "http",
        jsonSchema: JSON.stringify({
          type: "object",
          properties: { base_url: { type: "string" } },
          required: ["base_url"],
        }),
      }),
    ];
    const rs = fieldsToRust(fields, { name: "AppConfig" });
    expect(rs).toContain("#[derive(Serialize, Deserialize)]");
    expect(rs).toContain("pub struct AppConfig {");
    expect(rs).toContain("pub service_name: String,");
    expect(rs).toContain("pub port: i64,");
    expect(rs).toContain("pub note: Option<String>,");
    expect(rs).toMatch(/pub mode: String, \/\/ one of/);
    expect(rs).toContain("pub origins: Vec<String>,");
    expect(rs).toContain("pub http: Http,");
    expect(rs).toContain("pub struct Http {");
  });

  it("round-trips and captures/replays nested struct names", () => {
    const src = `#[derive(Serialize, Deserialize)]
pub struct Retry {
    pub max_attempts: i64,
    pub backoff_ms: Option<i64>,
}
#[derive(Serialize, Deserialize)]
pub struct AppConfig {
    pub name: String,
    pub retry: Retry,
}`;
    const { fields, projection, error } = rustToFields(src);
    expect(error).toBeNull();
    expect(projection?.language).toBe("rust");
    expect(projection?.rootName).toBe("AppConfig");
    expect(projection?.typeNames).toEqual({ "/properties/retry": "Retry" });
    const rs = fieldsToRust(fields, { projection });
    expect(rs).toContain("pub struct AppConfig {");
    expect(rs).toContain("pub struct Retry {");
    expect(rs).toContain("pub retry: Retry,");
    expect(rs).toContain("pub backoff_ms: Option<i64>,");
  });

  it("emits a serde rename when the key isn't a clean snake identifier", () => {
    const rs = fieldsToRust([field({ key: "base-url", type: "string" })]);
    expect(rs).toContain('#[serde(rename = "base-url")]');
    expect(rs).toContain("pub base_url: String,");
  });
});

describe("python converter (Pydantic)", () => {
  it("renders scalars, arrays, nested models, optionals, and enums", () => {
    const fields = [
      field({ key: "service_name", type: "string" }),
      field({ key: "port", type: "integer" }),
      field({ key: "note", type: "string", required: false }),
      field({ key: "mode", enum: ["lru", "lfu"] }),
      field({
        key: "origins",
        jsonSchema: JSON.stringify({
          type: "array",
          items: { type: "string" },
        }),
      }),
      field({
        key: "http",
        jsonSchema: JSON.stringify({
          type: "object",
          properties: { base_url: { type: "string" } },
          required: ["base_url"],
        }),
      }),
    ];
    const py = fieldsToPython(fields, { name: "AppConfig" });
    expect(py).toContain("from pydantic import BaseModel");
    expect(py).toContain("class AppConfig(BaseModel):");
    expect(py).toContain("service_name: str");
    expect(py).toContain("port: int");
    expect(py).toContain("note: Optional[str] = None");
    expect(py).toContain('mode: Literal["lru", "lfu"]');
    expect(py).toContain("origins: List[str]");
    expect(py).toContain("http: Http");
    expect(py).toContain("class Http(BaseModel):");
  });

  it("defines nested models before the models that use them", () => {
    const py = fieldsToPython(
      [
        field({
          key: "http",
          jsonSchema: JSON.stringify({
            type: "object",
            properties: { base_url: { type: "string" } },
            required: ["base_url"],
          }),
        }),
      ],
      { name: "AppConfig" },
    );
    expect(py.indexOf("class Http(BaseModel):")).toBeLessThan(
      py.indexOf("class AppConfig(BaseModel):"),
    );
  });

  it("round-trips and captures/replays nested class names", () => {
    const src = `from pydantic import BaseModel
from typing import Optional

class Retry(BaseModel):
    max_attempts: int
    backoff_ms: Optional[int] = None

class AppConfig(BaseModel):
    name: str
    retry: Retry`;
    const { fields, projection, error } = pythonToFields(src);
    expect(error).toBeNull();
    expect(projection?.language).toBe("python");
    expect(projection?.rootName).toBe("AppConfig");
    expect(projection?.typeNames).toEqual({ "/properties/retry": "Retry" });
    const py = fieldsToPython(fields, { projection });
    expect(py).toContain("class AppConfig(BaseModel):");
    expect(py).toContain("class Retry(BaseModel):");
    expect(py).toContain("retry: Retry");
    expect(py).toContain("backoff_ms: Optional[int] = None");
  });
});

describe("converter review regressions", () => {
  it("python: defines multi-level nested classes before use", () => {
    const py = fieldsToPython(
      [
        field({
          key: "outer",
          jsonSchema: JSON.stringify({
            type: "object",
            required: ["inner"],
            properties: {
              inner: {
                type: "object",
                required: ["leaf"],
                properties: { leaf: { type: "string" } },
              },
            },
          }),
        }),
      ],
      { name: "Root" },
    );
    // Inner is referenced by Outer, so it must be defined first (no NameError).
    expect(
      py.search(/class \w*Inner\w*\(BaseModel\)|class Inner\b/),
    ).toBeLessThan(py.search(/class Outer\b/));
    expect(py.search(/class Outer\b/)).toBeLessThan(py.search(/class Root\b/));
  });

  it("python: renders a numeric enum as numeric Literal (not stringified)", () => {
    const py = fieldsToPython([
      field({
        key: "level",
        jsonSchema: JSON.stringify({ type: "integer", enum: [1, 2, 3] }),
      }),
    ]);
    expect(py).toContain("Literal[1, 2, 3]");
  });

  it("go: resolves a slice-of-pointers field ([]*Foo) and picks the right root", () => {
    const src =
      `type Foo struct {
  A string ` +
      '`json:"a"`' +
      `
}
type Cfg struct {
  Items []*Foo ` +
      '`json:"items"`' +
      `
  Name  string ` +
      '`json:"name"`' +
      `
}`;
    const { fields, projection } = golangToFields(src);
    expect(fields.map((f) => f.key).sort()).toEqual(["items", "name"]);
    expect(projection?.rootName).toBe("Cfg");
    expect(projection?.typeNames).toEqual({ "/properties/items/items": "Foo" });
  });

  it("integer enum fields keep integer markers on export and re-import as integer", () => {
    const schema = simpleSchemaFieldToJSONSchema(
      field({ key: "n", type: "integer", enum: ["1", "2"] }),
    );
    expect(schema.enum).toEqual([1, 2]);
    expect(schema.multipleOf).toBe(1);
    expect(schema.format).toBe("number");
    const back = normalizeField(
      field({ key: "n", jsonSchema: JSON.stringify(schema) }),
    );
    expect(back.type).toBe("integer");
    expect(back.enum).toEqual(["1", "2"]);
  });

  it("normalizeField: an all-integer enum implies integer even without markers", () => {
    const back = normalizeField(
      field({
        key: "n",
        jsonSchema: JSON.stringify({ type: "number", enum: [1, 2] }),
      }),
    );
    expect(back.type).toBe("integer");
    const float = normalizeField(
      field({
        key: "n",
        jsonSchema: JSON.stringify({ type: "number", enum: [1.5, 2] }),
      }),
    );
    expect(float.type).toBe("float");
  });

  it("go: parses an anonymous nested struct into a nested object field (no flattening)", () => {
    const src =
      "type Cfg struct {\n" +
      '  Name string `json:"name"`\n' +
      "  Meta struct {\n" +
      '    Inner string `json:"inner"`\n' +
      '  } `json:"meta"`\n' +
      "}";
    const { fields, warnings } = golangToFields(src);
    expect(warnings).toEqual([]);
    // The inner struct is captured under `meta`, not flattened into the parent.
    expect(fields.map((f) => f.key)).toEqual(["name", "meta"]);
    const meta = fields.find((f) => f.key === "meta");
    expect(meta?.jsonSchema).toContain('"inner"');
  });

  it("golang: keeps single-line fields whose type contains braces", () => {
    // Regression: `interface{}` / `map[string]interface{}` are complete fields,
    // not multi-line embedded blocks, so they must survive import — the
    // brace-balanced splitter previously dropped them silently.
    const src =
      "type Cfg struct {\n" +
      '  Name string `json:"name"`\n' +
      '  Meta interface{} `json:"meta"`\n' +
      '  Extra map[string]interface{} `json:"extra"`\n' +
      "}";
    const { fields } = golangToFields(src);
    expect(fields.map((f) => f.key)).toEqual(["name", "meta", "extra"]);
    // The free-form map degrades to an object node, not dropped.
    const extra = fields.find((f) => f.key === "extra");
    expect(JSON.parse(extra?.jsonSchema as string).type).toBe("object");
  });

  it("python: imports a numeric Literal as a numeric enum that round-trips", () => {
    const src = "class Cfg(BaseModel):\n    level: Literal[1, 2, 3]\n";
    const { fields, warnings } = pythonToFields(src);
    expect(warnings).toEqual([]);
    expect(fields).toHaveLength(1);
    expect(fields[0].enum).toEqual(["1", "2", "3"]);
    expect(fieldsToPython(fields)).toContain("Literal[1, 2, 3]");
  });

  it("python: an unparseable Literal warns instead of importing an empty string enum", () => {
    const src = "class Cfg(BaseModel):\n    flag: Literal[True, False]\n";
    const { warnings } = pythonToFields(src);
    expect(warnings.some((w) => w.code === "unresolved-type")).toBe(true);
  });

  it("proto: a map field round-trips as map<string, V> instead of a JSON string", () => {
    const src =
      'syntax = "proto3";\nmessage Cfg {\n  map<string, int32> counts = 1;\n}';
    const res = protoToFields(src);
    const out = fieldsToProto(res.fields, { projection: res.projection });
    expect(out).toContain("map<string, int32> counts = 1;");
    expect(out).not.toContain("free-form object");
  });

  it("proto: replays imported field numbers and assigns max+1 to new fields", () => {
    const src =
      'syntax = "proto3";\nmessage Cfg {\n  string name = 1;\n  int32 count = 5;\n}';
    const res = protoToFields(src);
    const withNew = [...res.fields, field({ key: "extra", type: "boolean" })];
    const out = fieldsToProto(withNew, { projection: res.projection });
    expect(out).toContain("string name = 1;");
    expect(out).toContain("int32 count = 5;");
    expect(out).toContain("bool extra = 6;");
  });

  it("ts: disambiguates a shared captured type name when the schemas diverge", () => {
    const src =
      "interface Retry { limit: number; }\n" +
      "interface ConfigSchema {\n  a: Retry;\n  b: Retry;\n}";
    const res = tsTypesToFields(src);
    const fields = res.fields.map((f) =>
      f.key === "b"
        ? {
            ...f,
            jsonSchema: JSON.stringify({
              type: "object",
              required: ["other"],
              properties: { other: { type: "string" } },
            }),
          }
        : f,
    );
    const out = fieldsToTsType(fields, { projection: res.projection });
    expect(out).toContain("interface Retry {");
    expect(out).toContain("interface Retry2 {");
    expect(out).toMatch(/b\??: Retry2;/);
    expect(out).toMatch(/a\??: Retry;/);
  });

  it("json schema: warns when $ref nesting exceeds the depth cap", () => {
    const defs: Record<string, unknown> = { D20: { type: "string" } };
    for (let i = 0; i < 20; i++) {
      defs[`D${i}`] = {
        type: "object",
        properties: { next: { $ref: `#/$defs/D${i + 1}` } },
      };
    }
    const doc = {
      type: "object",
      properties: { root: { $ref: "#/$defs/D0" } },
      $defs: defs,
    };
    const { warnings } = jsonSchemaStringToFields(JSON.stringify(doc));
    expect(
      warnings.some(
        (w) => w.code === "unresolved-type" && w.message.includes("depth"),
      ),
    ).toBe(true);
  });

  it("ts: escapes */ in a description so it can't break out of the doc comment", () => {
    const out = fieldsToTsType([
      field({ key: "a", description: "evil */ let x = 1; /*" }),
    ]);
    expect(out).toContain("/** evil *\\/ let x = 1; /* */");
    expect(out.indexOf("*/")).toBe(out.lastIndexOf("*/"));
  });
});
