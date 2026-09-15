import { overlayDocsById } from "back-end/src/util/scanOverlay.util";

type Doc = { id: string; value: string };

const docs: Doc[] = [
  { id: "a", value: "live-a" },
  { id: "b", value: "live-b" },
];

describe("overlayDocsById", () => {
  it("returns the input array untouched when there is no overlay", () => {
    expect(overlayDocsById(docs, null)).toBe(docs);
    expect(overlayDocsById(docs, undefined)).toBe(docs);
    expect(overlayDocsById(docs, new Map())).toBe(docs);
  });

  it("substitutes docs whose id appears in the overlay", () => {
    const overlay = new Map([["a", { id: "a", value: "proposed-a" }]]);
    expect(overlayDocsById(docs, overlay)).toEqual([
      { id: "a", value: "proposed-a" },
      { id: "b", value: "live-b" },
    ]);
  });

  it("appends overlay docs missing from the snapshot", () => {
    const overlay = new Map([["c", { id: "c", value: "proposed-c" }]]);
    expect(overlayDocsById(docs, overlay)).toEqual([
      { id: "a", value: "live-a" },
      { id: "b", value: "live-b" },
      { id: "c", value: "proposed-c" },
    ]);
  });

  it("substitutes and appends in one pass without mutating the input", () => {
    const overlay = new Map([
      ["b", { id: "b", value: "proposed-b" }],
      ["c", { id: "c", value: "proposed-c" }],
    ]);
    const result = overlayDocsById(docs, overlay);
    expect(result).toEqual([
      { id: "a", value: "live-a" },
      { id: "b", value: "proposed-b" },
      { id: "c", value: "proposed-c" },
    ]);
    expect(docs).toEqual([
      { id: "a", value: "live-a" },
      { id: "b", value: "live-b" },
    ]);
  });
});
