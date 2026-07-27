import {
  buildConstantValueMap,
  resolveConstantRefs,
  ConstantValueMap,
  ConstantValueMapEntry,
} from "../src/sdk-versioning/resolveConstants";
import {
  getConfigBaseKeys,
  linearizeConfigDag,
  resolveConfigChain,
  withConfigExtends,
} from "../src/util/configs";

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
        value: '{"retry":{"timeouts":{"connect":1000,"read":5000}}}',
      },
    });
    // Only `read` is restated; `connect` is inherited (shallow merge would drop it).
    expect(
      resolveConstantRefs(
        { $extends: ["@const:base"], retry: { timeouts: { read: 8000 } } },
        deepMap,
      ),
    ).toEqual({ retry: { timeouts: { connect: 1000, read: 8000 } } });
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

describe("resolveConstantRefs — config DAG linearization (chain parity)", () => {
  const cfg = (value: string): ConstantValueMapEntry => ({
    type: "json",
    source: "config",
    value,
    parsed: JSON.parse(value),
  });
  const cst = (value: string): ConstantValueMapEntry => ({
    type: "json",
    source: "constant",
    value,
    parsed: JSON.parse(value),
  });

  it("resolves a diamond once per ancestor (a child override beats a re-imported root)", () => {
    const map = nsMap([
      ["root", cfg('{"a":1,"b":1}')],
      ["child-a", cfg('{"$extends":["@config:root"],"a":2}')],
      ["child-b", cfg('{"$extends":["@config:root"],"b":3}')],
      ["leaf", cfg('{"$extends":["@config:child-a","@config:child-b"]}')],
    ]);
    // Chain semantics (linearizeConfigDag + resolveConfigChain): root, child-a,
    // child-b each contribute their own keys once → child-a's a:2 survives.
    expect(resolveConstantRefs({ $extends: ["@config:leaf"] }, map)).toEqual({
      a: 2,
      b: 3,
    });
    // Same when the referring value lists the bases directly.
    expect(
      resolveConstantRefs(
        { $extends: ["@config:child-a", "@config:child-b"] },
        map,
      ),
    ).toEqual({ a: 2, b: 3 });
  });

  it("deep-merges sibling config bases per key instead of clobbering wholesale", () => {
    const map = nsMap([
      ["base-1", cfg('{"cfg":{"x":1}}')],
      ["base-2", cfg('{"cfg":{"y":2}}')],
    ]);
    expect(
      resolveConstantRefs(
        { $extends: ["@config:base-1", "@config:base-2"] },
        map,
      ),
    ).toEqual({ cfg: { x: 1, y: 2 } });
  });

  it("REPLACES a constant's own object key over its @const: base (not merge)", () => {
    const map = nsMap([
      ["base", cst('{"timeouts":{"read":30,"write":60}}')],
      ["child", cst('{"$extends":["@const:base"],"timeouts":{"read":10}}')],
    ]);
    // A constant's object value is authoritative wholesale — child's `timeouts`
    // replaces the base's (write:60 dropped), unlike a config which would merge.
    expect(resolveConstantRefs({ $extends: ["@const:child"] }, map)).toEqual({
      timeouts: { read: 10 },
    });
  });

  it("a constant mixin on a config replaces its portion; config-only keys merge", () => {
    const map = nsMap([
      ["k", cst('{"feature":{"a":99}}')],
      ["parent", cfg('{"feature":{"a":1,"b":2},"other":{"y":0}}')],
      ["c", cfg('{"$extends":["@config:parent","@const:k"],"other":{"x":1}}')],
    ]);
    // k (a constant) replaces `feature` wholesale (b:2 dropped); the config-only
    // key `other` still deep-merges parent + c.
    expect(resolveConstantRefs({ $extends: ["@config:c"] }, map)).toEqual({
      feature: { a: 99 },
      other: { y: 0, x: 1 },
    });
  });

  it("keeps a sibling config's $extends chunk atomic (replaces, no per-key merge)", () => {
    const map = nsMap([
      ["chunk", cst('{"x":9}')],
      ["base-1", cfg('{"k":{"deep":1}}')],
      ["base-2", cfg('{"k":{"$extends":["@const:chunk"],"extra":2}}')],
    ]);
    expect(
      resolveConstantRefs(
        { $extends: ["@config:base-1", "@config:base-2"] },
        map,
      ),
    ).toEqual({ k: { x: 9, extra: 2 } });
  });

  it("keeps a config's own @const base flattening at its layer while linearizing @config bases", () => {
    const map = nsMap([
      ["mix", cst('{"m":5,"a":9}')],
      ["root", cfg('{"a":1,"b":1}')],
      ["child-a", cfg('{"$extends":["@config:root","@const:mix"],"a":2}')],
      ["child-b", cfg('{"$extends":["@config:root"],"b":3}')],
      ["leaf", cfg('{"$extends":["@config:child-a","@config:child-b"]}')],
    ]);
    // Layers: root {a:1,b:1} → child-a (mix assigns m:5/a:9, own a:2 wins) →
    // child-b (own b:3).
    expect(resolveConstantRefs({ $extends: ["@config:leaf"] }, map)).toEqual({
      a: 2,
      b: 3,
      m: 5,
    });
  });

  it("leaves pure-constant $extends chains on flatten semantics (no linearization)", () => {
    const map = mapOf({
      root: { type: "json", value: '{"a":1,"b":1}' },
      "child-a": { type: "json", value: '{"$extends":["@const:root"],"a":2}' },
      "child-b": { type: "json", value: '{"$extends":["@const:root"],"b":3}' },
    });
    // Each @const ref flattens independently and later refs clobber wholesale:
    // child-b re-imports root's a:1 over child-a's a:2. Pre-existing behavior.
    expect(
      resolveConstantRefs(
        { $extends: ["@const:child-a", "@const:child-b"] },
        map,
      ),
    ).toEqual({ a: 1, b: 3 });
  });

  it("lets a @const ref after the config refs clobber a config key wholesale (existing position semantics)", () => {
    const map = nsMap([
      ["ovr", cst('{"cfg":{"z":9}}')],
      ["base-1", cfg('{"cfg":{"x":1}}')],
    ]);
    expect(
      resolveConstantRefs({ $extends: ["@config:base-1", "@const:ovr"] }, map),
    ).toEqual({ cfg: { z: 9 } });
  });

  it("deep-merges config layers onto keys set by an earlier @const layer", () => {
    const map = nsMap([
      ["seed", cst('{"cfg":{"x":1}}')],
      ["base-2", cfg('{"cfg":{"y":2}}')],
    ]);
    expect(
      resolveConstantRefs({ $extends: ["@const:seed", "@config:base-2"] }, map),
    ).toEqual({ cfg: { x: 1, y: 2 } });
  });

  it("skips an archived config layer but keeps ancestors reachable via live paths", () => {
    const map = nsMap([
      ["root", cfg('{"a":1,"b":1}')],
      ["child-a", cfg('{"$extends":["@config:root"],"a":2}')],
      [
        "child-b",
        {
          type: "json",
          source: "config",
          value: "",
          archived: true,
        },
      ],
      ["leaf", cfg('{"$extends":["@config:child-a","@config:child-b"]}')],
    ]);
    expect(resolveConstantRefs({ $extends: ["@config:leaf"] }, map)).toEqual({
      a: 2,
      b: 1,
    });
  });

  it("does not drag in ancestors reachable only through a scrubbed config", () => {
    const map = nsMap([
      ["root", cfg('{"a":1}')],
      [
        "child-b",
        {
          type: "json",
          source: "config",
          value: '{"$extends":["@config:root"],"b":3}',
          archived: true,
        },
      ],
    ]);
    expect(resolveConstantRefs({ $extends: ["@config:child-b"] }, map)).toEqual(
      {},
    );
  });

  it("cuts a config DAG cycle, reports it via onCycle, and keeps own keys", () => {
    const map = nsMap([
      ["loop-a", cfg('{"$extends":["@config:loop-b"],"a":1}')],
      ["loop-b", cfg('{"$extends":["@config:loop-a"],"b":2}')],
    ]);
    const cycles: string[] = [];
    expect(
      resolveConstantRefs(
        { $extends: ["@config:loop-a"] },
        map,
        new Set(),
        (key) => cycles.push(key),
      ),
    ).toEqual({ a: 1, b: 2 });
    expect(cycles).toEqual(["loop-a"]);
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

// The editor/publish gates resolve via resolveConfigChain while the SDK
// payload resolves via resolveConstantRefs over `@config:` $extends layers —
// the two must compose identically or gates disagree with what's served.
describe("config chain ↔ payload resolution parity", () => {
  it("resolves a parent + mixin DAG identically on both paths", () => {
    const configs = [
      { key: "p", value: '{"opts":{"a":1},"top":1}' },
      { key: "m", value: '{"opts":{"b":2}}' },
      { key: "l", parent: "p", extends: ["m"], value: '{"opts":{"c":3}}' },
    ];
    const byKey = new Map(configs.map((c) => [c.key, c]));

    const chainValue: Record<string, unknown> = {};
    for (const f of resolveConfigChain(linearizeConfigDag("l", byKey)).fields) {
      if (f.source !== null) chainValue[f.key] = f.value;
    }

    // Payload path: each config's resolvable value synthesizes its bases as
    // `@config:` $extends entries (see configToResolvable).
    const map = mapOf(
      Object.fromEntries(
        configs.map((c) => [
          c.key,
          {
            type: "json" as const,
            source: "config" as const,
            value: withConfigExtends(c.value, getConfigBaseKeys(c)),
          },
        ]),
      ),
    );
    const payloadValue = resolveConstantRefs({ $extends: ["@config:l"] }, map);

    expect(chainValue).toEqual({ opts: { a: 1, b: 2, c: 3 }, top: 1 });
    expect(payloadValue).toEqual(chainValue);
  });

  it("config Resolved tab (chain + squashed constants) matches the payload", () => {
    // Mirrors the config detail page: resolveConfigChain merges the lineage and
    // leaves `@const:` refs raw, then squashConstants (= resolveConstantRefs)
    // resolves them per field. That two-stage path must equal the single-stage
    // SDK payload for the same graph — including a constant object ref inside a
    // field and a lineage deep-merge.
    const constants = { pal: '{"primary":"#000","secondary":"#fff"}' };
    const configs = [
      {
        key: "base",
        value:
          '{"colors":{"$extends":["@const:pal"],"primary":"#111"},"size":1}',
      },
      { key: "child", parent: "base", value: '{"size":2}' },
    ];
    const map = mapOf({
      pal: { type: "json", value: constants.pal, source: "constant" },
      ...Object.fromEntries(
        configs.map((c) => [
          c.key,
          {
            type: "json" as const,
            source: "config" as const,
            value: withConfigExtends(c.value, getConfigBaseKeys(c)),
          },
        ]),
      ),
    });
    const byKey = new Map(configs.map((c) => [c.key, c]));

    // Stage 1 + 2: chain merge, then squash each field's constants.
    const resolvedTab: Record<string, unknown> = {};
    for (const f of resolveConfigChain(linearizeConfigDag("child", byKey))
      .fields) {
      if (f.source !== null)
        resolvedTab[f.key] = resolveConstantRefs(f.value, map);
    }

    const payload = resolveConstantRefs({ $extends: ["@config:child"] }, map);

    expect(resolvedTab).toEqual({
      colors: { primary: "#111", secondary: "#fff" },
      size: 2,
    });
    expect(payload).toEqual(resolvedTab);
  });
});

describe("resolveConstantRefs — scopedOverrides (env/project flavors)", () => {
  const cfg = (
    value: string,
    scopedOverrides?: ConstantValueMapEntry["scopedOverrides"],
  ): ConstantValueMapEntry => ({
    type: "json",
    source: "config",
    value,
    parsed: JSON.parse(value),
    ...(scopedOverrides ? { scopedOverrides } : {}),
  });
  // resolveConstantRefs(value, map, visited, onCycle, featureProject, environment)
  const resolveFor = (
    value: unknown,
    map: ConstantValueMap,
    environment?: string,
    project?: string,
  ) =>
    resolveConstantRefs(
      value,
      map,
      undefined,
      undefined,
      project ?? "",
      environment,
    );

  it("applies the matching env flavor's patch on top of the base config", () => {
    const map = nsMap([
      [
        "base",
        cfg('{"timeout":3,"color":"red"}', [
          { config: "base-prod", environments: ["production"] },
        ]),
      ],
      ["base-prod", cfg('{"$extends":["@config:base"],"timeout":5}')],
    ]);
    // prod → base deep-merged with the flavor patch
    expect(
      resolveFor({ $extends: ["@config:base"] }, map, "production"),
    ).toEqual({ timeout: 5, color: "red" });
    // dev → no matching flavor → base only
    expect(resolveFor({ $extends: ["@config:base"] }, map, "dev")).toEqual({
      timeout: 3,
      color: "red",
    });
    // no environment → base only (env-agnostic callers unaffected)
    expect(resolveFor({ $extends: ["@config:base"] }, map)).toEqual({
      timeout: 3,
      color: "red",
    });
  });

  it("resolves a flavor's own @config: mixin (beyond the base) as a first-class layer", () => {
    const map = nsMap([
      [
        "base",
        cfg('{"timeout":3,"color":"red"}', [
          { config: "base-prod", environments: ["production"] },
        ]),
      ],
      // The prod flavor extends the base (its parent — skipped, already applied)
      // AND a `prod-mixin` config. The mixin must layer in below the flavor's own
      // keys and above the base value.
      [
        "base-prod",
        cfg('{"$extends":["@config:base","@config:prod-mixin"],"timeout":5}'),
      ],
      ["prod-mixin", cfg('{"region":"eu","color":"blue"}')],
    ]);
    // prod → base(color red) < mixin(region eu, color blue) < flavor own(timeout 5)
    expect(
      resolveFor({ $extends: ["@config:base"] }, map, "production"),
    ).toEqual({ timeout: 5, color: "blue", region: "eu" });
    // dev → no matching flavor → base only (the mixin does not leak in)
    expect(resolveFor({ $extends: ["@config:base"] }, map, "dev")).toEqual({
      timeout: 3,
      color: "red",
    });
  });

  it("applies a flavored mixin's own env flavor (consistent cascade)", () => {
    // base selects base-prod for production; base-prod extends mixin; mixin has
    // its OWN prod flavor. The mixin must resolve the same way it would if the
    // feature extended it directly: mixin ⊕ mixin-prod.
    const map = nsMap([
      [
        "base",
        cfg('{"timeout":3}', [
          { config: "base-prod", environments: ["production"] },
        ]),
      ],
      [
        "base-prod",
        cfg('{"$extends":["@config:base","@config:mixin"],"timeout":5}'),
      ],
      [
        "mixin",
        cfg('{"region":"us","level":1}', [
          { config: "mixin-prod", environments: ["production"] },
        ]),
      ],
      ["mixin-prod", cfg('{"$extends":["@config:mixin"],"region":"eu"}')],
    ]);
    expect(
      resolveFor({ $extends: ["@config:base"] }, map, "production"),
    ).toEqual({ timeout: 5, region: "eu", level: 1 });
  });

  it("resolves a flavor's own @const: extends", () => {
    const map = nsMap([
      [
        "base",
        cfg('{"timeout":3}', [
          { config: "base-prod", environments: ["production"] },
        ]),
      ],
      [
        "base-prod",
        cfg('{"$extends":["@config:base","@const:prod-limits"],"timeout":5}'),
      ],
      [
        "prod-limits",
        {
          type: "json",
          source: "constant",
          value: '{"maxRetries":10}',
          parsed: { maxRetries: 10 },
        } as ConstantValueMapEntry,
      ],
    ]);
    expect(
      resolveFor({ $extends: ["@config:base"] }, map, "production"),
    ).toEqual({ timeout: 5, maxRetries: 10 });
  });

  it("skips an archived flavor, serving the base value", () => {
    const map = nsMap([
      [
        "base",
        cfg('{"timeout":3,"color":"red"}', [
          { config: "base-prod", environments: ["production"] },
        ]),
      ],
      // The prod flavor still exists (kept in the base's lineage) but is
      // archived → its patch must not apply.
      [
        "base-prod",
        {
          type: "json",
          source: "config",
          value: "",
          archived: true,
        } as ConstantValueMapEntry,
      ],
    ]);
    expect(
      resolveFor({ $extends: ["@config:base"] }, map, "production"),
    ).toEqual({ timeout: 3, color: "red" });
  });

  it("skips an archived flavor, falling through to a catch-all override", () => {
    const map = nsMap([
      [
        "base",
        cfg('{"timeout":3}', [
          { config: "base-prod", environments: ["production"] },
          { config: "base-any" },
        ]),
      ],
      [
        "base-prod",
        {
          type: "json",
          source: "config",
          value: "",
          archived: true,
        } as ConstantValueMapEntry,
      ],
      ["base-any", cfg('{"$extends":["@config:base"],"timeout":9}')],
    ]);
    // prod's specific flavor is archived → selection falls through to the
    // still-live catch-all rather than stalling on the archived match.
    expect(
      resolveFor({ $extends: ["@config:base"] }, map, "production"),
    ).toEqual({ timeout: 9 });
  });

  it("does not apply a wildcard/catch-all flavor in env-agnostic resolution", () => {
    const map = nsMap([
      ["base", cfg('{"beanType":"jelly"}', [{ config: "base_any" }])],
      ["base_any", cfg('{"$extends":["@config:base"],"beanType":"fava"}')],
    ]);
    // No environment → base only, even for a fully-wildcard (catch-all) entry.
    expect(resolveFor({ $extends: ["@config:base"] }, map)).toEqual({
      beanType: "jelly",
    });
    // With an environment the catch-all applies (confirms the guard is
    // env-conditional, not a blanket skip).
    expect(resolveFor({ $extends: ["@config:base"] }, map, "dev")).toEqual({
      beanType: "fava",
    });
  });

  it("skips a cross-project flavor first-match, falling through to the next", () => {
    const map = nsMap([
      [
        "base",
        cfg('{"region":"base"}', [
          { config: "flavor_eu", environments: ["prod"] },
          { config: "flavor_global", environments: ["prod"] },
        ]),
      ],
      // flavor_eu is scoped to project "eu"; a feature in "us" scrubs it, so the
      // resolver must fall through to flavor_global rather than stall on it.
      [
        "flavor_eu",
        {
          type: "json",
          source: "config",
          value: JSON.stringify({ $extends: ["@config:base"], region: "eu" }),
          parsed: { $extends: ["@config:base"], region: "eu" },
          project: "eu",
        } as ConstantValueMapEntry,
      ],
      ["flavor_global", cfg('{"$extends":["@config:base"],"region":"global"}')],
    ]);
    expect(
      resolveFor({ $extends: ["@config:base"] }, map, "prod", "us"),
    ).toEqual({ region: "global" });
  });

  it("cascades: a descendant's own value beats an ancestor's env flavor", () => {
    const map = nsMap([
      [
        "base",
        cfg('{"timeout":3,"color":"red"}', [
          { config: "base-prod", environments: ["production"] },
        ]),
      ],
      ["base-prod", cfg('{"$extends":["@config:base"],"timeout":5}')],
      ["child", cfg('{"$extends":["@config:base"],"timeout":9}')],
    ]);
    // child's own timeout:9 wins over base's prod-patch timeout:5; color cascades.
    expect(
      resolveFor({ $extends: ["@config:child"] }, map, "production"),
    ).toEqual({ timeout: 9, color: "red" });
  });

  it("cascades an ancestor's env flavor into a child that doesn't override it", () => {
    const map = nsMap([
      [
        "base",
        cfg('{"timeout":3,"color":"red"}', [
          { config: "base-prod", environments: ["production"] },
        ]),
      ],
      ["base-prod", cfg('{"$extends":["@config:base"],"timeout":5}')],
      ["child", cfg('{"$extends":["@config:base"],"note":"x"}')],
    ]);
    // child leaves timeout alone → inherits base's prod flavor (5).
    expect(
      resolveFor({ $extends: ["@config:child"] }, map, "production"),
    ).toEqual({ timeout: 5, color: "red", note: "x" });
  });

  it("selects the first matching flavor in scopedOverrides order", () => {
    const map = nsMap([
      [
        "base",
        cfg('{"v":0}', [
          { config: "f-a", environments: ["production"] },
          { config: "f-b", environments: ["production"] },
        ]),
      ],
      ["f-a", cfg('{"$extends":["@config:base"],"v":1}')],
      ["f-b", cfg('{"$extends":["@config:base"],"v":2}')],
    ]);
    expect(
      resolveFor({ $extends: ["@config:base"] }, map, "production"),
    ).toEqual({ v: 1 });
  });

  it("matches a project-scoped flavor by the feature's project", () => {
    const map = nsMap([
      ["base", cfg('{"v":0}', [{ config: "f-proj", projects: ["proj_1"] }])],
      ["f-proj", cfg('{"$extends":["@config:base"],"v":7}')],
    ]);
    expect(
      resolveFor({ $extends: ["@config:base"] }, map, "dev", "proj_1"),
    ).toEqual({ v: 7 });
    expect(
      resolveFor({ $extends: ["@config:base"] }, map, "dev", "proj_2"),
    ).toEqual({ v: 0 });
  });
});
