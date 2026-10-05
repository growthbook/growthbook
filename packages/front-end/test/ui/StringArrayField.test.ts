import {
  opensAsRawText,
  parseRawText,
  rawTextSeparator,
} from "@/ui/StringArrayField";

describe("StringArrayField text mode", () => {
  const many = Array.from({ length: 200 }, (_, i) => `v${i}`);

  it("puts one value per line when a comma doesn't end a value", () => {
    expect(rawTextSeparator(["Enter", "Tab"])).toBe("\n");
    expect(rawTextSeparator(["Enter", "Tab", ","])).toBe(",");
  });

  it("keeps a value holding a comma whole in one-per-line text", () => {
    expect(parseRawText("Portland, OR\r\n v1 \n\nv2", "\n")).toEqual([
      "Portland, OR",
      "v1",
      "v2",
    ]);
    expect(parseRawText("a, b,,c", ",")).toEqual(["a", "b", "c"]);
  });

  it("opens a large list as text only when its text parses back the same", () => {
    expect(opensAsRawText(many, "\n")).toBe(false);
    expect(opensAsRawText(["Portland, OR", ...many], "\n")).toBe(true);
    expect(opensAsRawText(["Portland, OR", ...many], ",")).toBe(false);
    expect(opensAsRawText([" padded", ...many], "\n")).toBe(false);
    expect(opensAsRawText(["", ...many], "\n")).toBe(false);
  });
});
