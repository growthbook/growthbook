/// <reference types="jest" />

import {
  getEffectiveExperimentBlock,
  blockUsesGlobalFilter,
  autoEnrollDashboardBlocksInGlobalFilter,
  getDashboardExperimentFilterApplicability,
  resolveGlobalControlsBlockEnrollment,
  isEnablingGlobalFilter,
  getActiveExperimentGlobalFilterKeys,
  experimentBlockHasActiveGlobalFilters,
  experimentBlockFollowsGlobalFilters,
  experimentBlockOptedOutOfGlobalFilters,
  setExperimentBlockGlobalFilterFollowing,
  getDefaultExperimentBlockGlobalControlSettings,
  getActiveBlockGlobalFilterKeys,
  getCustomBlockGlobalFilterKeys,
  withBlockGlobalFilterFollowing,
} from "../../src/enterprise/dashboards/utils";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  ExperimentsScaledImpactBlockInterface,
  ExperimentsStatusBlockInterface,
  MetricExperimentsBlockInterface,
} from "../../src/enterprise";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toEqual: (expected: unknown) => void;
  toBe: (expected: unknown) => void;
};

type AnyBlock = DashboardBlockInterfaceOrData<DashboardBlockInterface>;

function scaledImpactBlock(
  overrides: Partial<ExperimentsScaledImpactBlockInterface> = {},
): DashboardBlockInterfaceOrData<ExperimentsScaledImpactBlockInterface> {
  return {
    type: "experiments-scaled-impact",
    title: "",
    description: "",
    dateRange: { predefined: "last90Days" },
    projects: ["prj_block"],
    metricId: "met_block",
    experimentSearchString: "status:stopped",
    ...overrides,
  } as DashboardBlockInterfaceOrData<ExperimentsScaledImpactBlockInterface>;
}

function metricExperimentsBlock(
  overrides: Partial<MetricExperimentsBlockInterface> = {},
): DashboardBlockInterfaceOrData<MetricExperimentsBlockInterface> {
  return {
    type: "metric-experiments",
    title: "",
    description: "",
    metricId: "met_block",
    projects: ["prj_block"],
    experimentSearchString: "",
    differenceType: "relative",
    bandits: false,
    ...overrides,
  } as DashboardBlockInterfaceOrData<MetricExperimentsBlockInterface>;
}

function statusBlock(
  overrides: Partial<ExperimentsStatusBlockInterface> = {},
): DashboardBlockInterfaceOrData<ExperimentsStatusBlockInterface> {
  return {
    type: "experiments-status",
    title: "",
    description: "",
    dateRange: { predefined: "last90Days" },
    projects: ["prj_block"],
    dateGranularity: "week",
    ...overrides,
  } as DashboardBlockInterfaceOrData<ExperimentsStatusBlockInterface>;
}

// Project scope rides in the search string as a `project:` token, alongside
// every other experiment filter category.
const globalControls = {
  dateRange: { predefined: "last7Days" as const },
  dateGranularity: "day" as const,
  experimentSearchString: "tag:checkout project:prj_dashboard",
};

describe("getEffectiveExperimentBlock", () => {
  it("overrides only the filters the block has opted into", () => {
    const block = scaledImpactBlock({
      globalControlSettings: { experimentSearchString: true, dateRange: false },
    });
    const effective = getEffectiveExperimentBlock(block, { globalControls });
    // Opted into the search string -> overridden
    expect(effective.experimentSearchString).toEqual(
      "tag:checkout project:prj_dashboard",
    );
    // Opted out of date -> keeps its own
    expect(effective.dateRange).toEqual({ predefined: "last90Days" });
  });

  it("keeps the block's own metric even when it inherits everything else", () => {
    // metricId is what the block calculates, not a filter over experiments, so
    // it is not a global control at all (the dashboard has no metric to apply).
    const block = scaledImpactBlock({
      globalControlSettings:
        getDefaultExperimentBlockGlobalControlSettings(scaledImpactBlock()),
    });
    const effective = getEffectiveExperimentBlock(block, { globalControls });
    expect(effective.metricId).toEqual("met_block");
  });

  it("clears the block's own projects when it inherits the search string", () => {
    // The dashboard's `project:` token is the only project scope in play —
    // leaving the local list would apply two project filters at once, and the
    // server (union) and client (intersect) paths disagree about what that means.
    const block = scaledImpactBlock({
      globalControlSettings: { experimentSearchString: true },
    });
    const effective = getEffectiveExperimentBlock(block, { globalControls });
    expect(effective.projects).toEqual([]);
  });

  it("leaves the block's projects alone when it opts out", () => {
    const block = scaledImpactBlock({
      globalControlSettings: { experimentSearchString: false },
    });
    const effective = getEffectiveExperimentBlock(block, { globalControls });
    expect(effective.projects).toEqual(["prj_block"]);
    expect(effective.experimentSearchString).toEqual("status:stopped");
  });

  it("applies date range and granularity to Team Velocity when opted in", () => {
    const block = statusBlock({ globalControlSettings: { dateRange: true } });
    const effective = getEffectiveExperimentBlock(block, { globalControls });
    expect(effective.dateRange).toEqual({ predefined: "last7Days" });
    expect(effective.dateGranularity).toEqual("day");
  });

  it("never applies the date range to Experiments with Lift", () => {
    const block = metricExperimentsBlock({
      globalControlSettings: {
        // Even if a (nonsensical) dateRange opt-in were persisted, the block
        // does not support it, so it is ignored.
        dateRange: true,
        experimentSearchString: true,
      },
    });
    const effective = getEffectiveExperimentBlock(block, { globalControls });
    expect("dateRange" in effective).toBe(false);
    expect(effective.experimentSearchString).toEqual(
      "tag:checkout project:prj_dashboard",
    );
  });

  it("ignores an unset search-string filter", () => {
    const block = scaledImpactBlock({
      globalControlSettings: { experimentSearchString: true },
    });
    const effective = getEffectiveExperimentBlock(block, {
      globalControls: {},
    });
    expect(effective.experimentSearchString).toEqual("status:stopped");
    // Nothing inherited, so the local projects survive.
    expect(effective.projects).toEqual(["prj_block"]);
  });
});

describe("blockUsesGlobalFilter", () => {
  it("is true only when supported and opted in", () => {
    expect(
      blockUsesGlobalFilter(
        scaledImpactBlock({
          globalControlSettings: { experimentSearchString: true },
        }),
        "experimentSearchString",
      ),
    ).toBe(true);
    // Metric Experiments never supports date.
    expect(
      blockUsesGlobalFilter(
        metricExperimentsBlock({ globalControlSettings: { dateRange: true } }),
        "dateRange",
      ),
    ).toBe(false);
  });
});

describe("autoEnrollDashboardBlocksInGlobalFilter", () => {
  it("enrolls undecided blocks but leaves explicit choices untouched", () => {
    const blocks: AnyBlock[] = [
      scaledImpactBlock(), // undefined -> enroll
      scaledImpactBlock({
        globalControlSettings: { experimentSearchString: false },
      }), // opted out -> keep
      metricExperimentsBlock(), // does not support date -> unchanged
    ];
    const next = autoEnrollDashboardBlocksInGlobalFilter(blocks, "dateRange");
    expect(next[0].globalControlSettings?.dateRange).toBe(true);
    // search opt-out preserved; dateRange freshly enrolled
    expect(next[1].globalControlSettings?.dateRange).toBe(true);
    expect(next[1].globalControlSettings?.experimentSearchString).toBe(false);
    // metric-experiments does not support dateRange
    expect(next[2].globalControlSettings?.dateRange).toEqual(undefined);
  });
});

describe("getDashboardExperimentFilterApplicability", () => {
  it("shows a control only when a present block supports it", () => {
    const applicability = getDashboardExperimentFilterApplicability([
      statusBlock(),
    ]);
    expect(applicability.hasExperimentBlocks).toBe(true);
    expect(applicability.showDateRange).toBe(true);
    expect(applicability.showGranularity).toBe(true);
    expect(applicability.showExperimentSearch).toBe(true);
    expect(applicability.hasDateExcludedBlock).toBe(false);
  });

  it("flags the date-excluded block for Experiments with Lift", () => {
    const applicability = getDashboardExperimentFilterApplicability([
      metricExperimentsBlock(),
    ]);
    expect(applicability.showExperimentSearch).toBe(true);
    expect(applicability.showDateRange).toBe(false);
    expect(applicability.hasDateExcludedBlock).toBe(true);
  });
});

describe("resolveGlobalControlsBlockEnrollment", () => {
  it("enrolls supported blocks for each newly enabled filter", () => {
    const enrolled = resolveGlobalControlsBlockEnrollment({
      existingGlobalControls: {},
      nextGlobalControls: { dateRange: { predefined: "last7Days" } },
      nextBlocks: [scaledImpactBlock(), metricExperimentsBlock()],
    });
    // Scaled impact supports the date range -> enrolled; Experiments with Lift
    // does not -> untouched
    expect(enrolled?.[0].globalControlSettings?.dateRange).toBe(true);
    expect(enrolled?.[1].globalControlSettings?.dateRange).toEqual(undefined);
  });

  it("does nothing when no filter is newly enabled", () => {
    expect(
      isEnablingGlobalFilter(
        { experimentSearchString: "a" },
        { experimentSearchString: "b" },
        "experimentSearchString",
      ),
    ).toBe(false);
  });
});

describe("getActiveExperimentGlobalFilterKeys", () => {
  it("returns only supported filters that are active on the dashboard", () => {
    // Scaled impact supports both; only the search string is active here.
    expect(
      getActiveExperimentGlobalFilterKeys(scaledImpactBlock(), {
        experimentSearchString: "tag:checkout",
      }),
    ).toEqual(["experimentSearchString"]);
  });

  it("excludes date range for Experiments with Lift", () => {
    expect(
      getActiveExperimentGlobalFilterKeys(
        metricExperimentsBlock(),
        globalControls,
      ),
    ).toEqual(["experimentSearchString"]);
  });

  it("is empty for a non-experiment block", () => {
    const markdown = {
      type: "markdown",
      title: "",
      description: "",
      content: "",
    } as AnyBlock;
    expect(
      getActiveExperimentGlobalFilterKeys(markdown, globalControls),
    ).toEqual([]);
  });
});

describe("experimentBlockHasActiveGlobalFilters", () => {
  it("is true when the dashboard exposes a supported filter", () => {
    expect(
      experimentBlockHasActiveGlobalFilters(
        scaledImpactBlock(),
        globalControls,
      ),
    ).toBe(true);
  });

  it("is false when no supported filter is active", () => {
    expect(experimentBlockHasActiveGlobalFilters(scaledImpactBlock(), {})).toBe(
      false,
    );
  });
});

describe("experimentBlockFollowsGlobalFilters", () => {
  it("is true only when every active supported filter is opted in", () => {
    const block = scaledImpactBlock({
      globalControlSettings: {
        dateRange: true,
        experimentSearchString: true,
      },
    });
    expect(experimentBlockFollowsGlobalFilters(block, globalControls)).toBe(
      true,
    );
  });

  it("is false when any active supported filter is opted out", () => {
    const block = scaledImpactBlock({
      globalControlSettings: {
        dateRange: true,
        experimentSearchString: false,
      },
    });
    expect(experimentBlockFollowsGlobalFilters(block, globalControls)).toBe(
      false,
    );
  });

  it("ignores opt-in for filters the dashboard does not expose", () => {
    // Only the date range is active; the search opt-out is irrelevant.
    const block = scaledImpactBlock({
      globalControlSettings: { dateRange: true, experimentSearchString: false },
    });
    expect(
      experimentBlockFollowsGlobalFilters(block, {
        dateRange: { predefined: "last7Days" },
      }),
    ).toBe(true);
  });

  it("is false when the dashboard has no active filters", () => {
    expect(
      experimentBlockFollowsGlobalFilters(
        scaledImpactBlock({ globalControlSettings: { dateRange: true } }),
        {},
      ),
    ).toBe(false);
  });
});

describe("experimentBlockOptedOutOfGlobalFilters", () => {
  it("is true when active filters exist but the block does not follow them", () => {
    const block = scaledImpactBlock({
      globalControlSettings: { experimentSearchString: false },
    });
    expect(
      experimentBlockOptedOutOfGlobalFilters(block, {
        experimentSearchString: "tag:checkout",
      }),
    ).toBe(true);
  });

  it("is false when the block follows all active filters", () => {
    const block = scaledImpactBlock({
      globalControlSettings: {
        dateRange: true,
        experimentSearchString: true,
      },
    });
    expect(experimentBlockOptedOutOfGlobalFilters(block, globalControls)).toBe(
      false,
    );
  });

  it("is false when the dashboard exposes no supported filters", () => {
    expect(
      experimentBlockOptedOutOfGlobalFilters(scaledImpactBlock(), {}),
    ).toBe(false);
  });
});

describe("setExperimentBlockGlobalFilterFollowing", () => {
  it("opts in to every active supported filter", () => {
    const settings = setExperimentBlockGlobalFilterFollowing(
      scaledImpactBlock(),
      globalControls,
      true,
    );
    expect(settings).toEqual({
      dateRange: true,
      experimentSearchString: true,
    });
  });

  it("opts out of every active supported filter", () => {
    const settings = setExperimentBlockGlobalFilterFollowing(
      scaledImpactBlock({
        globalControlSettings: {
          dateRange: true,
          experimentSearchString: true,
        },
      }),
      globalControls,
      false,
    );
    expect(settings).toEqual({
      dateRange: false,
      experimentSearchString: false,
    });
  });

  it("only touches active filters and never adds date range to Experiments with Lift", () => {
    const settings = setExperimentBlockGlobalFilterFollowing(
      metricExperimentsBlock(),
      // Both are active on the dashboard, but this block supports only search.
      {
        experimentSearchString: "tag:checkout",
        dateRange: { predefined: "last7Days" },
      },
      true,
    );
    expect(settings).toEqual({ experimentSearchString: true });
  });
});

describe("getDefaultExperimentBlockGlobalControlSettings", () => {
  it("inherits every filter the block type supports", () => {
    expect(
      getDefaultExperimentBlockGlobalControlSettings(scaledImpactBlock()),
    ).toEqual({
      dateRange: true,
      experimentSearchString: true,
    });
  });

  it("omits filters the block type doesn't support", () => {
    // Experiments with Lift has its own phase date windows, so it never follows
    // the dashboard date range.
    expect(
      getDefaultExperimentBlockGlobalControlSettings(metricExperimentsBlock()),
    ).toEqual({
      experimentSearchString: true,
    });
  });

  it("does not depend on what the dashboard currently has set", () => {
    const settings =
      getDefaultExperimentBlockGlobalControlSettings(scaledImpactBlock());
    expect(settings.dateRange).toBe(true);
    expect(settings.experimentSearchString).toBe(true);
  });
});

describe("getActiveBlockGlobalFilterKeys", () => {
  it("lists only filters the block supports and the dashboard has set", () => {
    expect(
      getActiveBlockGlobalFilterKeys(scaledImpactBlock(), globalControls),
    ).toEqual(["dateRange", "experimentSearchString"]);
    // Experiments with Lift never follows the date range.
    expect(
      getActiveBlockGlobalFilterKeys(metricExperimentsBlock(), globalControls),
    ).toEqual(["experimentSearchString"]);
    expect(
      getActiveBlockGlobalFilterKeys(statusBlock(), globalControls),
    ).toEqual(["dateRange", "experimentSearchString"]);
  });

  it("drops filters the dashboard has no value for", () => {
    expect(
      getActiveBlockGlobalFilterKeys(scaledImpactBlock(), {
        dateRange: { predefined: "last7Days" },
        // An empty string is not an active filter.
        experimentSearchString: "",
      }),
    ).toEqual(["dateRange"]);
  });

  it("covers exploration blocks, which support the date range only", () => {
    const block = {
      type: "metric-exploration",
      title: "",
      description: "",
    } as AnyBlock;
    expect(getActiveBlockGlobalFilterKeys(block, globalControls)).toEqual([
      "dateRange",
    ]);
  });

  it("returns nothing when the dashboard has no filters", () => {
    expect(getActiveBlockGlobalFilterKeys(scaledImpactBlock(), {})).toEqual([]);
    expect(
      getActiveBlockGlobalFilterKeys(scaledImpactBlock(), undefined),
    ).toEqual([]);
  });
});

describe("getCustomBlockGlobalFilterKeys", () => {
  it("counts each opted-out filter once, whatever its value holds", () => {
    const block = scaledImpactBlock({
      globalControlSettings: {
        dateRange: true,
        // A multi-token search string still counts as one custom filter.
        experimentSearchString: false,
      },
      experimentSearchString: "tag:a tag:b owner:me",
    });
    expect(getCustomBlockGlobalFilterKeys(block, globalControls)).toEqual([
      "experimentSearchString",
    ]);
  });

  it("treats an undecided (undefined) flag as custom", () => {
    // Auto-enrollment fills these in on persist. Until then it isn't following.
    const block = scaledImpactBlock({ globalControlSettings: {} });
    expect(getCustomBlockGlobalFilterKeys(block, globalControls)).toEqual([
      "dateRange",
      "experimentSearchString",
    ]);
  });

  it("is empty for a block inheriting everything the dashboard sets", () => {
    const block = scaledImpactBlock({
      globalControlSettings:
        getDefaultExperimentBlockGlobalControlSettings(scaledImpactBlock()),
    });
    expect(getCustomBlockGlobalFilterKeys(block, globalControls)).toEqual([]);
  });

  it("ignores opted-out filters the dashboard has no value for", () => {
    const block = scaledImpactBlock({
      globalControlSettings: {
        experimentSearchString: false,
        dateRange: false,
      },
    });
    expect(
      getCustomBlockGlobalFilterKeys(block, {
        experimentSearchString: "tag:checkout",
      }),
    ).toEqual(["experimentSearchString"]);
  });
});

describe("withBlockGlobalFilterFollowing", () => {
  it("flips the given keys and leaves the rest of the block alone", () => {
    const block = scaledImpactBlock({
      globalControlSettings: { dateRange: true, experimentSearchString: true },
    });
    const next = withBlockGlobalFilterFollowing(
      block,
      ["experimentSearchString"],
      false,
    );
    expect(next.globalControlSettings).toEqual({
      dateRange: true,
      experimentSearchString: false,
    });
    expect(next.experimentSearchString).toEqual("status:stopped");
  });

  it("returns the same block when no keys are given", () => {
    // Editing an already-custom field passes an empty list, so no churn.
    const block = scaledImpactBlock({
      globalControlSettings: { dateRange: true },
    });
    expect(withBlockGlobalFilterFollowing(block, [], false)).toBe(block);
  });

  it("reverts every key at once, as Revert all does", () => {
    const block = scaledImpactBlock({
      globalControlSettings: {
        dateRange: false,
        experimentSearchString: false,
      },
    });
    const next = withBlockGlobalFilterFollowing(
      block,
      getActiveBlockGlobalFilterKeys(block, globalControls),
      true,
    );
    expect(getCustomBlockGlobalFilterKeys(next, globalControls)).toEqual([]);
  });

  it("preserves a value patch applied in the same update", () => {
    // The sidebar spreads the patch in before flipping the flag, so both land in
    // one setBlock.
    const block = scaledImpactBlock({
      globalControlSettings: { experimentSearchString: true },
    });
    const next = withBlockGlobalFilterFollowing(
      { ...block, experimentSearchString: "tag:picked" },
      ["experimentSearchString"],
      false,
    );
    expect(next.experimentSearchString).toEqual("tag:picked");
    expect(next.globalControlSettings).toEqual({
      experimentSearchString: false,
    });
  });
});
