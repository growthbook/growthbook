import type { PopulationStep } from "shared/validators";
import {
  getDefaultPopulationUserIdType,
  getPopulationDraftIssue,
  movePopulationStep,
  newPopulationStep,
  PopulationDraft,
  removePopulationStep,
} from "@/components/Populations/populationDraft";

function step(
  factTableId: string,
  overrides: Partial<PopulationStep> = {},
): PopulationStep {
  return {
    ...newPopulationStep({ isFirst: false }),
    source: { type: "factTable", factTableId },
    ...overrides,
  };
}

const anyTime: PopulationStep["windowSettings"] = {
  type: "",
  delayValue: 0,
  delayUnit: "days",
  windowValue: 0,
  windowUnit: "days",
};

describe("getDefaultPopulationUserIdType", () => {
  const factTables = [
    { datasource: "ds_1", userIdTypes: ["user_id"] },
    { datasource: "ds_1", userIdTypes: ["user_id", "anonymous_id"] },
    { datasource: "ds_2", userIdTypes: ["anonymous_id"] },
    { datasource: "ds_2", userIdTypes: ["anonymous_id"] },
  ];

  it("picks the type the most fact tables in the Data Source support", () => {
    expect(
      getDefaultPopulationUserIdType(
        ["anonymous_id", "user_id"],
        factTables,
        "ds_1",
      ),
    ).toBe("user_id");
  });

  it("keeps the Data Source order on a tie", () => {
    expect(
      getDefaultPopulationUserIdType(["device_id", "user_id"], [], "ds_1"),
    ).toBe("device_id");
  });

  it("returns null when the Data Source has no identifier types", () => {
    expect(getDefaultPopulationUserIdType([], factTables, "ds_1")).toBeNull();
  });
});

describe("newPopulationStep", () => {
  it("starts the first step at any time", () => {
    expect(newPopulationStep({ isFirst: true }).windowSettings).toEqual(
      anyTime,
    );
  });

  it("starts later steps within 7 days of the previous step", () => {
    const s = newPopulationStep({ isFirst: false, negation: true });
    expect(s.negation).toBe(true);
    expect(s.windowSettings).toMatchObject({
      type: "conversion",
      windowValue: 7,
      windowUnit: "days",
    });
  });
});

describe("movePopulationStep", () => {
  it("swaps steps", () => {
    const steps = [step("a", { windowSettings: anyTime }), step("b")];
    expect(
      movePopulationStep(steps, 0, 1).map((s) => s.source.factTableId),
    ).toEqual(["b", "a"]);
  });

  it("clears negation and a conversion window on the new first step", () => {
    const steps = [
      step("a", { windowSettings: anyTime }),
      step("b", { negation: true }),
    ];
    const [first, second] = movePopulationStep(steps, 1, 0);
    expect(first.source.factTableId).toBe("b");
    expect(first.negation).toBeUndefined();
    expect(first.windowSettings).toEqual(anyTime);
    expect(second.source.factTableId).toBe("a");
  });

  it("keeps a lookback window on the new first step", () => {
    const lookback = { ...anyTime, type: "lookback" as const, windowValue: 30 };
    const steps = [
      step("a", { windowSettings: anyTime }),
      step("b", { windowSettings: lookback }),
    ];
    expect(movePopulationStep(steps, 1, 0)[0].windowSettings).toEqual(lookback);
  });

  it("ignores moves past either end", () => {
    const steps = [step("a"), step("b")];
    expect(movePopulationStep(steps, 0, -1)).toBe(steps);
    expect(movePopulationStep(steps, 1, 2)).toBe(steps);
  });
});

describe("removePopulationStep", () => {
  it("normalizes the step that becomes first", () => {
    const steps = [step("a", { windowSettings: anyTime }), step("b")];
    const [first] = removePopulationStep(steps, 0);
    expect(first.source.factTableId).toBe("b");
    expect(first.windowSettings.type).toBe("");
  });
});

describe("getPopulationDraftIssue", () => {
  const complete: PopulationDraft = {
    name: "Buyers",
    description: "",
    datasource: "ds_1",
    userIdTypes: ["user_id"],
    steps: [step("a", { windowSettings: anyTime }), step("b")],
  };

  it("accepts a complete draft", () => {
    expect(getPopulationDraftIssue(complete)).toBeNull();
  });

  it("requires a name", () => {
    expect(getPopulationDraftIssue({ ...complete, name: "  " })).toBe(
      "Enter a name.",
    );
  });

  it("requires a fact table on every step", () => {
    expect(
      getPopulationDraftIssue({
        ...complete,
        steps: [complete.steps[0], step("")],
      }),
    ).toBe("Choose a fact table for step 2.");
  });

  it("requires complete row filters", () => {
    expect(
      getPopulationDraftIssue({
        ...complete,
        steps: [
          step("a", {
            windowSettings: anyTime,
            rowFilters: [{ column: "country", operator: "=", values: [""] }],
          }),
        ],
      }),
    ).toBe("Finish the row filter in step 1.");
  });

  it("requires a valid aggregate filter when a column is set", () => {
    const withAggregate = (aggregateFilter: string) => ({
      ...complete,
      steps: [
        step("a", {
          windowSettings: anyTime,
          aggregateFilterColumn: "$$count",
          aggregateFilter,
        }),
      ],
    });
    expect(getPopulationDraftIssue(withAggregate(">="))).toBe(
      "Finish the aggregate filter in step 1.",
    );
    expect(getPopulationDraftIssue(withAggregate(">=3,<10"))).toBeNull();
  });

  it("requires a window length when a window is set", () => {
    expect(
      getPopulationDraftIssue({
        ...complete,
        steps: [
          complete.steps[0],
          step("b", {
            windowSettings: { ...anyTime, type: "conversion", windowValue: 0 },
          }),
        ],
      }),
    ).toBe("Enter a window length for step 2.");
  });
});
