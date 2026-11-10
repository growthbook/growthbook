import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import {
  buildQaOverrideBody,
  groupQaOverrides,
  isQaOverrideFormComplete,
  qaOverrideBodyEquals,
  qaOverrideFormDefaults,
  qaOverridesNeedGrouping,
  summarizeQaOverrideFilters,
} from "@/services/qaOverrides";

const lookups = {
  savedGroupName: (id: string) => ({ g1: "QA team", g2: "Internal" })[id] ?? id,
  sdkConnectionName: (id: string) => ({ c1: "Local dev" })[id] ?? id,
  projectName: (id: string) => ({ p1: "Checkout" })[id] ?? id,
  operatorText: (op: string) => (op === "$eq" ? "=" : op.replace("$", "")),
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

describe("summarizeQaOverrideFilters", () => {
  it("turns simple conditions into one chip per clause", () => {
    const s = summarizeQaOverrideFilters(
      { condition: JSON.stringify({ id: "123" }) },
      lookups,
    );
    expect(s.chips).toEqual([{ kind: "condition", label: "id = 123" }]);
    expect(s.hidden).toBe(0);
  });

  it("collapses OR groups and advanced JSON into a custom chip", () => {
    expect(
      summarizeQaOverrideFilters(
        { condition: JSON.stringify({ $or: [{ id: "1" }, { id: "2" }] }) },
        lookups,
      ).chips[0],
    ).toMatchObject({ label: "Custom condition", custom: true });
    expect(
      summarizeQaOverrideFilters(
        { condition: JSON.stringify({ $nor: [{ id: "1" }] }) },
        lookups,
      ).chips[0],
    ).toMatchObject({ custom: true });
  });

  it("names groups, connections and projects, and counts the overflow", () => {
    const s = summarizeQaOverrideFilters(
      {
        condition: JSON.stringify({ country: "CA" }),
        savedGroups: [{ match: "any", ids: ["g1", "g2"] }],
        sdkConnections: ["c1"],
        projects: ["p1"],
      },
      lookups,
    );
    expect(s.chips.map((c) => c.label)).toEqual([
      "country = CA",
      "Group: QA team, Internal",
      "SDK: Local dev",
      "Project: Checkout",
    ]);
    expect(s.visible).toHaveLength(2);
    expect(s.hidden).toBe(2);
  });

  it("is empty when there are no filters", () => {
    expect(summarizeQaOverrideFilters({}, lookups).chips).toEqual([]);
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
