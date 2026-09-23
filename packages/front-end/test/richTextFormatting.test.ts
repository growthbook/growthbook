import { describe, expect, it } from "vitest";
import { hasMarkdownFormatting } from "@/ui/richTextFormatting";

describe("hasMarkdownFormatting", () => {
  it.each([
    ["**bold**"],
    ["__bold__"],
    ["some *emphasis* here"],
    ["some _emphasis_ here"],
    ["~~struck~~"],
    ["`code`"],
    ["# Heading"],
    ["### Heading"],
    ["> a quote"],
    ["- item"],
    ["1. item"],
    ["```\ncode\n```"],
    ["see [the docs](https://example.com)"],
    ["![floorplan](https://example.com/a.png)"],
    ["plain first line\n\n- then a list"],
  ])("finds formatting in %j", (markdown) => {
    expect(hasMarkdownFormatting(markdown)).toBe(true);
  });

  it.each([
    [""],
    ["   "],
    ["just some plain words"],
    ["two lines\nof plain text"],
    ["escaped \\*not emphasis\\*"],
    ["escaped \\# not a heading"],
    ["snake_case_identifier"],
    ["5 * 3 = 15"],
    ["a lone * star"],
    ["#hashtag without a space"],
  ])("finds none in %j", (markdown) => {
    expect(hasMarkdownFormatting(markdown)).toBe(false);
  });
});
