import { describe, expect, it } from "vitest";
import {
  DraftChangeSection,
  mergeDraftChangeSections,
} from "@/components/Features/DraftChangesPopover";

const row = (text: string) => ({ label: text, value: text, text });
const section = (title: string, ...rows: string[]): DraftChangeSection => ({
  title,
  rows: rows.map(row),
});
const texts = (sections: DraftChangeSection[]) =>
  sections.map(({ title, rows }) => [title, rows.map((r) => r.text)]);

describe("mergeDraftChangeSections", () => {
  it("joins sections of one title, in the order they come", () => {
    expect(
      texts(
        mergeDraftChangeSections([
          section("Environment", "staging"),
          section("Prerequisite", "added a"),
          section("Environment", "prod"),
        ]),
      ),
    ).toEqual([
      ["Environment", ["staging", "prod"]],
      ["Prerequisite", ["added a"]],
    ]);
  });

  it("returns nothing for nothing", () => {
    expect(mergeDraftChangeSections([])).toEqual([]);
  });

  it("leaves the sections it's given as they were", () => {
    const first = section("Environment", "staging");
    const second = section("Environment", "prod");
    mergeDraftChangeSections([first, second]);
    expect(texts([first, second])).toEqual([
      ["Environment", ["staging"]],
      ["Environment", ["prod"]],
    ]);
  });
});
