import { describe, expect, it } from "vitest";
import {
  hasMarkdownFormatting,
  htmlHasFormatting,
} from "@/ui/richTextFormatting";

describe("hasMarkdownFormatting", () => {
  it.each([
    ["**bold**"],
    ["__bold__"],
    ["some *emphasis* here"],
    ["some _emphasis_ here"],
    ["~~struck~~"],
    ["`code`"],
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
    ["   "],
    ["just some plain words"],
    ["two lines\nof plain text"],
    ["escaped \\*not emphasis\\*"],
    ["\\# not a heading"],
    ["snake_case_identifier"],
    ["5 * 3 = 15"],
    ["#hashtag without a space"],
  ])("finds none in %j", (markdown) => {
    expect(hasMarkdownFormatting(markdown)).toBe(false);
  });
});

describe("hasMarkdownFormatting tables", () => {
  it("finds a table with a delimiter row", () => {
    expect(
      hasMarkdownFormatting("| Metric | Lift |\n|:---|---:|\n| CR | +12% |"),
    ).toBe(true);
  });

  it("finds a table without outer pipes", () => {
    expect(hasMarkdownFormatting("Metric | Lift\n--- | ---:\nCR | +12%")).toBe(
      true,
    );
  });

  it("finds none in pipes without a delimiter row", () => {
    expect(hasMarkdownFormatting("| just | pipes |\n| more | pipes |")).toBe(
      false,
    );
  });
});

describe("htmlHasFormatting", () => {
  it.each([
    ["<table><tr><td>a</td></tr></table>"],
    ["<p>some <strong>bold</strong></p>"],
    ['<a href="https://example.com">link</a>'],
    ["<ul><li>item</li></ul>"],
    ["<pre><code>**literal**</code></pre>"],
    ["<p>run <code>**literal**</code></p>"],
  ])("finds formatting in %j", (html) => {
    expect(htmlHasFormatting(html)).toBe(true);
  });

  it.each([
    [""],
    ['<meta charset="utf-8"><div><span style="color:#000">| a |</span></div>'],
    ["<p>plain words</p>"],
  ])("finds none in %j", (html) => {
    expect(htmlHasFormatting(html)).toBe(false);
  });
});
