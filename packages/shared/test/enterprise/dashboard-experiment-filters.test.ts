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

const globalControls = {
  dateRange: { predefined: "last7Days" as const },
  dateGranularity: "day" as const,
  projects: ["prj_dashboard"],
  experimentSearchString: "tag:checkout",
};

describe("getEffectiveExperimentBlock", () => {
  it("overrides only the filters the block has opted into", () => {
    const block = scaledImpactBlock({
      globalControlSettings: { projects: true, dateRange: false },
    });
    const effective = getEffectiveExperimentBlock(block, { globalControls });
    // Opted into projects -> overridden
    expect(effective.projects).toEqual(["prj_dashboard"]);
    // Opted out of date -> keeps its own
    expect(effective.dateRange).toEqual({ predefined: "last90Days" });
    // Not decided on search -> keeps its own
    expect(effective.experimentSearchString).toEqual("status:stopped");
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
    expect(effective.experimentSearchString).toEqual("tag:checkout");
  });

  it("applies an empty (all-projects) global filter to opted-in blocks", () => {
    // An explicit empty projects array means "All projects" and must widen an
    // opted-in block instead of leaving its narrower local scope in place.
    const block = scaledImpactBlock({
      globalControlSettings: { projects: true },
    });
    const effective = getEffectiveExperimentBlock(block, {
      globalControls: { projects: [] },
    });
    expect(effective.projects).toEqual([]);
  });

  it("ignores an absent (unset) projects filter", () => {
    const block = scaledImpactBlock({
      globalControlSettings: { projects: true },
    });
    const effective = getEffectiveExperimentBlock(block, {
      globalControls: {},
    });
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
      scaledImpactBlock({ globalControlSettings: { projects: false } }), // opted out -> keep
      metricExperimentsBlock(), // does not support date -> unchanged
    ];
    const next = autoEnrollDashboardBlocksInGlobalFilter(blocks, "dateRange");
    expect(next[0].globalControlSettings?.dateRange).toBe(true);
    // projects opt-out preserved; dateRange freshly enrolled
    expect(next[1].globalControlSettings?.dateRange).toBe(true);
    expect(next[1].globalControlSettings?.projects).toBe(false);
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
    expect(applicability.showProjects).toBe(true);
    expect(applicability.showExperimentSearch).toBe(true);
    expect(applicability.hasDateExcludedBlock).toBe(false);
  });

  it("flags the date-excluded block for Experiments with Lift", () => {
    const applicability = getDashboardExperimentFilterApplicability([
      metricExperimentsBlock(),
    ]);
    expect(applicability.showProjects).toBe(true);
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
    // Scaled impact supports all three; only projects is active here.
    expect(
      getActiveExperimentGlobalFilterKeys(scaledImpactBlock(), {
        projects: ["prj_dashboard"],
      }),
    ).toEqual(["projects"]);
  });

  it("excludes date range for Experiments with Lift", () => {
    expect(
      getActiveExperimentGlobalFilterKeys(
        metricExperimentsBlock(),
        globalControls,
      ),
    ).toEqual(["projects", "experimentSearchString"]);
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
        projects: true,
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
        projects: true,
        experimentSearchString: false,
      },
    });
    expect(experimentBlockFollowsGlobalFilters(block, globalControls)).toBe(
      false,
    );
  });

  it("ignores opt-in for filters the dashboard does not expose", () => {
    // Only projects is active; the search opt-out is irrelevant.
    const block = scaledImpactBlock({
      globalControlSettings: { projects: true, experimentSearchString: false },
    });
    expect(
      experimentBlockFollowsGlobalFilters(block, {
        projects: ["prj_dashboard"],
      }),
    ).toBe(true);
  });

  it("is false when the dashboard has no active filters", () => {
    expect(
      experimentBlockFollowsGlobalFilters(
        scaledImpactBlock({ globalControlSettings: { projects: true } }),
        {},
      ),
    ).toBe(false);
  });
});

describe("experimentBlockOptedOutOfGlobalFilters", () => {
  it("is true when active filters exist but the block does not follow them", () => {
    const block = scaledImpactBlock({
      globalControlSettings: { projects: false },
    });
    expect(
      experimentBlockOptedOutOfGlobalFilters(block, {
        projects: ["prj_dashboard"],
      }),
    ).toBe(true);
  });

  it("is false when the block follows all active filters", () => {
    const block = scaledImpactBlock({
      globalControlSettings: {
        dateRange: true,
        projects: true,
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
      projects: true,
      experimentSearchString: true,
    });
  });

  it("opts out of every active supported filter", () => {
    const settings = setExperimentBlockGlobalFilterFollowing(
      scaledImpactBlock({
        globalControlSettings: {
          dateRange: true,
          projects: true,
          experimentSearchString: true,
        },
      }),
      globalControls,
      false,
    );
    expect(settings).toEqual({
      dateRange: false,
      projects: false,
      experimentSearchString: false,
    });
  });

  it("only touches active filters and never adds date range to Experiments with Lift", () => {
    const settings = setExperimentBlockGlobalFilterFollowing(
      metricExperimentsBlock(),
      // Only projects is active on the dashboard.
      { projects: ["prj_dashboard"], dateRange: { predefined: "last7Days" } },
      true,
    );
    expect(settings).toEqual({ projects: true });
  });
});

describe("getDefaultExperimentBlockGlobalControlSettings", () => {
  it("inherits every filter the block type supports", () => {
    expect(
      getDefaultExperimentBlockGlobalControlSettings(scaledImpactBlock()),
    ).toEqual({
      dateRange: true,
      projects: true,
      experimentSearchString: true,
    });
  });

  it("omits filters the block type doesn't support", () => {
    // Experiments with Lift has its own phase date windows, so it never follows
    // the dashboard date range.
    expect(
      getDefaultExperimentBlockGlobalControlSettings(metricExperimentsBlock()),
    ).toEqual({
      projects: true,
      experimentSearchString: true,
    });
  });

  it("does not depend on what the dashboard currently has set", () => {
    const settings =
      getDefaultExperimentBlockGlobalControlSettings(scaledImpactBlock());
    expect(settings.projects).toBe(true);
    expect(settings.experimentSearchString).toBe(true);
  });
});

describe("getActiveBlockGlobalFilterKeys", () => {
  it("lists only filters the block supports and the dashboard has set", () => {
    expect(
      getActiveBlockGlobalFilterKeys(scaledImpactBlock(), globalControls),
    ).toEqual(["dateRange", "projects", "experimentSearchString"]);
    // Experiments with Lift never follows the date range.
    expect(
      getActiveBlockGlobalFilterKeys(metricExperimentsBlock(), globalControls),
    ).toEqual(["projects", "experimentSearchString"]);
    expect(
      getActiveBlockGlobalFilterKeys(statusBlock(), globalControls),
    ).toEqual(["dateRange", "projects", "experimentSearchString"]);
  });

  it("drops filters the dashboard has no value for", () => {
    expect(
      getActiveBlockGlobalFilterKeys(scaledImpactBlock(), {
        projects: ["prj_dashboard"],
        // An empty string is not an active filter.
        experimentSearchString: "",
      }),
    ).toEqual(["projects"]);
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
        // Three project chips still count as one custom filter.
        projects: false,
        experimentSearchString: false,
      },
      projects: ["prj_a", "prj_b", "prj_c"],
    });
    expect(getCustomBlockGlobalFilterKeys(block, globalControls)).toEqual([
      "projects",
      "experimentSearchString",
    ]);
  });

  it("treats an undecided (undefined) flag as custom", () => {
    // Auto-enrollment fills these in on persist. Until then it isn't following.
    const block = scaledImpactBlock({ globalControlSettings: {} });
    expect(getCustomBlockGlobalFilterKeys(block, globalControls)).toEqual([
      "dateRange",
      "projects",
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
      globalControlSettings: { experimentSearchString: false, projects: false },
    });
    expect(
      getCustomBlockGlobalFilterKeys(block, { projects: ["prj_dashboard"] }),
    ).toEqual(["projects"]);
  });
});

describe("withBlockGlobalFilterFollowing", () => {
  it("flips the given keys and leaves the rest of the block alone", () => {
    const block = scaledImpactBlock({
      globalControlSettings: { dateRange: true, projects: true },
    });
    const next = withBlockGlobalFilterFollowing(block, ["projects"], false);
    expect(next.globalControlSettings).toEqual({
      dateRange: true,
      projects: false,
    });
    expect(next.projects).toEqual(["prj_block"]);
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
        projects: false,
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
      globalControlSettings: { projects: true },
    });
    const next = withBlockGlobalFilterFollowing(
      { ...block, projects: ["prj_picked"] },
      ["projects"],
      false,
    );
    expect(next.projects).toEqual(["prj_picked"]);
    expect(next.globalControlSettings).toEqual({ projects: false });
  });
});
