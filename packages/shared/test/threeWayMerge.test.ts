import { threeWayMerge } from "../src/util/threeWayMerge";

type Entity = {
  tags?: string[];
  owner?: string;
  variations?: Array<{ id: string; value: string }>;
};

describe("threeWayMerge array canonicalization", () => {
  it("treats a reordered primitive array as unchanged", () => {
    const base: Entity = { tags: ["a", "b"], owner: "x" };
    const theirs: Entity = { tags: ["b", "a"], owner: "x" };
    const yours: Entity = { tags: ["a", "b"], owner: "y" };
    const result = threeWayMerge(base, theirs, yours);
    expect(result.contested).toEqual([]);
    expect(result.theirFields).toEqual([]);
    expect(result.yourFields).toEqual(["owner"]);
    expect(result.merged).toEqual(yours);
  });

  it("does not contest when both sides hold the same set in different orders", () => {
    const base: Entity = { tags: ["a"] };
    const theirs: Entity = { tags: ["b", "a"] };
    const yours: Entity = { tags: ["a", "b"] };
    const result = threeWayMerge(base, theirs, yours);
    expect(result.contested).toEqual([]);
  });

  it("still contests when the sets genuinely differ", () => {
    const base: Entity = { tags: ["a"] };
    const theirs: Entity = { tags: ["a", "b"] };
    const yours: Entity = { tags: ["a", "c"] };
    const result = threeWayMerge(base, theirs, yours);
    expect(result.contested).toEqual([{ key: "tags", fields: ["tags"] }]);
  });

  it("keeps order significant for object arrays", () => {
    const v1 = { id: "1", value: "x" };
    const v2 = { id: "2", value: "y" };
    const base: Entity = { variations: [v1, v2] };
    const theirs: Entity = { variations: [v2, v1] };
    const yours: Entity = { variations: [{ ...v1, value: "z" }, v2] };
    const result = threeWayMerge(base, theirs, yours);
    expect(result.contested).toEqual([
      { key: "variations", fields: ["variations"] },
    ]);
  });

  it("still equates an empty array with an absent key", () => {
    const base: Entity = { tags: [] };
    const theirs: Entity = {};
    const yours: Entity = { owner: "y" };
    const result = threeWayMerge(base, theirs, yours);
    expect(result.contested).toEqual([]);
    expect(result.theirFields).toEqual([]);
  });
});
