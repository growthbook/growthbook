import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import {
  buildQaOverrideBody,
  groupQaOverrides,
  isQaOverrideFormComplete,
  qaOverrideBodyEquals,
  qaOverrideFormDefaults,
  qaOverridesNeedGrouping,
  completeQaOverrideFilters,
  qaOverrideAudienceSentence,
  summarizeQaOverrideAudience,
} from "@/services/qaOverrides";

const lookups = {
  savedGroupName: (id: string) =>
    ({ g1: "QA team", g2: "Beta testers" })[id] ?? id,
  sdkConnectionName: (id: string) =>
    ({ c1: "Local dev (React)", c2: "Staging (iOS)", c3: "QA Android" })[id] ??
    id,
  projectName: (id: string) => ({ p1: "Checkout", p2: "Growth" })[id] ?? id,
  operatorText: (op: string) =>
    ({ $eq: "=", $ne: "≠", $in: "is any of" })[op] ?? op.replace("$", ""),
};

function override(
  partial: Partial<ExperimentQaOverrideInterface> & { id: string },
): ExperimentQaOverrideInterface {
  return {
    organization: "org",
    experiment: "exp",
    environment: "dev",
    order: 0,
    filters: {},
    assignment: { type: "random" },
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-01-01"),
    createdBy: null,
    ...partial,
  } as ExperimentQaOverrideInterface;
}

describe("groupQaOverrides", () => {
  it("groups by environment in org order, numbering within each group", () => {
    const groups = groupQaOverrides(
      [
        override({ id: "a", environment: "staging", order: 0 }),
        override({ id: "b", environment: "dev", order: 1 }),
        override({ id: "c", environment: "dev", order: 0 }),
        override({ id: "d", environment: "gone", order: 0 }),
      ],
      ["dev", "staging", "production"],
    );
    expect(groups.map((g) => g.environment)).toEqual([
      "dev",
      "staging",
      "gone",
    ]);
    expect(groups[0].rows.map((r) => [r.item.id, r.priority])).toEqual([
      ["c", 1],
      ["b", 2],
    ]);
    expect(groups[1].rows.map((r) => r.priority)).toEqual([1]);
    expect(qaOverridesNeedGrouping(groups)).toBe(true);
  });

  it("does not need grouping when every environment has one override", () => {
    const groups = groupQaOverrides(
      [
        override({ id: "a", environment: "dev" }),
        override({ id: "b", environment: "staging" }),
      ],
      ["dev", "staging"],
    );
    expect(qaOverridesNeedGrouping(groups)).toBe(false);
  });
});

// Every row of the design's "Who sees it · summary sentence" scenarios.
describe("the who-sees-it summary", () => {
  const sentence = (
    filters: Parameters<typeof summarizeQaOverrideAudience>[0],
    opts: { environment?: string; usesExperimentTargeting?: boolean } = {
      environment: "dev",
    },
    order?: Parameters<typeof summarizeQaOverrideAudience>[2],
  ) =>
    qaOverrideAudienceSentence({
      segments: summarizeQaOverrideAudience(filters, lookups, order),
      ...opts,
    });
  const cond = (c: unknown) => ({ condition: JSON.stringify(c) });

  it("says everyone when there are no filters", () => {
    expect(sentence({}, {})).toBe("Everyone in the selected environment.");
    expect(sentence({})).toBe("Everyone in dev.");
  });

  it("names a single filter's value without a type label", () => {
    expect(sentence(cond({ id: "123" }))).toBe("Anyone matching id = 123.");
    expect(sentence({ savedGroups: [{ match: "any", ids: ["g1"] }] })).toBe(
      "Anyone matching QA team.",
    );
    expect(sentence({ sdkConnections: ["c1"] })).toBe(
      "Anyone matching Local dev (React).",
    );
    expect(sentence({ projects: ["p1"] })).toBe("Anyone matching Checkout.");
  });

  it("separates several values of one type with commas, never AND", () => {
    expect(
      sentence({ savedGroups: [{ match: "any", ids: ["g1", "g2"] }] }),
    ).toBe("Anyone matching QA team, Beta testers.");
    expect(sentence({ sdkConnections: ["c1", "c2"] })).toBe(
      "Anyone matching Local dev (React), Staging (iOS).",
    );
    expect(sentence({ projects: ["p1", "p2"] })).toBe(
      "Anyone matching Checkout, Growth.",
    );
  });

  it("shows three values of a long list, then a count", () => {
    expect(sentence({ sdkConnections: ["c1", "c2", "c3", "c4", "c5"] })).toBe(
      "Anyone matching Local dev (React), Staging (iOS), QA Android +2 more.",
    );
  });

  it("joins filter types with AND, in the order of the filter cards", () => {
    expect(sentence({ ...cond({ id: "123" }), sdkConnections: ["c1"] })).toBe(
      "Anyone matching id = 123 AND Local dev (React).",
    );
    const all = {
      ...cond({ id: "123" }),
      savedGroups: [{ match: "any" as const, ids: ["g1"] }],
      sdkConnections: ["c1"],
      projects: ["p1"],
    };
    expect(sentence(all)).toBe(
      "Anyone matching id = 123 AND QA team AND Local dev (React) AND Checkout.",
    );
    expect(
      sentence(all, { environment: "dev" }, ["projects", "condition"]),
    ).toBe(
      "Anyone matching Checkout AND id = 123 AND QA team AND Local dev (React).",
    );
    expect(
      sentence({
        savedGroups: [{ match: "any", ids: ["g1", "g2"] }],
        sdkConnections: ["c1", "c2"],
      }),
    ).toBe(
      "Anyone matching QA team, Beta testers AND Local dev (React), Staging (iOS).",
    );
  });

  it("puts attribute conditions into words", () => {
    expect(sentence(cond({ id: "123", country: "US" }))).toBe(
      "Anyone matching id = 123 and country = US.",
    );
    expect(sentence(cond({ $or: [{ id: "123" }, { id: "456" }] }))).toBe(
      "Anyone matching id = 123 or id = 456.",
    );
    expect(sentence(cond({ id: { $ne: "123" } }))).toBe(
      "Anyone matching id ≠ 123.",
    );
    expect(sentence(cond({ country: { $in: ["US", "CA"] } }))).toBe(
      "Anyone matching country is any of US, CA.",
    );
  });

  it("falls back to a custom condition for advanced JSON", () => {
    const segments = summarizeQaOverrideAudience(
      cond({ $nor: [{ id: "1" }] }),
      lookups,
    );
    expect(segments).toEqual([
      { kind: "condition", text: "a custom condition", custom: true },
    ]);
    expect(qaOverrideAudienceSentence({ segments, environment: "dev" })).toBe(
      "Anyone matching a custom condition.",
    );
  });

  it("ignores filters that were added but not filled in", () => {
    const base = qaOverrideFormDefaults(undefined, "dev");
    const emptyAttribute = completeQaOverrideFilters({
      ...base,
      filters: ["condition"],
      condition: JSON.stringify({ id: "" }),
    });
    expect(sentence(emptyAttribute)).toBe("Everyone in dev.");
    const oneFilled = completeQaOverrideFilters({
      ...base,
      filters: ["condition", "sdkConnections"],
      condition: JSON.stringify({ id: "123" }),
    });
    expect(sentence(oneFilled)).toBe("Anyone matching id = 123.");
  });

  it("leads with the experiment's targeting in Test mode", () => {
    const test = { environment: "dev", usesExperimentTargeting: true };
    expect(sentence({}, test)).toBe(
      "Anyone matching the experiment's targeting.",
    );
    expect(
      sentence(
        {
          savedGroups: [{ match: "any", ids: ["g1"] }],
          sdkConnections: ["c1"],
        },
        test,
      ),
    ).toBe(
      "Anyone matching the experiment's targeting AND QA team AND Local dev (React).",
    );
  });
});

describe("the add/edit form", () => {
  it("starts with nothing picked when creating", () => {
    const v = qaOverrideFormDefaults(undefined, "dev");
    expect(v.environment).toBe("dev");
    expect(v.assignmentType).toBe("");
    expect(v.filters).toEqual([]);
    expect(isQaOverrideFormComplete(v)).toBe(false);
  });

  it("is complete once an assignment is picked and every card is filled", () => {
    const v = qaOverrideFormDefaults(undefined, "dev");
    expect(isQaOverrideFormComplete({ ...v, assignmentType: "random" })).toBe(
      true,
    );
    expect(isQaOverrideFormComplete({ ...v, assignmentType: "forced" })).toBe(
      false,
    );
    expect(
      isQaOverrideFormComplete({
        ...v,
        assignmentType: "forced",
        forcedVariationId: "v1",
      }),
    ).toBe(true);
    // An added but empty card blocks saving instead of being dropped.
    expect(
      isQaOverrideFormComplete({
        ...v,
        assignmentType: "random",
        filters: ["condition"],
        condition: JSON.stringify({ id: "" }),
      }),
    ).toBe(false);
    expect(
      isQaOverrideFormComplete({
        ...v,
        assignmentType: "random",
        filters: ["condition", "savedGroups"],
        condition: JSON.stringify({ id: "123" }),
        savedGroups: [{ match: "any", ids: [] }],
      }),
    ).toBe(false);
    expect(
      isQaOverrideFormComplete({
        ...v,
        assignmentType: "random",
        filters: ["sdkConnections"],
        sdkConnections: ["c1"],
      }),
    ).toBe(true);
  });

  it("builds the body from added cards only and compares ignoring order", () => {
    const v = {
      ...qaOverrideFormDefaults(undefined, "dev"),
      assignmentType: "forced" as const,
      forcedVariationId: "v1",
      filters: ["sdkConnections" as const],
      sdkConnections: ["c2", "c1"],
      // Not added as a card, so it must not be sent.
      projects: ["p1"],
    };
    const body = buildQaOverrideBody(v);
    expect(body).toEqual({
      filters: { sdkConnections: ["c2", "c1"] },
      assignment: { type: "forced", variationId: "v1" },
    });
    expect(
      qaOverrideBodyEquals(body, {
        filters: { sdkConnections: ["c1", "c2"], condition: "{}" },
        assignment: { type: "forced", variationId: "v1" },
      }),
    ).toBe(true);
    expect(
      qaOverrideBodyEquals(body, {
        filters: { sdkConnections: ["c1"] },
        assignment: { type: "forced", variationId: "v1" },
      }),
    ).toBe(false);
  });

  it("round-trips an existing override through defaults and build", () => {
    const existing = override({
      id: "a",
      filters: {
        condition: JSON.stringify({ id: "123" }),
        savedGroups: [{ match: "all", ids: ["g1"] }],
      },
      assignment: { type: "forced", variationId: "v0" },
    });
    const v = qaOverrideFormDefaults(existing);
    expect(v.filters).toEqual(["condition", "savedGroups"]);
    expect(
      qaOverrideBodyEquals(buildQaOverrideBody(v), {
        filters: existing.filters,
        assignment: existing.assignment,
      }),
    ).toBe(true);
  });
});
