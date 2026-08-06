import { stringToBoolean, stripMarkdown } from "../../src/util";

describe("stringToBoolean", () => {
  it("should return true for truthy string values", () => {
    expect(stringToBoolean("true")).toBe(true);
    expect(stringToBoolean("yes")).toBe(true);
    expect(stringToBoolean("on")).toBe(true);
    expect(stringToBoolean("1")).toBe(true);
  });

  it("should return false for falsy string values", () => {
    expect(stringToBoolean("false")).toBe(false);
    expect(stringToBoolean("no")).toBe(false);
    expect(stringToBoolean("off")).toBe(false);
    expect(stringToBoolean("0")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(stringToBoolean("", false)).toBe(false);
    expect(stringToBoolean("", true)).toBe(false);
  });

  it("should return the default value for undefined", () => {
    expect(stringToBoolean(undefined, false)).toBe(false);
    expect(stringToBoolean(undefined, true)).toBe(true);
  });

  it("should return the default value for invalid string values", () => {
    expect(stringToBoolean("foo", true)).toBe(true);
    expect(stringToBoolean("bar", false)).toBe(false);
  });

  it("should have a default value of false if not specified", () => {
    expect(stringToBoolean("foo")).toBe(false);
  });
});

describe("stripMarkdown", () => {
  it("strips headings, emphasis, and inline code", () => {
    expect(
      stripMarkdown("# Title\n\nSome **bold** and _italic_ and `code`"),
    ).toBe("Title Some bold and italic and code");
  });

  it("reduces links to their visible text and drops images", () => {
    expect(stripMarkdown("See [the docs](https://x.com) now")).toBe(
      "See the docs now",
    );
    expect(stripMarkdown("![a chart](https://x.com/img.png) below")).toBe(
      "below",
    );
    expect(stripMarkdown("Intro ![x](y.png) outro")).toBe("Intro outro");
  });

  it("strips list markers, blockquotes, and horizontal rules", () => {
    expect(stripMarkdown("- one\n- two\n\n> quote\n\n---")).toBe(
      "one two quote",
    );
    expect(stripMarkdown("1. first\n2. second")).toBe("first second");
  });

  it("drops code fences but keeps the code text, collapsing whitespace", () => {
    expect(stripMarkdown("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("returns an empty string for empty or whitespace-only input", () => {
    expect(stripMarkdown("")).toBe("");
    expect(stripMarkdown("   \n\n  ")).toBe("");
  });
});
