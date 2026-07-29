import { FeatureRule } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  buildConflictBanners,
  getReachabilityCells,
  getRuleReachability,
  OTHER_PROJECT_BUCKET,
  RuleReachability,
  SavedGroupForConflicts,
} from "@/services/rule-conflicts";

const noExperiments = new Map<string, ExperimentInterfaceStringDates>();
const cond = (obj: unknown) => JSON.stringify(obj);

// Minimal rule builders — the analyzer only reads
// id/type/enabled/condition/savedGroups/prerequisites/coverage.
type Extra = {
  condition?: string;
  savedGroups?: { ids: string[]; match: "all" | "any" | "none" }[];
  enabled?: boolean;
  projects?: string[];
  allProjects?: boolean;
};
function force(id: string, extra: Extra = {}): FeatureRule {
  return {
    id,
    type: "force",
    value: "true",
    description: "",
    enabled: extra.enabled ?? true,
    condition: extra.condition,
    savedGroups: extra.savedGroups,
    allProjects: extra.allProjects,
    projects: extra.projects,
  } as unknown as FeatureRule;
}
function rollout(
  id: string,
  coverage: number,
  condition?: string,
): FeatureRule {
  return {
    id,
    type: "rollout",
    value: "true",
    coverage,
    hashAttribute: "id",
    description: "",
    enabled: true,
    condition,
  } as unknown as FeatureRule;
}
function experiment(
  id: string,
  coverage: number,
  condition?: string,
  extra: Extra = {},
): FeatureRule {
  return {
    id,
    type: "experiment",
    trackingKey: id,
    hashAttribute: "id",
    coverage,
    values: [
      { value: "control", weight: 0.5 },
      { value: "treatment", weight: 0.5 },
    ],
    description: "",
    enabled: extra.enabled ?? true,
    condition,
  } as unknown as FeatureRule;
}
function experimentRef(
  id: string,
  experimentId: string,
  condition?: string,
  extra: Extra = {},
): FeatureRule {
  return {
    id,
    type: "experiment-ref",
    experimentId,
    variations: [
      { variationId: "v0", value: "control" },
      { variationId: "v1", value: "treatment" },
    ],
    description: "",
    enabled: extra.enabled ?? true,
    condition,
  } as unknown as FeatureRule;
}
function linkedExperiment(
  id: string,
  overrides: Partial<ExperimentInterfaceStringDates> = {},
): ExperimentInterfaceStringDates {
  return {
    id,
    status: "running",
    archived: false,
    ...overrides,
  } as ExperimentInterfaceStringDates;
}

function analyze(
  rules: FeatureRule[],
  savedGroups?: Map<string, SavedGroupForConflicts>,
) {
  return getRuleReachability(rules, noExperiments, savedGroups);
}
function analyzeWithExperiments(
  rules: FeatureRule[],
  experiments: Map<string, ExperimentInterfaceStringDates>,
  savedGroups?: Map<string, SavedGroupForConflicts>,
) {
  return getRuleReachability(rules, experiments, savedGroups);
}

describe("getRuleReachability — hard conflicts", () => {
  it("flags a partial conflict when a value the rule targets is fully served above", () => {
    // The Safari example: a `browser = Safari` force above consumes the Safari
    // branch of `browser IN [Firefox, Safari, Chrome]`.
    const result = analyze([
      rollout("r1", 0.6, cond({ country: "US" })),
      force("r2", { condition: cond({ browser: "Safari" }) }),
      force("r3", {
        condition: cond({ browser: { $in: ["Firefox", "Safari", "Chrome"] } }),
      }),
    ]);
    // r1 (partial rollout) doesn't fully consume anyone, so r2 is clean.
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
    expect(result.get("r3")).toEqual({
      unreachable: false,
      hardConflicts: [
        { consumingRuleId: "r2", attr: "browser", label: "Safari" },
      ],
      softConflicts: [],
    });
  });

  it("treats a rule as unreachable when its targeting is fully covered above", () => {
    // country = US below a country IN [US, CA] force — the false-negative case.
    const result = analyze([
      force("r1", { condition: cond({ country: { $in: ["US", "CA"] } }) }),
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "country", label: "US" }],
      softConflicts: [],
    });
  });

  it("marks all rules after an unconditional rule unreachable", () => {
    const result = analyze([
      force("r1"),
      force("r2", { condition: cond({ browser: "Safari" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: null, label: null }],
      softConflicts: [],
    });
  });

  it("does not warn when a small segment is peeled off a broad rule above", () => {
    // force ON for admins/beta, then roll out to everyone: the rollout doesn't
    // target `role`, so consuming admins is expected, not a conflict.
    const result = analyze([
      force("r1", { condition: cond({ role: { $in: ["admin", "beta"] } }) }),
      force("r2"),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });

  it("ignores disabled rules as consumers", () => {
    const result = analyze([
      force("r1", { enabled: false, condition: cond({ browser: "Safari" }) }),
      force("r2", {
        condition: cond({ browser: { $in: ["Safari", "Chrome"] } }),
      }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });
});

describe("getRuleReachability — $ne / $nin", () => {
  it("a `$ne` rule above consumes the matching value of an in-list rule", () => {
    // country != US consumes CA (which is not US); US still reaches.
    const result = analyze([
      force("r1", { condition: cond({ country: { $ne: "US" } }) }),
      force("r2", { condition: cond({ country: { $in: ["US", "CA"] } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [{ consumingRuleId: "r1", attr: "country", label: "CA" }],
      softConflicts: [],
    });
  });

  it("a `$nin` rule above can make a rule fully unreachable", () => {
    // country not in [MX] consumes both US and CA.
    const result = analyze([
      force("r1", { condition: cond({ country: { $nin: ["MX"] } }) }),
      force("r2", { condition: cond({ country: { $in: ["US", "CA"] } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [
        { consumingRuleId: "r1", attr: "country", label: "US, CA" },
      ],
      softConflicts: [],
    });
  });

  it("a `$ne` rule covers a broader `$nin` rule", () => {
    // country != US covers country not in [US, CA] (a subset of non-US).
    const result = analyze([
      force("r1", { condition: cond({ country: { $ne: "US" } }) }),
      force("r2", { condition: cond({ country: { $nin: ["US", "CA"] } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "country", label: null }],
      softConflicts: [],
    });
  });

  it("an `= value` rule above carves a value out of an open-ended `!=` rule", () => {
    // browser = chrome consumes the chrome users that `browser != firefox` wanted.
    const result = analyze([
      force("r1", { condition: cond({ browser: "chrome" }) }),
      force("r2", { condition: cond({ browser: { $ne: "firefox" } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [
        { consumingRuleId: "r1", attr: "browser", label: "chrome" },
      ],
      softConflicts: [],
    });
  });

  it("does not flag a value the open-ended rule itself excludes", () => {
    // browser = firefox above doesn't conflict with `browser != firefox`.
    const result = analyze([
      force("r1", { condition: cond({ browser: "firefox" }) }),
      force("r2", { condition: cond({ browser: { $ne: "firefox" } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });
});

describe("getRuleReachability — $ini / $nini (case-insensitive)", () => {
  it("detects soft overlap when a partial rule above uses `$ini` with different casing", () => {
    const result = analyze([
      rollout("r1", 0.5, cond({ browser: { $ini: ["safari"] } })),
      force("r2", { condition: cond({ browser: "Safari" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "browser", consumingRuleIds: ["r1"] }],
    });
  });

  it("downgrades to a soft conflict when a case-sensitive force sits above an `$ini` target", () => {
    // The force matches only "Safari" exactly, so it can't be proven to fully
    // serve the case-insensitive target. Insensitive matching is best-effort,
    // so this surfaces as a soft overlap rather than hard unreachable.
    const result = analyze([
      force("r1", { condition: cond({ browser: "Safari" }) }),
      force("r2", { condition: cond({ browser: { $ini: ["safari"] } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "browser", consumingRuleIds: ["r1"] }],
    });
  });

  it("detects partial hard conflict across mixed `$ini` and `$in` casing", () => {
    const result = analyze([
      force("r1", { condition: cond({ browser: { $ini: ["safari"] } }) }),
      force("r2", {
        condition: cond({
          browser: { $in: ["Firefox", "Safari", "Chrome"] },
        }),
      }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [
        { consumingRuleId: "r1", attr: "browser", label: "Safari" },
      ],
      softConflicts: [],
    });
  });

  it("treats `$nini` as case-insensitive when covering a broader `$nin` rule", () => {
    const result = analyze([
      force("r1", { condition: cond({ country: { $ne: "US" } }) }),
      force("r2", {
        condition: cond({ country: { $nini: ["us", "ca"] } }),
      }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "country", label: null }],
      softConflicts: [],
    });
  });

  it("still treats case-sensitive `$in` as disjoint when only casing differs", () => {
    const result = analyze([
      force("r1", { condition: cond({ browser: { $in: ["safari"] } }) }),
      force("r2", { condition: cond({ browser: "Safari" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });
});

describe("getRuleReachability — numeric & version ranges", () => {
  it("a numeric range above consumes matching listed values", () => {
    const result = analyze([
      force("r1", { condition: cond({ age: { $gte: 18 } }) }),
      force("r2", { condition: cond({ age: { $in: [15, 21] } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [{ consumingRuleId: "r1", attr: "age", label: "21" }],
      softConflicts: [],
    });
  });

  it("a numeric range above can make a listed-value rule unreachable", () => {
    const result = analyze([
      force("r1", { condition: cond({ age: { $gt: 10 } }) }),
      force("r2", { condition: cond({ age: { $in: [20, 30] } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "age", label: "20, 30" }],
      softConflicts: [],
    });
  });

  it("a version range above consumes matching listed versions", () => {
    const result = analyze([
      force("r1", { condition: cond({ version: { $vgte: "2.0.0" } }) }),
      force("r2", {
        condition: cond({ version: { $in: ["1.5.0", "2.1.0"] } }),
      }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [
        { consumingRuleId: "r1", attr: "version", label: "2.1.0" },
      ],
      softConflicts: [],
    });
  });

  it("marks a narrower numeric range below a wider one unreachable", () => {
    const result = analyze([
      force("r1", { condition: cond({ age: { $gt: 18 } }) }),
      force("r2", { condition: cond({ age: { $gt: 21 } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "age", label: "> 21" }],
      softConflicts: [],
    });
  });

  it("reports a hard conflict for the overlapping sub-range of two numeric ranges", () => {
    const result = analyze([
      force("r1", { condition: cond({ age: { $gt: 18 } }) }),
      force("r2", { condition: cond({ age: { $lt: 21 } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [
        { consumingRuleId: "r1", attr: "age", label: "> 18, < 21" },
      ],
      softConflicts: [],
    });
  });

  it("marks a narrower version range below a wider one unreachable", () => {
    const result = analyze([
      force("r1", { condition: cond({ version: { $vgte: "2.0.0" } }) }),
      force("r2", { condition: cond({ version: { $vgte: "3.0.0" } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [
        { consumingRuleId: "r1", attr: "version", label: "≥ 3.0.0" },
      ],
      softConflicts: [],
    });
  });

  it("reports a hard conflict for overlapping version ranges", () => {
    const result = analyze([
      force("r1", { condition: cond({ version: { $vgte: "2.0.0" } }) }),
      force("r2", { condition: cond({ version: { $vlt: "3.0.0" } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [
        { consumingRuleId: "r1", attr: "version", label: "≥ 2.0.0, < 3.0.0" },
      ],
      softConflicts: [],
    });
  });

  it("marks a rule unreachable when complementary ranges above fully cover it", () => {
    const result = analyze([
      force("r1", { condition: cond({ age: { $gt: 18 } }) }),
      force("r2", { condition: cond({ age: { $lte: 18 } }) }),
      force("r3", { condition: cond({ age: { $gte: 10 } }) }),
    ]);
    expect(result.get("r3")).toEqual({
      unreachable: true,
      hardConflicts: [
        { consumingRuleId: "r1", attr: "age", label: "> 18" },
        { consumingRuleId: "r2", attr: "age", label: "≥ 10, ≤ 18" },
      ],
      softConflicts: [],
    });
  });

  it("marks any age-targeting rule unreachable after complementary ranges split the line", () => {
    const result = analyze([
      force("r1", { condition: cond({ age: { $gt: 18 } }) }),
      force("r2", { condition: cond({ age: { $lte: 18 } }) }),
      force("r3", { condition: cond({ age: { $gt: 21 } }) }),
    ]);
    expect(result.get("r3")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "age", label: "> 21" }],
      softConflicts: [],
    });
  });

  it("does not mark unreachable when complementary ranges leave a gap in the target", () => {
    const result = analyze([
      force("r1", { condition: cond({ age: { $gt: 18 } }) }),
      force("r2", { condition: cond({ age: { $lt: 10 } }) }),
      force("r3", { condition: cond({ age: { $gte: 10, $lte: 20 } }) }),
    ]);
    expect(result.get("r3")).toEqual({
      unreachable: false,
      hardConflicts: [
        { consumingRuleId: "r1", attr: "age", label: "> 18, ≤ 20" },
      ],
      softConflicts: [],
    });
  });

  it("keeps partial-overlap entries when a later rule fully contains the target", () => {
    const result = analyze([
      force("r1", { condition: cond({ age: { $gt: 18 } }) }),
      force("r2", { condition: cond({ age: { $gte: 10 } }) }),
      force("r3", { condition: cond({ age: { $gte: 15 } }) }),
    ]);
    expect(result.get("r3")).toEqual({
      unreachable: true,
      hardConflicts: [
        { consumingRuleId: "r1", attr: "age", label: "> 18" },
        { consumingRuleId: "r2", attr: "age", label: "≥ 15" },
      ],
      softConflicts: [],
    });
  });
});

describe("getRuleReachability — soft conflicts (attribute overlap)", () => {
  it("warns softly when a rule above targets the same attribute via regex", () => {
    const result = analyze([
      force("r1", { condition: cond({ browser: "Safari" }) }),
      force("r2", { condition: cond({ browser: { $regex: "Saf.*" } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "browser", consumingRuleIds: ["r1"] }],
    });
  });

  it("warns softly when a rule above targets the same attribute inside an $or", () => {
    const result = analyze([
      force("r1", {
        condition: cond({ $or: [{ country: "US" }, { browser: "Safari" }] }),
      }),
      force("r2", { condition: cond({ country: "CA" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "country", consumingRuleIds: ["r1"] }],
    });
  });

  it("warns softly when a rule above targets the attribute via a saved group", () => {
    // List group whose values aren't loaded — opaque, but its attribute is
    // tracked, so we still surface soft overlap with a rule below on `country`.
    const savedGroups = new Map<string, SavedGroupForConflicts>([
      ["grp_country", { type: "list", attributeKey: "country" }],
    ]);
    const result = analyze(
      [
        force("r1", { savedGroups: [{ ids: ["grp_country"], match: "any" }] }),
        force("r2", { condition: cond({ country: "CA" }) }),
      ],
      savedGroups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "country", consumingRuleIds: ["r1"] }],
    });
  });

  it("includes partial-coverage rules above as soft consumers", () => {
    // A 50% rollout above isn't a hard consumer, but it still overlaps.
    const result = analyze([
      rollout("r1", 0.5, cond({ browser: { $regex: "Saf" } })),
      force("r2", { condition: cond({ browser: "Safari" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "browser", consumingRuleIds: ["r1"] }],
    });
  });

  it("does not warn when both rules model the attribute and are disjoint", () => {
    const result = analyze([
      force("r1", { condition: cond({ country: "US" }) }),
      force("r2", { condition: cond({ country: "CA" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });

  it("does not warn when an opaque rule above targets a different attribute", () => {
    const result = analyze([
      force("r1", { condition: cond({ country: "US" }) }),
      force("r2", { condition: cond({ browser: { $regex: "Saf" } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });
});

describe("getRuleReachability — untargeted partial rollout above", () => {
  it("warns softly when an untargeted partial rollout siphons traffic", () => {
    // 95% rollout above takes most traffic; only ~5% reaches `country = US`.
    const result = analyze([
      rollout("r1", 0.95),
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: null, consumingRuleIds: ["r1"] }],
    });
  });

  it("is unreachable (not soft) when the untargeted rollout is 100%", () => {
    const result = analyze([
      rollout("r1", 1),
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: null, label: null }],
      softConflicts: [],
    });
  });

  it("does not warn for a 0% (inactive) rollout", () => {
    const result = analyze([
      rollout("r1", 0),
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });

  it("does not siphon when the partial rollout is targeted (not catch-all)", () => {
    // A targeted 95% rollout only affects its own segment, not all traffic.
    const result = analyze([
      rollout("r1", 0.95, cond({ country: "US" })),
      force("r2", { condition: cond({ browser: "chrome" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });
});

describe("getRuleReachability — partial overlap on a targeted attribute", () => {
  it("warns softly when a partial rollout above overlaps the same targeting", () => {
    // country = US @ 90% consumes most US users before `country = US` is reached.
    const result = analyze([
      rollout("r1", 0.9, cond({ country: "US" })),
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "country", consumingRuleIds: ["r1"] }],
    });
  });

  it("does not warn when the overlapping rules target disjoint values", () => {
    const result = analyze([
      rollout("r1", 0.9, cond({ country: "US" })),
      force("r2", { condition: cond({ country: "CA" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });

  it("does not warn when the overlapping rule above consumes no traffic", () => {
    const result = analyze([
      rollout("r1", 0, cond({ country: "US" })),
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });
});

describe("getRuleReachability — experiment rules", () => {
  it("warns softly when a partial experiment above overlaps the same targeting", () => {
    const result = analyze([
      experiment("e1", 0.5, cond({ country: "US" })),
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "country", consumingRuleIds: ["e1"] }],
    });
  });

  it("warns softly when an untargeted partial experiment siphons traffic", () => {
    const result = analyze([
      experiment("e1", 0.5),
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: null, consumingRuleIds: ["e1"] }],
    });
  });

  it("does not hard-consume even at 100% experiment coverage", () => {
    // Experiments are treated conservatively — unlike a 100% rollout, they
    // never count as fully consuming their matched population.
    const result = analyze([
      experiment("e1", 1, cond({ country: { $in: ["US", "CA"] } })),
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "country", consumingRuleIds: ["e1"] }],
    });
  });

  it("does not warn for a 0% (inactive) experiment", () => {
    const result = analyze([
      experiment("e1", 0, cond({ country: "US" })),
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });

  it("flags a hard conflict when a force above fully serves the experiment's segment", () => {
    const result = analyze([
      force("r1", { condition: cond({ country: "US" }) }),
      experiment("e2", 1, cond({ country: "US" })),
    ]);
    expect(result.get("e2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "country", label: "US" }],
      softConflicts: [],
    });
  });

  it("ignores disabled experiment rules as consumers", () => {
    const result = analyze([
      experiment("e1", 1, cond({ country: "US" }), { enabled: false }),
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });

  it("does not siphon when the experiment is targeted (not catch-all)", () => {
    const result = analyze([
      experiment("e1", 0.95, cond({ country: "US" })),
      force("r2", { condition: cond({ browser: "chrome" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });
});

describe("getRuleReachability — experiment-ref rules", () => {
  const expMap = new Map([
    ["exp1", linkedExperiment("exp1")],
    ["exp_archived", linkedExperiment("exp_archived", { archived: true })],
  ]);

  it("marks an experiment-ref unreachable when a force above fully serves its segment", () => {
    const result = analyzeWithExperiments(
      [
        force("r1", { condition: cond({ country: "US" }) }),
        experimentRef("ref1", "exp1", cond({ country: "US" })),
      ],
      expMap,
    );
    expect(result.get("ref1")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "country", label: "US" }],
      softConflicts: [],
    });
  });

  it("warns softly when an experiment-ref above overlaps the same attribute", () => {
    const result = analyzeWithExperiments(
      [
        experimentRef("ref1", "exp1", cond({ country: "US" })),
        force("r2", { condition: cond({ country: "US" }) }),
      ],
      expMap,
    );
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "country", consumingRuleIds: ["ref1"] }],
    });
  });

  it("does not treat experiment-ref rules as traffic siphons", () => {
    const result = analyzeWithExperiments(
      [
        experimentRef("ref1", "exp1"),
        force("r2", { condition: cond({ country: "US" }) }),
      ],
      expMap,
    );
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });

  it("ignores inactive experiment-ref rules (archived linked experiment)", () => {
    const result = analyzeWithExperiments(
      [
        experimentRef("ref1", "exp_archived", cond({ country: "US" })),
        force("r2", { condition: cond({ country: "US" }) }),
      ],
      expMap,
    );
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });

  it("ignores experiment-ref rules when the linked experiment is missing", () => {
    const result = analyzeWithExperiments(
      [
        experimentRef("ref1", "exp_missing", cond({ country: "US" })),
        force("r2", { condition: cond({ country: "US" }) }),
      ],
      expMap,
    );
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });
});

describe("getRuleReachability — compound & edge-case targeting", () => {
  it("does not hard-consume when the rule above has a multi-attribute $and", () => {
    // A two-attribute force isn't a reliable single-attr consumer, so it can't
    // prove that `country = US` alone is fully served above.
    const result = analyze([
      force("r1", {
        condition: cond({
          $and: [{ country: "US" }, { browser: "Safari" }],
        }),
      }),
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "country", consumingRuleIds: ["r1"] }],
    });
  });

  it("warns softly when the target rule uses a top-level $or", () => {
    const result = analyze([
      force("r1", { condition: cond({ country: "US" }) }),
      force("r2", {
        condition: cond({ $or: [{ country: "US" }, { country: "CA" }] }),
      }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "country", consumingRuleIds: ["r1"] }],
    });
  });

  it("reports multiple hard conflicts from different consuming rules", () => {
    const result = analyze([
      force("r1", { condition: cond({ browser: "Safari" }) }),
      force("r2", { condition: cond({ browser: "Chrome" }) }),
      force("r3", {
        condition: cond({ browser: { $in: ["Safari", "Chrome", "Firefox"] } }),
      }),
    ]);
    expect(result.get("r3")).toEqual({
      unreachable: false,
      hardConflicts: [
        { consumingRuleId: "r1", attr: "browser", label: "Safari" },
        { consumingRuleId: "r2", attr: "browser", label: "Chrome" },
      ],
      softConflicts: [],
    });
  });

  it("marks a rule unreachable when multiple forces consume every listed value", () => {
    const result = analyze([
      force("r1", { condition: cond({ country: "US" }) }),
      force("r2", { condition: cond({ country: "CA" }) }),
      force("r3", { condition: cond({ country: { $in: ["US", "CA"] } }) }),
    ]);
    expect(result.get("r3")).toEqual({
      unreachable: true,
      hardConflicts: [
        { consumingRuleId: "r1", attr: "country", label: "US" },
        { consumingRuleId: "r2", attr: "country", label: "CA" },
      ],
      softConflicts: [],
    });
  });

  it("warns softly when prerequisites on the rule above prevent hard consumption", () => {
    const result = analyze([
      {
        ...force("r1", { condition: cond({ country: "US" }) }),
        prerequisites: [{ id: "feat-a", condition: cond({ loggedIn: true }) }],
      } as FeatureRule,
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "country", consumingRuleIds: ["r1"] }],
    });
  });

  it("does not double-report soft conflicts when hard conflicts already cover the attribute", () => {
    const result = analyze([
      force("r1", { condition: cond({ country: "US" }) }),
      force("r2", { condition: cond({ country: { $in: ["US", "CA"] } }) }),
    ]);
    expect(result.get("r2")?.softConflicts).toEqual([]);
    expect(result.get("r2")?.hardConflicts).toEqual([
      { consumingRuleId: "r1", attr: "country", label: "US" },
    ]);
  });

  it("accumulates multiple soft consumers on the same attribute", () => {
    const result = analyze([
      rollout("r1", 0.5, cond({ country: "US" })),
      experiment("e1", 0.5, cond({ country: "US" })),
      force("r2", { condition: cond({ country: "US" }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "country", consumingRuleIds: ["r1", "e1"] }],
    });
  });

  it("does not warn when disjoint $in lists share an attribute name only", () => {
    const result = analyze([
      force("r1", { condition: cond({ tier: { $in: ["gold", "platinum"] } }) }),
      force("r2", { condition: cond({ tier: { $in: ["silver", "bronze"] } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });
});

describe("getRuleReachability — saved groups (ID lists)", () => {
  const listGroup = (
    attributeKey: string,
    values?: string[],
  ): SavedGroupForConflicts => ({ type: "list", attributeKey, values });

  it("marks a rule unreachable when an ID-list group above covers every targeted id", () => {
    // Example 1: an ID-list group [1,2,3] above, then a rule targeting a subset.
    const groups = new Map<string, SavedGroupForConflicts>([
      ["grp_ids", listGroup("id", ["1", "2", "3"])],
    ]);
    const result = analyze(
      [
        force("r1", { savedGroups: [{ ids: ["grp_ids"], match: "any" }] }),
        force("r2", { condition: cond({ id: { $in: ["1", "2"] } }) }),
      ],
      groups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "id", label: "1, 2" }],
      softConflicts: [],
    });
  });

  it("flags a partial hard conflict when the rule targets ids outside the group", () => {
    // Subset includes id "4" which isn't in the group → not fully unreachable.
    const groups = new Map<string, SavedGroupForConflicts>([
      ["grp_ids", listGroup("id", ["1", "2", "3"])],
    ]);
    const result = analyze(
      [
        force("r1", { savedGroups: [{ ids: ["grp_ids"], match: "all" }] }),
        force("r2", { condition: cond({ id: { $in: ["1", "2", "4"] } }) }),
      ],
      groups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [{ consumingRuleId: "r1", attr: "id", label: "1, 2" }],
      softConflicts: [],
    });
  });

  it("detects the conflict between two ID-list groups (superset then subset)", () => {
    const groups = new Map<string, SavedGroupForConflicts>([
      ["grp_big", listGroup("id", ["1", "2", "3"])],
      ["grp_small", listGroup("id", ["1", "2"])],
    ]);
    const result = analyze(
      [
        force("r1", { savedGroups: [{ ids: ["grp_big"], match: "any" }] }),
        force("r2", { savedGroups: [{ ids: ["grp_small"], match: "any" }] }),
      ],
      groups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "id", label: "1, 2" }],
      softConflicts: [],
    });
  });

  it("detects the same conflict expressed as a plain $in condition (example 2)", () => {
    const result = analyze([
      force("r1", { condition: cond({ id: { $in: ["1", "2", "3"] } }) }),
      force("r2", { condition: cond({ id: { $in: ["1", "2"] } }) }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "id", label: "1, 2" }],
      softConflicts: [],
    });
  });

  it("two-pass: an ID-list group with unloaded values yields only a soft warning", () => {
    // First render pass — values not fetched yet, so the group is opaque and we
    // can only tell that both rules touch the `id` attribute.
    const groups = new Map<string, SavedGroupForConflicts>([
      ["grp_ids", listGroup("id")], // no values
    ]);
    const result = analyze(
      [
        force("r1", { savedGroups: [{ ids: ["grp_ids"], match: "any" }] }),
        force("r2", { condition: cond({ id: { $in: ["1", "2"] } }) }),
      ],
      groups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "id", consumingRuleIds: ["r1"] }],
    });
  });

  it('treats "any" across multiple groups as an OR — unreachable only when every branch is covered', () => {
    const groups = new Map<string, SavedGroupForConflicts>([
      ["grp_a", listGroup("id", ["1", "2"])],
      ["grp_b", listGroup("id", ["3", "4"])],
    ]);
    const result = analyze(
      [
        force("r1", { condition: cond({ id: { $in: ["1", "2"] } }) }),
        force("r2", { condition: cond({ id: { $in: ["3", "4"] } }) }),
        force("r3", {
          savedGroups: [{ ids: ["grp_a", "grp_b"], match: "any" }],
        }),
      ],
      groups,
    );
    // Both OR branches are fully served above, so r3 is unreachable — and the
    // tree pass names the rule consuming each branch.
    expect(result.get("r3")).toEqual({
      unreachable: true,
      hardConflicts: [
        { consumingRuleId: "r1", attr: "id", label: "1, 2" },
        { consumingRuleId: "r2", attr: "id", label: "3, 4" },
      ],
      softConflicts: [],
    });
  });

  it('does not mark "any" unreachable when only one branch is covered', () => {
    const groups = new Map<string, SavedGroupForConflicts>([
      ["grp_a", listGroup("id", ["1", "2"])],
      ["grp_b", listGroup("id", ["3", "4"])],
    ]);
    const result = analyze(
      [
        force("r1", { condition: cond({ id: { $in: ["1", "2"] } }) }),
        force("r2", {
          savedGroups: [{ ids: ["grp_a", "grp_b"], match: "any" }],
        }),
      ],
      groups,
    );
    // Only the grp_a branch is covered; the grp_b branch can still be reached.
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "id", consumingRuleIds: ["r1"] }],
    });
  });

  it("does not flag a conflict for NONE OF a condition group equivalent to an earlier ID list", () => {
    // Rule 1: ANY OF an ID list {1..10}. Rule 2: NONE OF a condition group that
    // is {id ∈ 1-5} OR {id ∈ 6-10} (i.e. the same {1..10}). Rule 2 targets
    // everyone NOT in {1..10}, which is disjoint from Rule 1 — no conflict.
    const groups = new Map<string, SavedGroupForConflicts>([
      [
        "grp_list",
        listGroup("id", ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]),
      ],
      [
        "grp_cond",
        {
          type: "condition",
          condition: cond({
            $or: [
              { id: { $in: ["1", "2", "3", "4", "5"] } },
              { id: { $in: ["6", "7", "8", "9", "10"] } },
            ],
          }),
        },
      ],
    ]);
    const result = analyze(
      [
        force("r1", { savedGroups: [{ ids: ["grp_list"], match: "any" }] }),
        force("r2", { savedGroups: [{ ids: ["grp_cond"], match: "none" }] }),
      ],
      groups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });

  it("intersects same-attribute not-in constraints from a De-Morgan'd $nor", () => {
    // Rule 2 = NOT(id ∈ {1-5} OR id ∈ {6-10}) = id ∉ {1..10}; disjoint from the
    // id ∈ {1-5} rule above, so no conflict (and no false hard conflict on the
    // {6-10} the first not-in conjunct alone would appear to leave open).
    const result = analyze([
      force("r1", {
        condition: cond({ id: { $in: ["1", "2", "3", "4", "5"] } }),
      }),
      force("r2", {
        condition: cond({
          $nor: [
            { id: { $in: ["1", "2", "3", "4", "5"] } },
            { id: { $in: ["6", "7", "8", "9", "10"] } },
          ],
        }),
      }),
    ]);
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    });
  });

  it('models "none" of an ID-list group as a not-in constraint', () => {
    // r2 targets everyone NOT in [1,2]; a force for id=5 above carves out id 5.
    const groups = new Map<string, SavedGroupForConflicts>([
      ["grp_ids", listGroup("id", ["1", "2"])],
    ]);
    const result = analyze(
      [
        force("r1", { condition: cond({ id: "5" }) }),
        force("r2", { savedGroups: [{ ids: ["grp_ids"], match: "none" }] }),
      ],
      groups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [{ consumingRuleId: "r1", attr: "id", label: "5" }],
      softConflicts: [],
    });
  });
});

describe("getRuleReachability — saved groups (condition groups)", () => {
  it("resolves a condition group to its condition (no values fetch needed)", () => {
    const groups = new Map<string, SavedGroupForConflicts>([
      ["grp_cond", { type: "condition", condition: cond({ country: "US" }) }],
    ]);
    const result = analyze(
      [
        force("r1", { savedGroups: [{ ids: ["grp_cond"], match: "any" }] }),
        force("r2", { condition: cond({ country: "US" }) }),
      ],
      groups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "country", label: "US" }],
      softConflicts: [],
    });
  });

  it("warns softly when a condition group above shares an attribute opaquely", () => {
    const groups = new Map<string, SavedGroupForConflicts>([
      [
        "grp_cond",
        { type: "condition", condition: cond({ country: { $regex: "U.*" } }) },
      ],
    ]);
    const result = analyze(
      [
        force("r1", { savedGroups: [{ ids: ["grp_cond"], match: "any" }] }),
        force("r2", { condition: cond({ country: "US" }) }),
      ],
      groups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "country", consumingRuleIds: ["r1"] }],
    });
  });
});

describe("getRuleReachability — $inGroup / $notInGroup operators", () => {
  const listGroup = (
    attributeKey: string,
    values?: string[],
  ): SavedGroupForConflicts => ({ type: "list", attributeKey, values });

  it("resolves $inGroup against a loaded list group to a precise in-constraint", () => {
    const groups = new Map<string, SavedGroupForConflicts>([
      ["grp_ids", listGroup("id", ["1", "2", "3"])],
    ]);
    const result = analyze(
      [
        force("r1", { condition: cond({ id: { $inGroup: "grp_ids" } }) }),
        force("r2", { condition: cond({ id: { $in: ["1", "2"] } }) }),
      ],
      groups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "id", label: "1, 2" }],
      softConflicts: [],
    });
  });

  it("treats $inGroup as opaque (soft) until the list group's values load", () => {
    const groups = new Map<string, SavedGroupForConflicts>([
      ["grp_ids", listGroup("id")], // values not fetched yet
    ]);
    const result = analyze(
      [
        force("r1", { condition: cond({ id: { $inGroup: "grp_ids" } }) }),
        force("r2", { condition: cond({ id: { $in: ["1", "2"] } }) }),
      ],
      groups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "id", consumingRuleIds: ["r1"] }],
    });
  });

  it("resolves $notInGroup against a loaded list group to a not-in constraint", () => {
    // r1 serves country ∉ {US, CA}; r2 serves country ∉ {US, CA, DE} — a subset
    // of r1's population, so r2 is unreachable.
    const groups = new Map<string, SavedGroupForConflicts>([
      ["grp_excluded", listGroup("country", ["US", "CA"])],
    ]);
    const result = analyze(
      [
        force("r1", {
          condition: cond({ country: { $notInGroup: "grp_excluded" } }),
        }),
        force("r2", {
          condition: cond({ country: { $nin: ["US", "CA", "DE"] } }),
        }),
      ],
      groups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "country", label: null }],
      softConflicts: [],
    });
  });

  it("treats $notInGroup as opaque (soft) until the list group's values load", () => {
    const groups = new Map<string, SavedGroupForConflicts>([
      ["grp_excluded", listGroup("country")], // values not fetched yet
    ]);
    const result = analyze(
      [
        force("r1", {
          condition: cond({ country: { $notInGroup: "grp_excluded" } }),
        }),
        force("r2", { condition: cond({ country: "US" }) }),
      ],
      groups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: false,
      hardConflicts: [],
      softConflicts: [{ attr: "country", consumingRuleIds: ["r1"] }],
    });
  });

  it("expands $inGroup nested inside a condition saved group", () => {
    // A condition group whose condition itself references an ID-list group via
    // $inGroup should still resolve to that list's values.
    const groups = new Map<string, SavedGroupForConflicts>([
      ["grp_ids", listGroup("id", ["1", "2", "3"])],
      [
        "grp_cond",
        { type: "condition", condition: cond({ id: { $inGroup: "grp_ids" } }) },
      ],
    ]);
    const result = analyze(
      [
        force("r1", { savedGroups: [{ ids: ["grp_cond"], match: "any" }] }),
        force("r2", { condition: cond({ id: { $in: ["1", "2"] } }) }),
      ],
      groups,
    );
    expect(result.get("r2")).toEqual({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "id", label: "1, 2" }],
      softConflicts: [],
    });
  });
});

describe("buildConflictBanners — per-environment grouping", () => {
  const reach = (over: Partial<RuleReachability> = {}): RuleReachability => ({
    unreachable: false,
    hardConflicts: [],
    softConflicts: [],
    ...over,
  });
  const num = (id: string) => (id === "r1" ? 1 : undefined);

  it("single-env view: one banner, no environment naming", () => {
    const banners = buildConflictBanners(
      [
        {
          env: "production",
          reach: reach({
            unreachable: true,
            hardConflicts: [{ consumingRuleId: "r1", attr: null, label: null }],
          }),
        },
      ],
      num,
      false,
    );
    expect(banners).toEqual([
      {
        isUnreachable: true,
        conflicts: {
          hard: [{ ruleNumber: 1, attr: null, label: null }],
          soft: [],
        },
        environments: [],
        allEnvironments: false,
        projects: [],
        allProjects: false,
      },
    ]);
  });

  it('collapses to "all environments" when every env shares the status', () => {
    const r = reach({
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: "id", label: "1, 2" }],
    });
    const banners = buildConflictBanners(
      [
        { env: "dev", reach: r },
        { env: "staging", reach: r },
        { env: "production", reach: r },
      ],
      num,
      true,
    );
    expect(banners).toEqual([
      {
        isUnreachable: true,
        conflicts: {
          hard: [{ ruleNumber: 1, attr: "id", label: "1, 2" }],
          soft: [],
        },
        environments: ["dev", "staging", "production"],
        allEnvironments: true,
        projects: [],
        allProjects: false,
      },
    ]);
  });

  // A rule unreachable in production but only soft-conflicting elsewhere is not
  // *globally* unreachable, so its production banner is a partial (amber)
  // conflict, not the orange serves-nobody status.
  it("splits into separate banners when environments disagree", () => {
    // Unreachable in production, soft conflict in dev + staging.
    const banners = buildConflictBanners(
      [
        {
          env: "dev",
          reach: reach({
            softConflicts: [{ attr: "country", consumingRuleIds: ["r1"] }],
          }),
        },
        {
          env: "staging",
          reach: reach({
            softConflicts: [{ attr: "country", consumingRuleIds: ["r1"] }],
          }),
        },
        {
          env: "production",
          reach: reach({
            unreachable: true,
            hardConflicts: [
              { consumingRuleId: "r1", attr: "id", label: "1, 2" },
            ],
          }),
        },
      ],
      num,
      true,
    );
    expect(banners).toEqual([
      {
        isUnreachable: false,
        conflicts: {
          hard: [{ ruleNumber: 1, attr: "id", label: "1, 2" }],
          soft: [],
        },
        environments: ["production"],
        allEnvironments: false,
        projects: [],
        allProjects: false,
      },
      {
        isUnreachable: false,
        conflicts: {
          hard: [],
          soft: [{ attr: "country", ruleNumbers: [1] }],
        },
        environments: ["dev", "staging"],
        allEnvironments: false,
        projects: [],
        allProjects: false,
      },
    ]);
  });

  it("orders banners unreachable → hard → soft", () => {
    const banners = buildConflictBanners(
      [
        {
          env: "dev",
          reach: reach({
            softConflicts: [{ attr: "x", consumingRuleIds: ["r1"] }],
          }),
        },
        {
          env: "staging",
          reach: reach({
            hardConflicts: [{ consumingRuleId: "r1", attr: "y", label: "v" }],
          }),
        },
        {
          env: "production",
          reach: reach({
            unreachable: true,
            hardConflicts: [{ consumingRuleId: "r1", attr: null, label: null }],
          }),
        },
      ],
      num,
      true,
    );
    // Ordering is by status level (unreachable-level cells first), shown by the
    // environment order; isUnreachable is false throughout because the rule is
    // reachable somewhere (only a subset of cells is unreachable).
    expect(banners.map((b) => [b.isUnreachable, b.environments])).toEqual([
      [false, ["production"]],
      [false, ["staging"]],
      [false, ["dev"]],
    ]);
  });

  it("produces no banners when every environment is clean", () => {
    const banners = buildConflictBanners(
      [
        { env: "dev", reach: reach() },
        { env: "production", reach: reach() },
      ],
      num,
      true,
    );
    expect(banners).toEqual([]);
  });

  it('does not say "all environments" when only one env applies', () => {
    const banners = buildConflictBanners(
      [
        {
          env: "production",
          reach: reach({
            unreachable: true,
            hardConflicts: [{ consumingRuleId: "r1", attr: null, label: null }],
          }),
        },
      ],
      num,
      true,
    );
    expect(banners[0].environments).toEqual(["production"]);
    expect(banners[0].allEnvironments).toBe(false);
  });
});

describe("getReachabilityCells — project × environment partitioning", () => {
  // Summarize a rule's cells as sorted {env, project, unreachable} for stable
  // assertions.
  const cellsFor = (map: ReturnType<typeof getReachabilityCells>, id: string) =>
    (map.get(id) ?? [])
      .map((c) => ({
        env: c.env,
        project: c.project,
        unreachable: c.reach.unreachable,
      }))
      .sort((a, b) =>
        a.env === b.env
          ? a.project.localeCompare(b.project)
          : a.env.localeCompare(b.env),
      );

  it("projects=some: a project-scoped 100% rule only shadows its own project", () => {
    // r1 forces everyone but is scoped to clo; r2 is unscoped. r2 is consumed in
    // the clo cell but reachable in brainzy — the reported false positive.
    const r1 = force("r1", { projects: ["clo"], allProjects: false });
    const r2 = force("r2");
    const cells = getReachabilityCells(
      [{ env: "production", rules: [r1, r2] }],
      ["brainzy", "clo"],
      noExperiments,
    );
    expect(cellsFor(cells, "r2")).toEqual([
      { env: "production", project: "brainzy", unreachable: false },
      { env: "production", project: "clo", unreachable: true },
    ]);
  });

  it("projects=all: an unscoped 100% rule shadows every project", () => {
    const r1 = force("r1"); // unscoped catch-all
    const r2 = force("r2");
    const cells = getReachabilityCells(
      [{ env: "production", rules: [r1, r2] }],
      ["brainzy", "clo"],
      noExperiments,
    );
    expect(cellsFor(cells, "r2")).toEqual([
      { env: "production", project: "brainzy", unreachable: true },
      { env: "production", project: "clo", unreachable: true },
    ]);
  });

  it("projects=none: a rule scoped to no project produces no cells", () => {
    const r1 = force("r1", { projects: [], allProjects: false });
    const cells = getReachabilityCells(
      [{ env: "production", rules: [r1] }],
      ["brainzy", "clo"],
      noExperiments,
    );
    expect(cells.get("r1")).toBeUndefined();
  });

  it("env × project: an env-scoped project-scoped rule shadows only its one cell", () => {
    // r1 forces everyone, scoped to clo, and (via rulesByEnv) only present in
    // production. r2 is unscoped, present in both envs.
    const r1 = force("r1", { projects: ["clo"], allProjects: false });
    const r2 = force("r2");
    const cells = getReachabilityCells(
      [
        { env: "production", rules: [r1, r2] },
        { env: "dev", rules: [r2] },
      ],
      ["brainzy", "clo"],
      noExperiments,
    );
    expect(cellsFor(cells, "r2")).toEqual([
      { env: "dev", project: "brainzy", unreachable: false },
      { env: "dev", project: "clo", unreachable: false },
      { env: "production", project: "brainzy", unreachable: false },
      { env: "production", project: "clo", unreachable: true },
    ]);
  });

  it("all-projects feature: unscoped shadow covers the scoped bucket and the sentinel", () => {
    const r1 = force("r1"); // unscoped catch-all
    const r2 = force("r2");
    const cells = getReachabilityCells(
      [{ env: "production", rules: [r1, r2] }],
      ["clo", OTHER_PROJECT_BUCKET],
      noExperiments,
    );
    expect(cellsFor(cells, "r2")).toEqual([
      { env: "production", project: "clo", unreachable: true },
      { env: "production", project: OTHER_PROJECT_BUCKET, unreachable: true },
    ]);
  });

  it("all-projects feature: a project-scoped shadow leaves the sentinel reachable", () => {
    const r1 = force("r1", { projects: ["clo"], allProjects: false });
    const r2 = force("r2");
    const cells = getReachabilityCells(
      [{ env: "production", rules: [r1, r2] }],
      ["clo", OTHER_PROJECT_BUCKET],
      noExperiments,
    );
    expect(cellsFor(cells, "r2")).toEqual([
      { env: "production", project: "clo", unreachable: true },
      { env: "production", project: OTHER_PROJECT_BUCKET, unreachable: false },
    ]);
  });
});

describe("buildConflictBanners — project nuance", () => {
  const num = (id: string) => (id === "r1" ? 1 : undefined);
  const unreachableIn = (env: string, project: string) => ({
    env,
    project,
    reach: {
      unreachable: true,
      hardConflicts: [{ consumingRuleId: "r1", attr: null, label: null }],
      softConflicts: [],
    } as RuleReachability,
  });
  const cleanIn = (env: string, project: string) => ({
    env,
    project,
    reach: {
      unreachable: false,
      hardConflicts: [],
      softConflicts: [],
    } as RuleReachability,
  });

  it("names the projects when unreachable in a strict subset of them", () => {
    const banners = buildConflictBanners(
      [unreachableIn("production", "clo"), cleanIn("production", "brainzy")],
      num,
      false,
      { multiProject: true, projectLabel: (id) => id.toUpperCase() },
    );
    expect(banners).toHaveLength(1);
    // Reachable in brainzy → not globally unreachable → amber, not orange.
    expect(banners[0].isUnreachable).toBe(false);
    expect(banners[0].projects).toEqual(["CLO"]);
    expect(banners[0].allProjects).toBe(false);
  });

  it("flags allProjects (and stays fully unreachable) across every project", () => {
    const banners = buildConflictBanners(
      [
        unreachableIn("production", "clo"),
        unreachableIn("production", "brainzy"),
      ],
      num,
      false,
      { multiProject: true },
    );
    expect(banners[0].isUnreachable).toBe(true);
    expect(banners[0].projects).toEqual([]);
    expect(banners[0].allProjects).toBe(true);
  });

  it("omits project info for single-project features", () => {
    const banners = buildConflictBanners(
      [unreachableIn("production", "clo")],
      num,
      false,
      { multiProject: false },
    );
    expect(banners[0].projects).toEqual([]);
    expect(banners[0].allProjects).toBe(false);
  });

  it("excludes the sentinel bucket from named projects", () => {
    const banners = buildConflictBanners(
      [
        unreachableIn("production", "clo"),
        unreachableIn("production", OTHER_PROJECT_BUCKET),
        cleanIn("production", "brainzy"),
      ],
      num,
      false,
      { multiProject: true },
    );
    // clo + sentinel are unreachable, brainzy clean → subset, sentinel not named.
    expect(banners[0].projects).toEqual(["clo"]);
  });
});
