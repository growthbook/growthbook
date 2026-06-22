import {
  getJsonInsertContext,
  buildJsonConstantInsertion,
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
});

describe("buildJsonConstantInsertion", () => {
  const run = (s: string, key: string) => {
    const [text, offset] = caret(s);
    const ins = buildJsonConstantInsertion(text, offset, key);
    if (!ins) return null;
    return text.slice(0, ins.index) + ins.text + text.slice(ins.index);
  };

  it("appends an entry to an empty object (no comma, indented)", () => {
    expect(run("{|}", "cfg")).toBe('{\n  "@const:cfg": true\n}');
  });

  it("attaches a comma to the previous value and matches its indentation", () => {
    expect(run('{\n  "a": 1\n|}', "cfg")).toBe(
      '{\n  "a": 1,\n  "@const:cfg": true\n}',
    );
  });

  it("appends to the object the cursor is in even when not at the end", () => {
    // cursor right after the opening brace, existing entry follows
    expect(run('{|\n  "a": 1\n}', "cfg")).toBe(
      '{\n  "a": 1,\n  "@const:cfg": true\n}',
    );
  });

  it("doesn't double up a comma when one is already present", () => {
    expect(run('{\n  "a": 1,\n|}', "cfg")).toBe(
      '{\n  "a": 1,\n  "@const:cfg": true\n}',
    );
  });

  it("snaps to the object and appends when the caret is just past its close", () => {
    expect(run('{\n  "foo": "bar"\n}|', "cfg")).toBe(
      '{\n  "foo": "bar",\n  "@const:cfg": true\n}',
    );
  });

  it("snaps to the object and prepends a row when the caret is just before its open", () => {
    expect(run('|{\n  "foo": "bar"\n}', "cfg")).toBe(
      '{\n  "@const:cfg": true,\n  "foo": "bar"\n}',
    );
  });

  it("returns null when no object is in reach", () => {
    expect(run("[ | ]", "cfg")).toBe(null);
    expect(run('{ "a": "|" }', "cfg")).toBe(null);
    expect(run("12345|", "cfg")).toBe(null);
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
});
