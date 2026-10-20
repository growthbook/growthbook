import { resolveSnapshotVariation } from "../src/experiments/variations";

const variations = [
  { id: "v0", key: "0", name: "Control" },
  { id: "v1", key: "a", name: "A" },
  { id: "v2", key: "b", name: "B" },
];

describe("resolveSnapshotVariation", () => {
  it("follows the snapshot's variation keys when the order differs", () => {
    const snapshot = [{ id: "0" }, { id: "b" }, { id: "a" }];
    expect(resolveSnapshotVariation(variations, snapshot, 1)).toEqual({
      variation: variations[2],
      index: 2,
    });
    expect(resolveSnapshotVariation(variations, snapshot, 2)).toEqual({
      variation: variations[1],
      index: 1,
    });
  });

  it("accepts a variation id where a key is expected", () => {
    expect(
      resolveSnapshotVariation(variations, [{ id: "v0" }, { id: "v2" }], 1),
    ).toEqual({ variation: variations[2], index: 2 });
  });

  it("falls back to position without keys or for an unknown key", () => {
    expect(resolveSnapshotVariation(variations, undefined, 1)).toEqual({
      variation: variations[1],
      index: 1,
    });
    expect(
      resolveSnapshotVariation(variations, [{ id: "0" }, { id: "gone" }], 1),
    ).toEqual({ variation: variations[1], index: 1 });
    expect(resolveSnapshotVariation(variations, undefined, 5)).toBeNull();
  });
});
