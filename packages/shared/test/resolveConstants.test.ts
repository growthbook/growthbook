import {
  buildConstantValueMap,
  resolveConstantRefs,
  ConstantValueMap,
  ConstantValueMapEntry,
} from "../src/sdk-versioning/resolveConstants";

// The value map is keyed by `source:key` (see mapKey/buildConstantValueMap), so
// test maps mirror that. Source defaults to "constant".
const mapOf = (
  entries: Record<
    string,
    { type: "string" | "json"; value: string; source?: "constant" | "config" }
  >,
): ConstantValueMap =>
  new Map(
    Object.entries(entries).map(([k, e]) => {
      // Mirror buildConstantValueMap: json values are pre-parsed onto the entry.
      let parsed: unknown;
      if (e.type === "json") {
        try {
          parsed = JSON.parse(e.value);
        } catch {
          parsed = undefined;
        }
      }
      const source = e.source ?? "constant";
      return [`${source}:${k}`, { ...e, source, parsed }];
    }),
  );

// Build a map from raw `[key, entry]` pairs, prefixing each key with its source.
const nsMap = (entries: [string, ConstantValueMapEntry][]): ConstantValueMap =>
  new Map(entries.map(([k, e]) => [`${e.source ?? "constant"}:${k}`, e]));

describe("buildConstantValueMap", () => {
  it("uses the environment override when present, else the default value", () => {
    const constants = [
      {
        key: "host",
        type: "string" as const,
        value: "default.example.com",
        environmentValues: { production: "prod.example.com" },
      },
    ];
    expect(
      buildConstantValueMap(constants, "production").get("constant:host"),
    ).toEqual({
      type: "string",
      source: "constant",
      value: "prod.example.com",
      project: "",
    });
    expect(
      buildConstantValueMap(constants, "dev").get("constant:host"),
    ).toEqual({
      type: "string",
      source: "constant",
      value: "default.example.com",
      project: "",
    });
  });

  it("preserves an empty-string override (intentional empty)", () => {
    const constants = [
      {
        key: "x",
        type: "string" as const,
        value: "v",
        environmentValues: { dev: "" },
      },
    ];
    expect(buildConstantValueMap(constants, "dev").get("constant:x")).toEqual({
      type: "string",
      source: "constant",
      value: "",
      project: "",
    });
  });

  it("omits a constant with no value for the environment", () => {
    const constants = [
      { key: "x", type: "string" as const, environmentValues: {} },
    ];
    expect(buildConstantValueMap(constants, "dev").has("constant:x")).toBe(
      false,
    );
  });
});

describe("resolveConstantRefs — string interpolation", () => {
  const map = mapOf({
    name: { type: "string", value: "world" },
    cfg: { type: "json", value: '{"a":1}' },
  });

  it("substitutes a string constant inside a string", () => {
    expect(resolveConstantRefs("hi {{ @const:name }}!", map)).toBe("hi world!");
  });

  it("tolerates whitespace and substitutes multiple references", () => {
    expect(
      resolveConstantRefs("{{@const:name}}-{{  @const:name  }}", map),
    ).toBe("world-world");
  });

  it("leaves unknown keys verbatim", () => {
    expect(resolveConstantRefs("{{ @const:missing }}", map)).toBe(
      "{{ @const:missing }}",
    );
  });

  it("leaves a JSON constant referenced as a string verbatim (type mismatch)", () => {
    expect(resolveConstantRefs("{{ @const:cfg }}", map)).toBe(
      "{{ @const:cfg }}",
    );
  });

  it("emits a backtick-escaped reference literally, without the backticks", () => {
    expect(resolveConstantRefs("use `{{ @const:name }}` here", map)).toBe(
      "use {{ @const:name }} here",
    );
  });
});

describe("resolveConstantRefs — $extends (JSON object merge)", () => {
  const map = mapOf({
    cfg: { type: "json", value: '{"a":1,"b":[2,3]}' },
    name: { type: "string", value: "world" },
  });

  it("replaces a value that only $extends one constant with that object", () => {
    expect(resolveConstantRefs({ $extends: ["@const:cfg"] }, map)).toEqual({
      a: 1,
      b: [2, 3],
    });
  });

  it("merges $extends in nested objects and array elements", () => {
    expect(
      resolveConstantRefs(
        {
          wrapper: { $extends: ["@const:cfg"] },
          list: [{ $extends: ["@const:cfg"] }],
        },
        map,
      ),
    ).toEqual({ wrapper: { a: 1, b: [2, 3] }, list: [{ a: 1, b: [2, 3] }] });
  });

  it("skips a $extends ref to a string constant (object merge only)", () => {
    expect(resolveConstantRefs({ $extends: ["@const:name"] }, map)).toEqual({});
  });

  it("skips an unknown $extends ref", () => {
    expect(resolveConstantRefs({ $extends: ["@const:missing"] }, map)).toEqual(
      {},
    );
  });

  it("treats a non-array $extends as a normal key", () => {
    expect(resolveConstantRefs({ $extends: "nope" }, map)).toEqual({
      $extends: "nope",
    });
  });

  it("emits a backtick-escaped `$extends` key as a literal $extends data key", () => {
    expect(resolveConstantRefs({ "`$extends`": "@const:cfg" }, map)).toEqual({
      $extends: "@const:cfg",
    });
  });

  it("interpolates string references inside JSON string leaves", () => {
    expect(
      resolveConstantRefs({ greeting: "hi {{ @const:name }}" }, map),
    ).toEqual({ greeting: "hi world" });
  });
});

describe("resolveConstantRefs — $extends merge precedence", () => {
  const map = mapOf({
    cfg: { type: "json", value: '{"a":1,"b":2}' },
    more: { type: "json", value: '{"b":99,"c":3}' },
  });

  it("lets own keys override the merged base", () => {
    expect(
      resolveConstantRefs({ $extends: ["@const:cfg"], other: "bar" }, map),
    ).toEqual({ a: 1, b: 2, other: "bar" });
  });

  it("merges multiple refs in array order (later overrides earlier)", () => {
    expect(
      resolveConstantRefs(
        { $extends: ["@const:cfg", "@const:more"], ref: 3 },
        map,
      ),
    ).toEqual({ a: 1, b: 99, c: 3, ref: 3 });
  });

  it("lets own keys win regardless of where $extends appears", () => {
    expect(
      resolveConstantRefs({ b: "override", $extends: ["@const:cfg"] }, map),
    ).toEqual({ a: 1, b: "override" });
    expect(
      resolveConstantRefs({ $extends: ["@const:cfg"], b: "override" }, map),
    ).toEqual({ a: 1, b: "override" });
  });

  it("merges inside nested objects with own keys overriding", () => {
    expect(
      resolveConstantRefs(
        { wrapper: { $extends: ["@const:cfg"], extra: true } },
        map,
      ),
    ).toEqual({ wrapper: { a: 1, b: 2, extra: true } });
  });

  it("deep-merges own keys onto a nested object from the base (targeted patch)", () => {
    const deepMap = mapOf({
      base: {
        type: "json",
        value: '{"abr":{"levels":{"low":1500,"high":12000}}}',
      },
    });
    // Only `high` is restated; `low` is inherited (shallow merge would drop it).
    expect(
      resolveConstantRefs(
        { $extends: ["@const:base"], abr: { levels: { high: 16000 } } },
        deepMap,
      ),
    ).toEqual({ abr: { levels: { low: 1500, high: 16000 } } });
  });

  it("merges across separate array elements", () => {
    expect(
      resolveConstantRefs(
        {
          rows: [
            { $extends: ["@const:cfg"] },
            { $extends: ["@const:more"], id: 9 },
          ],
        },
        map,
      ),
    ).toEqual({
      rows: [
        { a: 1, b: 2 },
        { b: 99, c: 3, id: 9 },
      ],
    });
  });
});

describe("resolveConstantRefs — $extends inline objects (escape hatch)", () => {
  const map = mapOf({
    cfg: { type: "json", value: '{"a":1,"b":2}' },
    name: { type: "string", value: "world" },
  });

  it("merges an inline object at its array position", () => {
    expect(resolveConstantRefs({ $extends: [{ a: 9, x: "y" }] }, map)).toEqual({
      a: 9,
      x: "y",
    });
  });

  it("lets a later reference override an earlier inline object", () => {
    // inline {a:9} first, then cfg {a:1,b:2} → cfg's a wins
    expect(
      resolveConstantRefs({ $extends: [{ a: 9 }, "@const:cfg"] }, map),
    ).toEqual({ a: 1, b: 2 });
  });

  it("lets an inline object override an earlier reference", () => {
    expect(
      resolveConstantRefs({ $extends: ["@const:cfg", { a: 9 }] }, map),
    ).toEqual({ a: 9, b: 2 });
  });

  it("still lets own keys win over an inline object", () => {
    expect(
      resolveConstantRefs({ $extends: [{ a: 9 }], a: "own" }, map),
    ).toEqual({ a: "own" });
  });

  it("resolves references inside an inline object", () => {
    expect(
      resolveConstantRefs(
        {
          $extends: [
            { greeting: "hi {{ @const:name }}", $extends: ["@const:cfg"] },
          ],
        },
        map,
      ),
    ).toEqual({ a: 1, b: 2, greeting: "hi world" });
  });

  it("still ignores non-object, non-reference junk entries", () => {
    expect(
      resolveConstantRefs(
        { $extends: ["@const:cfg", 2, true, "nonsense"], own: 1 },
        map,
      ),
    ).toEqual({ a: 1, b: 2, own: 1 });
  });
});

describe("resolveConstantRefs — nested constants and cycles", () => {
  it("resolves a JSON constant that $extends another constant", () => {
    const map = mapOf({
      inner: { type: "json", value: '{"x":1}' },
      outer: {
        type: "json",
        value: '{"nested":{"$extends":["@const:inner"]}}',
      },
    });
    expect(resolveConstantRefs({ $extends: ["@const:outer"] }, map)).toEqual({
      nested: { x: 1 },
    });
  });

  it("resolves a string constant that references another string constant", () => {
    const map = mapOf({
      first: { type: "string", value: "Jane" },
      full: { type: "string", value: "{{ @const:first }} Doe" },
    });
    expect(resolveConstantRefs("{{ @const:full }}", map)).toBe("Jane Doe");
  });

  it("resolves a constant that $extends another among its own keys", () => {
    const map = mapOf({
      inner: { type: "json", value: '{"b":2}' },
      outer: { type: "json", value: '{"a":1,"$extends":["@const:inner"]}' },
    });
    expect(resolveConstantRefs({ $extends: ["@const:outer"] }, map)).toEqual({
      a: 1,
      b: 2,
    });
  });

  it("resolves a JSON constant whose string leaf references a string constant", () => {
    const map = mapOf({
      name: { type: "string", value: "world" },
      cfg: { type: "json", value: '{"greeting":"hi {{@const:name}}"}' },
    });
    expect(resolveConstantRefs({ $extends: ["@const:cfg"] }, map)).toEqual({
      greeting: "hi world",
    });
  });

  it("resolves a three-level JSON constant chain", () => {
    const map = mapOf({
      c: { type: "json", value: '{"z":1}' },
      b: { type: "json", value: '{"wrap":{"$extends":["@const:c"]}}' },
      a: { type: "json", value: '{"top":{"$extends":["@const:b"]}}' },
    });
    expect(resolveConstantRefs({ $extends: ["@const:a"] }, map)).toEqual({
      top: { wrap: { z: 1 } },
    });
  });

  it("drops a self-referential $extends without infinite recursion", () => {
    const map = mapOf({
      loop: { type: "json", value: '{"$extends":["@const:loop"]}' },
    });
    expect(resolveConstantRefs({ $extends: ["@const:loop"] }, map)).toEqual({});
  });

  it("breaks a two-constant cycle without infinite recursion", () => {
    const map = mapOf({
      a: { type: "string", value: "A{{ @const:b }}" },
      b: { type: "string", value: "B{{ @const:a }}" },
    });
    // a → "A" + b → "AB" + a(cycle, verbatim)
    expect(resolveConstantRefs("{{ @const:a }}", map)).toBe("AB{{ @const:a }}");
  });

  it("invokes onCycle with the key of a cyclic reference", () => {
    const map = mapOf({
      loop: { type: "json", value: '{"$extends":["@const:loop"]}' },
    });
    const cycles: string[] = [];
    resolveConstantRefs({ $extends: ["@const:loop"] }, map, new Set(), (key) =>
      cycles.push(key),
    );
    expect(cycles).toEqual(["loop"]);
  });
});

describe("resolveConstantRefs — diamond graph + cycle/cache interaction", () => {
  it("resolves a diamond (two paths to one base) consistently", () => {
    // leaf $extends b and c; both b and c $extends the same base. The shared
    // base is memoized per pass, so both paths see the same resolved object.
    const map = mapOf({
      base: { type: "json", value: '{"shared":1}' },
      b: { type: "json", value: '{"$extends":["@const:base"],"fromB":2}' },
      c: { type: "json", value: '{"$extends":["@const:base"],"fromC":3}' },
    });
    expect(
      resolveConstantRefs({ $extends: ["@const:b", "@const:c"] }, map),
    ).toEqual({ shared: 1, fromB: 2, fromC: 3 });
  });

  it("memoizes a fanned-out base so repeated paths agree", () => {
    const map = mapOf({
      base: { type: "json", value: '{"x":{"$extends":["@const:inner"]}}' },
      inner: { type: "json", value: '{"y":1}' },
    });
    expect(
      resolveConstantRefs(
        {
          one: { $extends: ["@const:base"] },
          two: { $extends: ["@const:base"] },
        },
        map,
      ),
    ).toEqual({ one: { x: { y: 1 } }, two: { x: { y: 1 } } });
  });

  it("does not infinite-loop on a self-cycle and reports it via onCycle", () => {
    const map = mapOf({
      loop: { type: "json", value: '{"$extends":["@const:loop"],"k":1}' },
    });
    const cycles: string[] = [];
    // The back-reference is cut (→ {} for the $extends), own keys survive.
    expect(
      resolveConstantRefs(
        { $extends: ["@const:loop"] },
        map,
        new Set(),
        (key) => cycles.push(key),
      ),
    ).toEqual({ k: 1 });
    expect(cycles).toEqual(["loop"]);
  });

  it("renders a mutual string cycle verbatim/truncated without looping", () => {
    const map = mapOf({
      a: { type: "string", value: "A{{ @const:b }}" },
      b: { type: "string", value: "B{{ @const:a }}" },
    });
    const cycles: string[] = [];
    // a → "A" + b → "AB" + a(cycle) left verbatim.
    expect(
      resolveConstantRefs("{{ @const:a }}", map, new Set(), (key) =>
        cycles.push(key),
      ),
    ).toBe("AB{{ @const:a }}");
    expect(cycles).toContain("a");
  });
});

describe("buildConstantValueMap — archived", () => {
  it("marks archived constants so references are scrubbed", () => {
    const constants = [
      {
        key: "x",
        type: "json" as const,
        value: '{"a":1}',
        archived: true,
      },
    ];
    expect(buildConstantValueMap(constants, "dev").get("constant:x")).toEqual({
      type: "json",
      source: "constant",
      value: "",
      archived: true,
      project: "",
    });
  });
});

describe("resolveConstantRefs — archived scrubbing", () => {
  const map: ConstantValueMap = nsMap([
    ["gone", { type: "string", value: "old", archived: true }],
    ["gone-json", { type: "json", value: '{"a":1}', archived: true }],
    ["live", { type: "string", value: "here" }],
  ]);

  it("strips an archived string reference from a string value", () => {
    expect(resolveConstantRefs("x={{ @const:gone }}!", map)).toBe("x=!");
  });

  it("keeps live references while stripping archived ones in the same string", () => {
    expect(
      resolveConstantRefs("{{ @const:live }}/{{ @const:gone }}", map),
    ).toBe("here/");
  });

  it("drops an archived $extends ref (whole value)", () => {
    expect(
      resolveConstantRefs({ $extends: ["@const:gone-json"] }, map),
    ).toEqual({});
  });

  it("drops an archived $extends ref but keeps sibling keys", () => {
    expect(
      resolveConstantRefs({ $extends: ["@const:gone-json"], keep: "yes" }, map),
    ).toEqual({ keep: "yes" });
  });

  it("strips an archived reference regardless of declared type", () => {
    // archived JSON constant referenced via string interpolation
    expect(resolveConstantRefs("a{{ @const:gone-json }}b", map)).toBe("ab");
  });

  it("scrubs an archived constant referenced transitively through a live one", () => {
    // A live JSON constant whose body references an archived JSON constant, and
    // a live string constant whose value contains an archived string interp.
    const nested: ConstantValueMap = nsMap([
      ["gone", { type: "string", value: "old", archived: true }],
      ["gone-json", { type: "json", value: '{"a":1}', archived: true }],
      [
        "live-json",
        {
          type: "json",
          value: '{"nested":{"$extends":["@const:gone-json"]},"keep":1}',
        },
      ],
      ["live-str", { type: "string", value: "x={{ @const:gone }}!" }],
    ]);
    // $extends ref to the archived constant inside the live constant's body is dropped.
    expect(
      resolveConstantRefs({ $extends: ["@const:live-json"] }, nested),
    ).toEqual({
      nested: {},
      keep: 1,
    });
    // Archived string interp inside the live constant's value is stripped.
    expect(resolveConstantRefs("{{ @const:live-str }}", nested)).toBe("x=!");
  });
});

describe("resolveConstantRefs — project scoping", () => {
  const map: ConstantValueMap = nsMap([
    ["global-str", { type: "string", value: "G", project: "" }],
    ["proj-a-str", { type: "string", value: "A", project: "prj_a" }],
    ["proj-a-json", { type: "json", value: '{"a":1}', project: "prj_a" }],
  ]);

  it("resolves a global constant for any feature project", () => {
    expect(
      resolveConstantRefs(
        "x={{ @const:global-str }}",
        map,
        undefined,
        undefined,
        "prj_b",
      ),
    ).toBe("x=G");
  });

  it("resolves a project-scoped constant for a feature in the same project", () => {
    expect(
      resolveConstantRefs(
        "x={{ @const:proj-a-str }}",
        map,
        undefined,
        undefined,
        "prj_a",
      ),
    ).toBe("x=A");
  });

  it("scrubs a project-scoped string reference for a feature in another project", () => {
    expect(
      resolveConstantRefs(
        "x={{ @const:proj-a-str }}",
        map,
        undefined,
        undefined,
        "prj_b",
      ),
    ).toBe("x=");
  });

  it("drops an out-of-scope $extends ref (whole value)", () => {
    expect(
      resolveConstantRefs(
        { $extends: ["@const:proj-a-json"] },
        map,
        undefined,
        undefined,
        "prj_b",
      ),
    ).toEqual({});
  });

  it("drops an out-of-scope $extends ref but keeps siblings", () => {
    expect(
      resolveConstantRefs(
        { $extends: ["@const:proj-a-json"], keep: 1 },
        map,
        undefined,
        undefined,
        "prj_b",
      ),
    ).toEqual({ keep: 1 });
  });
});

describe("resolveConstantRefs — @config namespace separation", () => {
  // A config (source "config") and a constant (source "constant"), exercising
  // that refs only resolve within their own namespace.
  const map: ConstantValueMap = nsMap([
    [
      "base",
      {
        type: "json",
        source: "config",
        value: '{"a":1,"b":2}',
        parsed: { a: 1, b: 2 },
      },
    ],
    [
      "cst",
      { type: "json", source: "constant", value: '{"x":9}', parsed: { x: 9 } },
    ],
    ["greeting", { type: "string", source: "constant", value: "hi" }],
  ]);

  it("resolves a config via @config: $extends", () => {
    expect(resolveConstantRefs({ $extends: ["@config:base"] }, map)).toEqual({
      a: 1,
      b: 2,
    });
  });

  it("does not resolve a config via the @const: namespace", () => {
    expect(resolveConstantRefs({ $extends: ["@const:base"] }, map)).toEqual({});
  });

  it("does not resolve a constant via the @config: namespace", () => {
    expect(resolveConstantRefs({ $extends: ["@config:cst"] }, map)).toEqual({});
  });

  it("does not interpolate a constant string via @config:", () => {
    expect(resolveConstantRefs("x={{ @config:greeting }}", map)).toBe(
      "x={{ @config:greeting }}",
    );
  });

  it("merges an override patch on top of a config base (own keys win)", () => {
    expect(
      resolveConstantRefs({ $extends: ["@config:base"], b: 99, c: 3 }, map),
    ).toEqual({ a: 1, b: 99, c: 3 });
  });
});

describe("resolveConstantRefs — config extends config", () => {
  const map: ConstantValueMap = nsMap([
    [
      "root",
      { type: "json", source: "config", value: '{"a":1}', parsed: { a: 1 } },
    ],
    [
      "child",
      {
        type: "json",
        source: "config",
        value: '{"$extends":["@config:root"],"b":2}',
        parsed: { $extends: ["@config:root"], b: 2 },
      },
    ],
  ]);

  it("flattens a config lineage through @config: refs", () => {
    expect(resolveConstantRefs({ $extends: ["@config:child"] }, map)).toEqual({
      a: 1,
      b: 2,
    });
  });
});

describe("buildConstantValueMap — source tagging", () => {
  it("tags entries with their source and defaults to constant", () => {
    const map = buildConstantValueMap(
      [
        { key: "c", type: "json", value: "{}", source: "config" },
        { key: "k", type: "string", value: "v" },
      ],
      "dev",
    );
    expect(map.get("config:c")?.source).toBe("config");
    expect(map.get("constant:k")?.source).toBe("constant");
  });
});

describe("resolveConstantRefs — passthrough", () => {
  const map = mapOf({ x: { type: "string", value: "v" } });
  it("leaves numbers, booleans, and null untouched", () => {
    expect(resolveConstantRefs(42, map)).toBe(42);
    expect(resolveConstantRefs(true, map)).toBe(true);
    expect(resolveConstantRefs(null, map)).toBe(null);
  });
  it("does not mutate the input", () => {
    const input = { a: { "@const:missing": true } };
    const copy = JSON.parse(JSON.stringify(input));
    resolveConstantRefs(input, map);
    expect(input).toEqual(copy);
  });
});
