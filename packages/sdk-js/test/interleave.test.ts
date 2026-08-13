import { GrowthBook } from "../src";
import { itemDraft, flattenInterleaveExposure } from "../src/interleave";
import { hash } from "../src/util";
import {
  InterleaveExperiment,
  InterleaveExposureData,
} from "../src/types/growthbook";

const id = (s: string) => s;
// Captain 0 always drafts first, matching the DoorDash blog's worked examples
const rngFirst = (_round: number, captain: number) => captain;

function summarize(
  meta: { itemId: string; variation: string; competitive: boolean }[],
) {
  return meta.map((m) => `${m.itemId},${m.variation},${m.competitive ? 1 : 0}`);
}

describe("itemDraft", () => {
  it("marks near-identical lists non-competitive except the tail (DoorDash ex. 1)", () => {
    const { meta } = itemDraft(
      [
        { name: "C1", items: ["A", "B", "C", "D", "E"] },
        { name: "C2", items: ["A", "B", "C", "D", "F"] },
      ],
      id,
      rngFirst,
    );
    expect(summarize(meta)).toEqual([
      "A,C1,0",
      "B,C2,0",
      "C,C1,0",
      "D,C2,0",
      "E,C1,1",
      "F,C2,1",
    ]);
  });

  it("handles divergent lists with shared picks and exhaustion (DoorDash ex. 2)", () => {
    const { meta } = itemDraft(
      [
        { name: "C1", items: ["A", "B", "J", "C", "D", "G", "H"] },
        { name: "C2", items: ["A", "E", "J", "G", "H", "D", "I"] },
      ],
      id,
      rngFirst,
    );
    expect(summarize(meta)).toEqual([
      "A,C1,0",
      "E,C2,0",
      "B,C1,1",
      "J,C2,1",
      "C,C1,1",
      "G,C2,1",
      "D,C1,1",
      "H,C2,1",
      "I,C2,0",
    ]);
  });

  it("only runs complete rounds when maxItems is set", () => {
    const { items, meta } = itemDraft(
      [
        { name: "C1", items: ["A", "B", "C"] },
        { name: "C2", items: ["D", "E", "F"] },
      ],
      id,
      rngFirst,
      5,
    );
    expect(items.length).toBe(4); // 2 complete rounds; a 3rd would exceed 5
    const counts: Record<string, number> = {};
    meta.forEach((m) => (counts[m.variation] = (counts[m.variation] || 0) + 1));
    expect(counts).toEqual({ C1: 2, C2: 2 });
  });

  it("balances first pick across captains over many draft orders", () => {
    let firstPicks = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      // the same seeded rng runInterleave uses, swept over interleaveIds
      const rng = (round: number, captain: number) =>
        hash("seed__interleave", `imp-${i}:${round}:${captain}`, 2) ?? 0.5;
      const { meta } = itemDraft(
        [
          { name: "C1", items: ["A", "B"] },
          { name: "C2", items: ["C", "D"] },
        ],
        id,
        rng,
      );
      if (meta[0].variation === "C1") firstPicks++;
    }
    expect(firstPicks / n).toBeGreaterThan(0.45);
    expect(firstPicks / n).toBeLessThan(0.55);
  });
});

describe("interleave", () => {
  const definition: InterleaveExperiment = {
    key: "ranker-test",
    lists: ["control", "treatment"],
  };
  const lists = [
    { name: "control", items: ["A", "B", "C", "D"] },
    { name: "treatment", items: ["C", "A", "D", "B"] },
  ];

  it("serves fallback when the definition is missing", () => {
    const gb = new GrowthBook({ attributes: { id: "user-1" } });
    const res = gb.interleave({ key: "nope", lists, getItemId: id });
    expect(res.inExperiment).toBe(false);
    expect(res.items).toEqual(["A", "B", "C", "D"]);
    expect(res.meta).toEqual([]);
    gb.destroy();
  });

  it("serves fallback when inactive or coverage is 0", () => {
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      interleaveExperiments: [{ ...definition, active: false }],
    });
    expect(
      gb.interleave({ key: "ranker-test", lists, getItemId: id }).inExperiment,
    ).toBe(false);
    gb.destroy();

    const gb2 = new GrowthBook({
      attributes: { id: "user-1" },
      interleaveExperiments: [{ ...definition, coverage: 0 }],
    });
    expect(
      gb2.interleave({ key: "ranker-test", lists, getItemId: id }).inExperiment,
    ).toBe(false);
    gb2.destroy();
  });

  it("interleaves both lists, fires one exposure per impression, and varies draft by interleaveId", () => {
    const exposures: InterleaveExposureData[] = [];
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      interleaveExperiments: [definition],
      onInterleaveExposure: (data) => {
        exposures.push(data);
      },
    });

    const r1 = gb.interleave({
      key: "ranker-test",
      lists,
      getItemId: id,
      interleaveId: "imp-1",
    });
    const r1again = gb.interleave({
      key: "ranker-test",
      lists,
      getItemId: id,
      interleaveId: "imp-1",
    });
    const r2 = gb.interleave({
      key: "ranker-test",
      lists,
      getItemId: id,
      interleaveId: "imp-2",
    });

    expect(r1.inExperiment).toBe(true);
    expect(r1.items.slice().sort()).toEqual(["A", "B", "C", "D"]);
    expect(r1.meta.length).toBe(4);
    // deterministic replay for the same interleaveId
    expect(r1again.items).toEqual(r1.items);
    // both variations drafted equally
    const counts: Record<string, number> = {};
    r1.meta.forEach(
      (m) => (counts[m.variation] = (counts[m.variation] || 0) + 1),
    );
    expect(counts).toEqual({ control: 2, treatment: 2 });
    // no dedupe: three calls, three exposures
    expect(exposures.length).toBe(3);
    expect(exposures[0].experimentId).toBe("ranker-test");
    expect(exposures[0].interleaveId).toBe("imp-1");
    expect(exposures[0].hashValue).toBe("user-1");
    expect(r2.interleaveId).toBe("imp-2");
    gb.destroy();
  });

  it("returns spreadable trackingProps in and out of the experiment", () => {
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      interleaveExperiments: [definition],
    });
    const res = gb.interleave({
      key: "ranker-test",
      lists,
      getItemId: id,
      interleaveId: "imp-1",
    });
    expect(res.trackingProps("A")).toEqual({
      item_id: "A",
      interleave_id: "imp-1",
      experiment_id: "ranker-test",
    });
    gb.destroy();

    // Fallback: no interleave keys, so spreading is a safe no-op
    const gb2 = new GrowthBook({ attributes: { id: "user-1" } });
    const fallback = gb2.interleave({ key: "nope", lists, getItemId: id });
    expect(fallback.trackingProps("A")).toEqual({ item_id: "A" });
    gb2.destroy();
  });

  it("only realizes lazy lists when enrolled", () => {
    let realized = 0;
    const lazyLists = [
      { name: "control", items: () => (realized++, ["A", "B"]) },
      { name: "treatment", items: () => (realized++, ["B", "A"]) },
    ];
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      interleaveExperiments: [{ ...definition, coverage: 0 }],
    });
    gb.interleave({ key: "ranker-test", lists: lazyLists, getItemId: id });
    expect(realized).toBe(1); // only the fallback list was realized
    gb.destroy();
  });
});

describe("flattenInterleaveExposure", () => {
  it("produces one canonical row per item", () => {
    const rows = flattenInterleaveExposure({
      timestamp: 123,
      experimentId: "exp",
      interleaveId: "imp-1",
      hashAttribute: "id",
      hashValue: "user-1",
      items: [
        { itemId: "A", variation: "control", position: 0, competitive: true },
        { itemId: "B", variation: "treatment", position: 1, competitive: true },
      ],
    });
    expect(rows).toEqual([
      {
        timestamp: 123,
        user_id: "user-1",
        experiment_id: "exp",
        interleave_id: "imp-1",
        item_id: "A",
        variation: "control",
        position: 0,
        competitive: true,
      },
      {
        timestamp: 123,
        user_id: "user-1",
        experiment_id: "exp",
        interleave_id: "imp-1",
        item_id: "B",
        variation: "treatment",
        position: 1,
        competitive: true,
      },
    ]);
  });
});
