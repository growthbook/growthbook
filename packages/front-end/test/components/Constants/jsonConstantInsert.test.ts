import {
  getJsonInsertContext,
  addJsonConstantExtends,
  buildStringRefInsertion,
} from "@/components/Constants/jsonConstantInsert";

// `|` marks the cursor; returns [textWithoutCaret, offset].
function caret(s: string): [string, number] {
  const offset = s.indexOf("|");
  return [s.slice(0, offset) + s.slice(offset + 1), offset];
}

describe("getJsonInsertContext", () => {
  const ctx = (s: string) => {
    const [text, offset] = caret(s);
    return getJsonInsertContext(text, offset);
  };

  it("detects a string-literal value", () => {
    expect(ctx('{ "a": "hello |" }')).toBe("string");
    expect(ctx('{ "a": "|" }')).toBe("string");
  });

  it("detects directly inside an object", () => {
    expect(ctx("{ |}")).toBe("object");
    expect(ctx('{ "a": 1, |}')).toBe("object");
  });

  it("detects directly inside an array", () => {
    expect(ctx("[ |]")).toBe("array");
    expect(ctx('{ "a": [ | ] }')).toBe("array");
  });

  it("returns none outside any container", () => {
    expect(ctx("|")).toBe("none");
    expect(ctx("42|")).toBe("none");
  });

  it("uses the innermost container and ignores braces inside strings", () => {
    expect(ctx('{ "a": { "b": | } }')).toBe("object");
    expect(ctx('{ "a": "} { |" }')).toBe("string");
  });

  it("respects escaped quotes", () => {
    expect(ctx('{ "a": "x\\"y |" }')).toBe("string");
  });

  it("detects object keys as key, not string", () => {
    expect(ctx('{ "a|": 1 }')).toBe("key");
    expect(ctx('{ "a": 1, "b|": 2 }')).toBe("key");
    expect(ctx('{ "a": { "b|": 1 } }')).toBe("key");
  });

  it("still detects string values after a key", () => {
    expect(ctx('{ "a": "b|" }')).toBe("string");
    expect(ctx('{ "a": 1, "b": "c|" }')).toBe("string");
    expect(ctx('[ "a|" ]')).toBe("string");
  });
});

describe("addJsonConstantExtends", () => {
  // Objects expand one key per line; the (short, primitive) $extends array
  // stays inline.
  it("creates a $extends array on an empty value", () => {
    expect(addJsonConstantExtends("", "cfg")).toBe(
      '{\n  "$extends": ["@const:cfg"]\n}',
    );
  });

  it("adds $extends (first) to an object with existing keys", () => {
    expect(addJsonConstantExtends('{ "a": 1 }', "cfg")).toBe(
      '{\n  "$extends": ["@const:cfg"],\n  "a": 1\n}',
    );
  });

  it("appends to an existing $extends array", () => {
    const input = '{ "$extends": ["@const:base"], "a": 1 }';
    expect(addJsonConstantExtends(input, "cfg")).toBe(
      '{\n  "$extends": ["@const:base", "@const:cfg"],\n  "a": 1\n}',
    );
  });

  it("de-dupes a reference already present", () => {
    const input = '{ "$extends": ["@const:cfg"] }';
    expect(addJsonConstantExtends(input, "cfg")).toBe(
      '{\n  "$extends": ["@const:cfg"]\n}',
    );
  });

  it("preserves inline-object $extends layers when adding a ref", () => {
    const input = '{ "$extends": ["@const:base", { "x": 1 }] }';
    const result = addJsonConstantExtends(input, "cfg");
    expect(result).not.toBeNull();
    // The inline-object layer must survive (it's a supported escape hatch).
    expect(JSON.parse(result as string)).toEqual({
      $extends: ["@const:base", { x: 1 }, "@const:cfg"],
    });
  });

  it("returns null for invalid JSON", () => {
    expect(addJsonConstantExtends('{ "a": ', "cfg")).toBe(null);
  });

  it("returns null for a non-object root (array / primitive)", () => {
    expect(addJsonConstantExtends("[1, 2]", "cfg")).toBe(null);
    expect(addJsonConstantExtends('"a string"', "cfg")).toBe(null);
  });
});

describe("buildStringRefInsertion", () => {
  const run = (s: string, key: string) => {
    const [text, offset] = caret(s);
    const ins = buildStringRefInsertion(text, offset, key);
    if (!ins) return null;
    return text.slice(0, ins.index) + ins.text + text.slice(ins.index);
  };

  it("inserts a reference inside a string value", () => {
    expect(run('{ "a": "hi |" }', "name")).toBe(
      '{ "a": "hi {{ @const:name }}" }',
    );
  });

  it("inserts a reference inside a string array entry", () => {
    expect(run('[ "|" ]', "name")).toBe('[ "{{ @const:name }}" ]');
  });

  it("snaps into a string when the caret is just past its closing quote", () => {
    // caret right after the closing quote
    expect(run('{ "a": "foo"| }', "name")).toBe(
      '{ "a": "foo{{ @const:name }}" }',
    );
    // caret 2 chars past (after the trailing comma)
    expect(run('{ "a": "foo",| }', "name")).toBe(
      '{ "a": "foo{{ @const:name }}", }',
    );
  });

  it("snaps into a string when the caret is just before its opening quote", () => {
    expect(run('{ "a": |"foo" }', "name")).toBe(
      '{ "a": "{{ @const:name }}foo" }',
    );
  });

  it("returns null when no string is within reach", () => {
    expect(run("{ |}", "name")).toBe(null);
    expect(run('{ "a": 12345|6 }', "name")).toBe(null);
  });

  it("never inserts into an object key", () => {
    // caret inside a key
    expect(run('{ "a|bc": 1 }', "name")).toBe(null);
    // caret adjacent to a key — the ±2 snapping must not land in it
    expect(run('{ "a":|1 }', "name")).toBe(null);
    expect(run('{ |"a": 1 }', "name")).toBe(null);
  });
});
