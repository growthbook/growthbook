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
    });
    expect(buildConstantValueMap(constants, "dev").get("host")).toEqual({
      type: "string",
      value: "default.example.com",
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

  it("does not treat { key: false } or multi-key objects as placeholders", () => {
    expect(resolveConstantRefs({ "@const:cfg": false }, map)).toEqual({
      "@const:cfg": false,
    });
    expect(resolveConstantRefs({ "@const:cfg": true, other: 1 }, map)).toEqual({
      "@const:cfg": true,
      other: 1,
    });
  });

  it("interpolates string references inside JSON string leaves", () => {
    expect(
      resolveConstantRefs({ greeting: "hi {{ @const:name }}" }, map),
    ).toEqual({ greeting: "hi world" });
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
