import {
  buildConstantValueMap,
  resolveConstantRefs,
  ConstantValueMap,
} from "../src/sdk-versioning/resolveConstants";

const mapOf = (
  entries: Record<string, { type: "string" | "json"; value: string }>,
): ConstantValueMap => new Map(Object.entries(entries));

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
    expect(buildConstantValueMap(constants, "production").get("host")).toEqual({
      type: "string",
      value: "prod.example.com",
      project: "",
    });
    expect(buildConstantValueMap(constants, "dev").get("host")).toEqual({
      type: "string",
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
    expect(buildConstantValueMap(constants, "dev").get("x")).toEqual({
      type: "string",
      value: "",
      project: "",
    });
  });

  it("omits a constant with no value for the environment", () => {
    const constants = [
      { key: "x", type: "string" as const, environmentValues: {} },
    ];
    expect(buildConstantValueMap(constants, "dev").has("x")).toBe(false);
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

describe("resolveConstantRefs — JSON whole-value substitution", () => {
  const map = mapOf({
    cfg: { type: "json", value: '{"a":1,"b":[2,3]}' },
    name: { type: "string", value: "world" },
  });

  it("replaces a { @const:key: true } placeholder with the JSON value", () => {
    expect(resolveConstantRefs({ "@const:cfg": true }, map)).toEqual({
      a: 1,
      b: [2, 3],
    });
  });

  it("replaces placeholders nested in objects and arrays", () => {
    expect(
      resolveConstantRefs(
        { wrapper: { "@const:cfg": true }, list: [{ "@const:cfg": true }] },
        map,
      ),
    ).toEqual({ wrapper: { a: 1, b: [2, 3] }, list: [{ a: 1, b: [2, 3] }] });
  });

  it("leaves a string constant referenced as a JSON placeholder verbatim", () => {
    expect(resolveConstantRefs({ "@const:name": true }, map)).toEqual({
      "@const:name": true,
    });
  });

  it("leaves an unknown placeholder verbatim", () => {
    expect(resolveConstantRefs({ "@const:missing": true }, map)).toEqual({
      "@const:missing": true,
    });
  });

  it("does not treat a { key: false } entry as a placeholder", () => {
    expect(resolveConstantRefs({ "@const:cfg": false }, map)).toEqual({
      "@const:cfg": false,
    });
  });

  it("interpolates string references inside JSON string leaves", () => {
    expect(
      resolveConstantRefs({ greeting: "hi {{ @const:name }}" }, map),
    ).toEqual({ greeting: "hi world" });
  });
});

describe("resolveConstantRefs — JSON spread among other keys", () => {
  const map = mapOf({
    cfg: { type: "json", value: '{"a":1,"b":2}' },
    more: { type: "json", value: '{"b":99,"c":3}' },
    name: { type: "string", value: "world" },
    list: { type: "json", value: "[1,2,3]" },
  });

  it("spreads a JSON constant into an object alongside other keys", () => {
    expect(
      resolveConstantRefs({ "@const:cfg": true, other: "bar" }, map),
    ).toEqual({ a: 1, b: 2, other: "bar" });
  });

  it("spreads multiple constants in order, later keys/constants winning", () => {
    // cfg → {a:1,b:2}, then more → {b:99,c:3} overrides cfg.b.
    expect(
      resolveConstantRefs(
        { ref: 3, "@const:cfg": true, "@const:more": true },
        map,
      ),
    ).toEqual({ ref: 3, a: 1, b: 99, c: 3 });
  });

  it("lets an explicit key listed after a spread win", () => {
    expect(
      resolveConstantRefs({ "@const:cfg": true, b: "override" }, map),
    ).toEqual({ a: 1, b: "override" });
  });

  it("lets a spread listed after an explicit key override it", () => {
    expect(
      resolveConstantRefs({ b: "first", "@const:cfg": true }, map),
    ).toEqual({ a: 1, b: 2 });
  });

  it("spreads inside nested objects", () => {
    expect(
      resolveConstantRefs(
        { wrapper: { "@const:cfg": true, extra: true } },
        map,
      ),
    ).toEqual({ wrapper: { a: 1, b: 2, extra: true } });
  });

  it("leaves a non-object constant (array) verbatim when among other keys", () => {
    expect(resolveConstantRefs({ "@const:list": true, other: 1 }, map)).toEqual(
      { "@const:list": true, other: 1 },
    );
  });

  it("leaves a type-mismatched (string) constant verbatim when among other keys", () => {
    expect(resolveConstantRefs({ "@const:name": true, other: 1 }, map)).toEqual(
      { "@const:name": true, other: 1 },
    );
  });

  it("spreads inside an object nested in an array element", () => {
    expect(
      resolveConstantRefs({ list: [{ "@const:cfg": true, x: 1 }] }, map),
    ).toEqual({ list: [{ a: 1, b: 2, x: 1 }] });
  });

  it("resolves deeply nested placeholders through objects and arrays", () => {
    expect(
      resolveConstantRefs({ outer: [{ inner: { "@const:cfg": true } }] }, map),
    ).toEqual({ outer: [{ inner: { a: 1, b: 2 } }] });
  });

  it("spreads multiple constants across separate array elements", () => {
    expect(
      resolveConstantRefs(
        { rows: [{ "@const:cfg": true }, { "@const:more": true, id: 9 }] },
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

describe("resolveConstantRefs — nested constants and cycles", () => {
  it("resolves a JSON constant that references another constant", () => {
    const map = mapOf({
      inner: { type: "json", value: '{"x":1}' },
      outer: { type: "json", value: '{"nested":{"@const:inner":true}}' },
    });
    expect(resolveConstantRefs({ "@const:outer": true }, map)).toEqual({
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

  it("resolves a constant that spreads another constant among its keys", () => {
    const map = mapOf({
      inner: { type: "json", value: '{"b":2}' },
      outer: { type: "json", value: '{"a":1,"@const:inner":true}' },
    });
    expect(resolveConstantRefs({ "@const:outer": true }, map)).toEqual({
      a: 1,
      b: 2,
    });
  });

  it("resolves a JSON constant whose string leaf references a string constant", () => {
    const map = mapOf({
      name: { type: "string", value: "world" },
      cfg: { type: "json", value: '{"greeting":"hi {{@const:name}}"}' },
    });
    expect(resolveConstantRefs({ "@const:cfg": true }, map)).toEqual({
      greeting: "hi world",
    });
  });

  it("resolves a three-level JSON constant chain", () => {
    const map = mapOf({
      c: { type: "json", value: '{"z":1}' },
      b: { type: "json", value: '{"wrap":{"@const:c":true}}' },
      a: { type: "json", value: '{"top":{"@const:b":true}}' },
    });
    expect(resolveConstantRefs({ "@const:a": true }, map)).toEqual({
      top: { wrap: { z: 1 } },
    });
  });

  it("renders a self-referential constant verbatim (cycle guard)", () => {
    const map = mapOf({
      loop: { type: "json", value: '{"@const:loop":true}' },
    });
    expect(resolveConstantRefs({ "@const:loop": true }, map)).toEqual({
      "@const:loop": true,
    });
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
      loop: { type: "json", value: '{"@const:loop":true}' },
    });
    const cycles: string[] = [];
    resolveConstantRefs({ "@const:loop": true }, map, new Set(), (key) =>
      cycles.push(key),
    );
    expect(cycles).toEqual(["loop"]);
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
    expect(buildConstantValueMap(constants, "dev").get("x")).toEqual({
      type: "json",
      value: "",
      archived: true,
      project: "",
    });
  });
});

describe("resolveConstantRefs — archived scrubbing", () => {
  const map: ConstantValueMap = new Map([
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

  it("scrubs an archived whole-value JSON reference to an empty object", () => {
    expect(resolveConstantRefs({ "@const:gone-json": true }, map)).toEqual({});
  });

  it("drops an archived spread reference but keeps sibling keys", () => {
    expect(
      resolveConstantRefs({ "@const:gone-json": true, keep: "yes" }, map),
    ).toEqual({ keep: "yes" });
  });

  it("strips an archived reference regardless of declared type", () => {
    // archived JSON constant referenced via string interpolation
    expect(resolveConstantRefs("a{{ @const:gone-json }}b", map)).toBe("ab");
  });

  it("scrubs an archived constant referenced transitively through a live one", () => {
    // A live JSON constant whose body references an archived JSON constant, and
    // a live string constant whose value contains an archived string interp.
    const nested: ConstantValueMap = new Map([
      ["gone", { type: "string", value: "old", archived: true }],
      ["gone-json", { type: "json", value: '{"a":1}', archived: true }],
      [
        "live-json",
        {
          type: "json",
          value: '{"nested":{"@const:gone-json":true},"keep":1}',
        },
      ],
      ["live-str", { type: "string", value: "x={{ @const:gone }}!" }],
    ]);
    // Spread ref to the archived constant inside the live constant's body is dropped.
    expect(resolveConstantRefs({ "@const:live-json": true }, nested)).toEqual({
      nested: {},
      keep: 1,
    });
    // Archived string interp inside the live constant's value is stripped.
    expect(resolveConstantRefs("{{ @const:live-str }}", nested)).toBe("x=!");
  });
});

describe("resolveConstantRefs — project scoping", () => {
  const map: ConstantValueMap = new Map([
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

  it("scrubs an out-of-scope JSON whole-value reference to an empty object", () => {
    expect(
      resolveConstantRefs(
        { "@const:proj-a-json": true },
        map,
        undefined,
        undefined,
        "prj_b",
      ),
    ).toEqual({});
  });

  it("drops an out-of-scope JSON spread reference but keeps siblings", () => {
    expect(
      resolveConstantRefs(
        { "@const:proj-a-json": true, keep: 1 },
        map,
        undefined,
        undefined,
        "prj_b",
      ),
    ).toEqual({ keep: 1 });
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
