import { describe, expect, it } from "vitest";
import { mergeContiguousRanges } from "@/components/Features/NamespaceSelectorUtils";

describe("mergeContiguousRanges", () => {
  it("returns empty when there are no ranges", () => {
    expect(mergeContiguousRanges([])).toEqual([]);
  });

  it("leaves a single range untouched", () => {
    expect(mergeContiguousRanges([[0.1, 0.3]])).toEqual([[0.1, 0.3]]);
  });

  it("merges touching ranges (end == next.start)", () => {
    expect(
      mergeContiguousRanges([
        [0.6, 0.9],
        [0.9, 1],
      ]),
    ).toEqual([[0.6, 1]]);
  });

  it("merges overlapping ranges", () => {
    expect(
      mergeContiguousRanges([
        [0.2, 0.6],
        [0.5, 0.8],
      ]),
    ).toEqual([[0.2, 0.8]]);
  });

  it("keeps non-contiguous ranges separate and sorted", () => {
    expect(
      mergeContiguousRanges([
        [0.8, 1],
        [0, 0.2],
        [0.4, 0.5],
      ]),
    ).toEqual([
      [0, 0.2],
      [0.4, 0.5],
      [0.8, 1],
    ]);
  });

  it("drops degenerate ranges where end <= start", () => {
    expect(
      mergeContiguousRanges([
        [0.5, 0.5],
        [0.2, 0.1],
        [0.3, 0.6],
      ]),
    ).toEqual([[0.3, 0.6]]);
  });

  it("merges a chain of three contiguous ranges", () => {
    expect(
      mergeContiguousRanges([
        [0, 0.2],
        [0.2, 0.5],
        [0.5, 0.8],
      ]),
    ).toEqual([[0, 0.8]]);
  });

  it("does not mutate the input array", () => {
    const input: [number, number][] = [
      [0.9, 1],
      [0.6, 0.9],
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeContiguousRanges(input);
    expect(input).toEqual(snapshot);
  });
});
