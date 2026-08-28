import { GrowthBook } from "../src";
import { itemDraft, flattenInterleaveExposure } from "../src/interleave";
import { interleavePlugin, interleave } from "../src/plugins/interleave";
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
      // the same seeded rng the plugin uses, swept over interleaveIds
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

describe("interleave plugin", () => {
  const definition: InterleaveExperiment = {
    key: "ranker-test",
    lists: ["control", "treatment"],
  };
  const lists = [
    { name: "control", items: ["A", "B", "C", "D"] },
    { name: "treatment", items: ["C", "A", "D", "B"] },
  ];

  it("serves fallback when the definition is missing", () => {
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      plugins: [interleavePlugin()],
    });
    const res = interleave(gb, { key: "nope", lists, getItemId: id });
    expect(res.inExperiment).toBe(false);
    expect(res.items).toEqual(["A", "B", "C", "D"]);
    gb.destroy();
  });

  it("serves fallback when inactive or coverage is 0", () => {
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      interleaveExperiments: [{ ...definition, active: false }],
      plugins: [interleavePlugin()],
    });
    expect(
      interleave(gb, { key: "ranker-test", lists, getItemId: id }).inExperiment,
    ).toBe(false);
    gb.destroy();

    const gb2 = new GrowthBook({
      attributes: { id: "user-1" },
      interleaveExperiments: [{ ...definition, coverage: 0 }],
      plugins: [interleavePlugin()],
    });
    expect(
      interleave(gb2, { key: "ranker-test", lists, getItemId: id })
        .inExperiment,
    ).toBe(false);
    gb2.destroy();
  });

  it("interleaves both lists, fires one exposure per impression, and varies draft by interleaveId", () => {
    const exposures: InterleaveExposureData[] = [];
    const logged: { name: string; props: Record<string, unknown> }[] = [];
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      interleaveExperiments: [definition],
      plugins: [
        interleavePlugin({
          onExposure: (d) => {
            exposures.push(d);
          },
        }),
      ],
      eventLogger: (name, props) => {
        logged.push({ name, props });
      },
    });

    const r1 = interleave(gb, {
      key: "ranker-test",
      lists,
      getItemId: id,
      interleaveId: "imp-1",
    });
    const r1again = interleave(gb, {
      key: "ranker-test",
      lists,
      getItemId: id,
      interleaveId: "imp-1",
    });
    const r2 = interleave(gb, {
      key: "ranker-test",
      lists,
      getItemId: id,
      interleaveId: "imp-2",
    });

    expect(r1.inExperiment).toBe(true);
    expect(r1.items.slice().sort()).toEqual(["A", "B", "C", "D"]);
    // deterministic replay for the same interleaveId
    expect(r1again.items).toEqual(r1.items);
    expect(r2.interleaveId).toBe("imp-2");

    // draft metadata lives on the exposure record, not the result
    expect(exposures.length).toBe(3); // no dedupe: three calls, three exposures
    expect(exposures[0].experimentId).toBe("ranker-test");
    expect(exposures[0].interleaveId).toBe("imp-1");
    expect(exposures[0].hashValue).toBe("user-1");
    expect(exposures[0].items.length).toBe(4);
    const counts: Record<string, number> = {};
    exposures[0].items.forEach(
      (m) => (counts[m.variation] = (counts[m.variation] || 0) + 1),
    );
    expect(counts).toEqual({ control: 2, treatment: 2 });

    // exposures also flow through the generic event path
    const exposureEvents = logged.filter(
      (e) => e.name === "Interleave Exposure",
    );
    expect(exposureEvents.length).toBe(3);
    expect(exposureEvents[0].props.interleaveId).toBe("imp-1");
    gb.destroy();
  });

  it("works without plugin registration (logEvent path only)", () => {
    const logged: string[] = [];
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      interleaveExperiments: [definition],
      eventLogger: (name) => {
        logged.push(name);
      },
    });
    const res = interleave(gb, {
      key: "ranker-test",
      lists,
      getItemId: id,
      interleaveId: "imp-1",
    });
    expect(res.inExperiment).toBe(true);
    expect(logged).toContain("Interleave Exposure");
    gb.destroy();
  });

  it("returns spreadable trackingProps in and out of the experiment", () => {
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      interleaveExperiments: [definition],
      plugins: [interleavePlugin()],
    });
    const res = interleave(gb, {
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
    const gb2 = new GrowthBook({
      attributes: { id: "user-1" },
      plugins: [interleavePlugin()],
    });
    const fallback = interleave(gb2, { key: "nope", lists, getItemId: id });
    expect(fallback.trackingProps("A")).toEqual({ item_id: "A" });
    gb2.destroy();
  });

  it("resolves saved-group conditions", () => {
    const withCondition: InterleaveExperiment = {
      ...definition,
      condition: { id: { $inGroup: "beta-testers" } },
    };
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      interleaveExperiments: [withCondition],
      savedGroups: { "beta-testers": ["user-1", "user-2"] },
      plugins: [interleavePlugin()],
    });
    expect(
      interleave(gb, { key: "ranker-test", lists, getItemId: id }).inExperiment,
    ).toBe(true);
    gb.destroy();

    const gb2 = new GrowthBook({
      attributes: { id: "user-9" },
      interleaveExperiments: [withCondition],
      savedGroups: { "beta-testers": ["user-1", "user-2"] },
      plugins: [interleavePlugin()],
    });
    expect(
      interleave(gb2, { key: "ranker-test", lists, getItemId: id })
        .inExperiment,
    ).toBe(false);
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
      plugins: [interleavePlugin()],
    });
    interleave(gb, { key: "ranker-test", lists: lazyLists, getItemId: id });
    expect(realized).toBe(1); // only the fallback list was realized
    gb.destroy();
  });

  it("a throwing onExposure callback does not break serving", () => {
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      interleaveExperiments: [definition],
      plugins: [
        interleavePlugin({
          onExposure: () => {
            throw new Error("boom");
          },
        }),
      ],
    });
    const res = interleave(gb, { key: "ranker-test", lists, getItemId: id });
    expect(res.inExperiment).toBe(true);
    expect(res.items.length).toBe(4);
    gb.destroy();
  });
});

describe("measurement arm", () => {
  const lists = [
    { name: "control", items: ["A", "B", "C", "D"] },
    { name: "treatment", items: ["C", "A", "D", "B"] },
  ];
  const definition: InterleaveExperiment = {
    key: "ranker-test",
    lists: ["control", "treatment"],
    measurementArmPercent: 50,
  };

  function makeGb(userId: string, def: InterleaveExperiment) {
    const events: { name: string; props: Record<string, unknown> }[] = [];
    const gb = new GrowthBook({
      attributes: { id: userId },
      interleaveExperiments: [def],
      plugins: [interleavePlugin()],
      eventLogger: (name, props) => {
        events.push({ name, props });
      },
    });
    return { gb, events };
  }

  it("splits users deterministically and serves the control list to the measurement arm", () => {
    let measurement = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const { gb } = makeGb(`user-${i}`, definition);
      const res = interleave(gb, { key: "ranker-test", lists, getItemId: id });
      const again = interleave(gb, {
        key: "ranker-test",
        lists,
        getItemId: id,
      });
      expect(again.arm).toBe(res.arm); // per-user stable
      if (res.arm === "measurement") {
        measurement++;
        expect(res.inExperiment).toBe(false);
        expect(res.items).toEqual(["A", "B", "C", "D"]); // control, unblended
        expect(res.trackingProps("A")).toEqual({ item_id: "A" });
      } else {
        expect(res.arm).toBe("interleaved");
        expect(res.inExperiment).toBe(true);
      }
      gb.destroy();
    }
    expect(measurement / n).toBeGreaterThan(0.4);
    expect(measurement / n).toBeLessThan(0.6);
  });

  it("emits one deduped user-level Experiment Viewed exposure per arm", () => {
    const { gb, events } = makeGb("user-1", definition);
    interleave(gb, { key: "ranker-test", lists, getItemId: id });
    interleave(gb, { key: "ranker-test", lists, getItemId: id });
    const viewed = events.filter(
      (e) =>
        e.name === "Experiment Viewed" &&
        e.props.experimentId === "ranker-test__measurement",
    );
    expect(viewed.length).toBe(1); // deduped across repeat impressions
    expect(["status-quo", "interleaved"]).toContain(
      viewed[0].props.variationId,
    );
    expect(viewed[0].props.hashValue).toBe("user-1");
    gb.destroy();
  });

  it("does not emit measurement exposures when the percent is 0, missing, or invalid", () => {
    for (const pct of [undefined, 0, 100, 150, -5]) {
      const { gb, events } = makeGb("user-1", {
        ...definition,
        measurementArmPercent: pct,
      });
      const res = interleave(gb, { key: "ranker-test", lists, getItemId: id });
      expect(res.arm).toBe("interleaved"); // split disabled
      expect(res.inExperiment).toBe(true);
      expect(events.filter((e) => e.name === "Experiment Viewed").length).toBe(
        0,
      );
      gb.destroy();
    }
  });
});

describe("interleave feature rule", () => {
  const lists = [
    { name: "control", items: ["A", "B", "C", "D"] },
    { name: "treatment", items: ["C", "A", "D", "B"] },
  ];
  const controllerFeature = {
    defaultValue: "control",
    rules: [
      {
        id: "rule_il",
        coverage: 1,
        interleave: {
          lists: ["control", "treatment"],
          fallbackValue: "control",
        },
      },
    ],
  };

  it("evalFeature resolves the rule to the fallback list name with no exposure", () => {
    const logged: string[] = [];
    const exposures: unknown[] = [];
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      features: { "ranker-test": controllerFeature },
      eventLogger: (name) => {
        logged.push(name);
      },
      plugins: [
        interleavePlugin({
          onExposure: (d) => {
            exposures.push(d);
          },
        }),
      ],
    });
    const res = gb.evalFeature("ranker-test");
    expect(res.value).toBe("control");
    expect(res.source).toBe("interleave");
    expect(res.interleave?.lists).toEqual(["control", "treatment"]);
    expect(exposures.length).toBe(0);
    expect(logged.filter((n) => n === "Interleave Exposure").length).toBe(0);
    gb.destroy();
  });

  it("a scrubbed rule (old SDK view) falls through to the default value", () => {
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      features: {
        "ranker-test": {
          defaultValue: "control",
          // What a pre-interleaving SDK receives after payload scrubbing:
          // no interleave key, no force, no variations
          rules: [{ id: "rule_il", coverage: 1 }],
        },
      },
    });
    const res = gb.evalFeature("ranker-test");
    expect(res.value).toBe("control");
    expect(res.source).toBe("defaultValue");
    gb.destroy();
  });

  it("rule coverage excludes users from diversion but keeps the value", () => {
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      features: {
        "ranker-test": {
          defaultValue: "control",
          rules: [
            {
              coverage: 0,
              interleave: {
                lists: ["control", "treatment"],
                fallbackValue: "control",
              },
            },
          ],
        },
      },
      plugins: [interleavePlugin()],
    });
    expect(gb.evalFeature("ranker-test").source).toBe("defaultValue");
    const res = interleave(gb, { key: "ranker-test", lists, getItemId: id });
    expect(res.inExperiment).toBe(false);
    expect(res.items).toEqual(["A", "B", "C", "D"]); // the resolved list name
    gb.destroy();
  });

  it("the plugin recognizes the rule and is the only draft path", () => {
    const exposures: InterleaveExposureData[] = [];
    const gb = new GrowthBook({
      attributes: { id: "user-1" },
      features: { "ranker-test": controllerFeature },
      plugins: [
        interleavePlugin({
          onExposure: (d) => {
            exposures.push(d);
          },
        }),
      ],
    });
    const res = interleave(gb, {
      key: "ranker-test",
      lists,
      getItemId: id,
      interleaveId: "imp-1",
    });
    expect(res.inExperiment).toBe(true);
    expect(res.arm).toBe("interleaved");
    expect(res.items.slice().sort()).toEqual(["A", "B", "C", "D"]);
    expect(exposures.length).toBe(1);
    expect(res.trackingProps("A")).toEqual({
      item_id: "A",
      interleave_id: "imp-1",
      experiment_id: "ranker-test",
    });
    // Plain callers still get the list name
    expect(gb.getFeatureValue("ranker-test", "control")).toBe("control");
    gb.destroy();
  });

  it("measurement arm is consistent and serves the control list", () => {
    // Find one user per arm using the same hash the SDK uses
    const pct = 50;
    const armFor = (userId: string) =>
      (hash("ranker-test__measurement", userId, 2) ?? 1) < pct / 100
        ? "measurement"
        : "interleaved";
    let measurementUser = "";
    let interleavedUser = "";
    for (let i = 0; i < 50 && !(measurementUser && interleavedUser); i++) {
      const u = `user-${i}`;
      if (armFor(u) === "measurement") measurementUser = measurementUser || u;
      else interleavedUser = interleavedUser || u;
    }

    const logged: { name: string; props: Record<string, unknown> }[] = [];
    const gb = new GrowthBook({
      attributes: { id: measurementUser },
      features: {
        "ranker-test": {
          defaultValue: "control",
          rules: [
            {
              coverage: 1,
              interleave: {
                lists: ["control", "treatment"],
                fallbackValue: "control",
                measurementArmPercent: pct,
              },
            },
          ],
        },
      },
      eventLogger: (name, props) => {
        logged.push({ name, props });
      },
      plugins: [interleavePlugin()],
    });
    const res = interleave(gb, { key: "ranker-test", lists, getItemId: id });
    expect(res.arm).toBe("measurement");
    expect(res.items).toEqual(["A", "B", "C", "D"]); // control list, unblended
    // Regular user-level exposure under <key>__measurement, no draft exposure
    const measurementEvents = logged.filter(
      (e) => e.props.experimentId === "ranker-test__measurement",
    );
    expect(measurementEvents.length).toBe(1);
    expect(measurementEvents[0].props.variationId).toBe("status-quo");
    expect(logged.filter((e) => e.name === "Interleave Exposure").length).toBe(
      0,
    );
    // Plain evalFeature agrees with what interleave() served
    expect(gb.evalFeature("ranker-test").value).toBe("control");
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
