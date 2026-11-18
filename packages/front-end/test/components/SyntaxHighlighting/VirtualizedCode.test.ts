import { describe, expect, it } from "vitest";
import { wrappedRows } from "@/components/SyntaxHighlighting/VirtualizedCode";

describe("wrappedRows", () => {
  it("keeps a line that fits on one row", () => {
    expect(wrappedRows("", 10)).toBe(1);
    expect(wrappedRows("0123456789", 10)).toBe(1);
  });

  it("wraps at spaces, letting the space hang", () => {
    expect(wrappedRows("01234 6789", 10)).toBe(1);
    expect(wrappedRows("01234 67890", 10)).toBe(2);
    expect(wrappedRows("0123456789 abc", 10)).toBe(2);
  });

  it("moves a long word to its own row, then breaks it", () => {
    // "key": then 25 characters: the word starts a row and takes three.
    expect(wrappedRows(`"k": ${"x".repeat(25)}`, 10)).toBe(4);
    expect(wrappedRows("x".repeat(25), 10)).toBe(3);
  });

  it("takes one row until the box is measured", () => {
    expect(wrappedRows("x".repeat(400), null)).toBe(1);
    expect(wrappedRows("x".repeat(400), 0)).toBe(1);
  });
});
