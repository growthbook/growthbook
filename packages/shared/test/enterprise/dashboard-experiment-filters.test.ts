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
  metricId: "met_dashboard",
  experimentSearchString: "tag:checkout",
};

describe("getEffectiveExperimentBlock", () => {
  it("overrides only the filters the block has opted into", () => {
    const block = scaledImpactBlock({
      globalControlSettings: { metricId: true, dateRange: false },
    });
    const effective = getEffectiveExperimentBlock(block, { globalControls });
    // Opted into metric -> overridden
    expect(effective.metricId).toEqual("met_dashboard");
    // Opted out of date -> keeps its own
    expect(effective.dateRange).toEqual({ predefined: "last90Days" });
    // Not decided on projects/search -> keeps its own
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
        metricId: true,
      },
    });
    const effective = getEffectiveExperimentBlock(block, { globalControls });
    expect("dateRange" in effective).toBe(false);
    expect(effective.metricId).toEqual("met_dashboard");
  });

  it("ignores inactive (empty) global filters", () => {
    const block = scaledImpactBlock({
      globalControlSettings: { projects: true },
    });
    const effective = getEffectiveExperimentBlock(block, {
      globalControls: { projects: [] },
    });
    expect(effective.projects).toEqual(["prj_block"]);
  });
});

describe("blockUsesGlobalFilter", () => {
  it("is true only when supported and opted in", () => {
    expect(
      blockUsesGlobalFilter(
        scaledImpactBlock({ globalControlSettings: { metricId: true } }),
        "metricId",
      ),
    ).toBe(true);
    // Win-rate-style block does not support metric; scaled impact does. Metric
    // Experiments never supports date.
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
      scaledImpactBlock({ globalControlSettings: { metricId: false } }), // opted out -> keep
      metricExperimentsBlock(), // does not support date -> unchanged
    ];
    const next = autoEnrollDashboardBlocksInGlobalFilter(blocks, "dateRange");
    expect(next[0].globalControlSettings?.dateRange).toBe(true);
    // metricId opt-out preserved; dateRange freshly enrolled
    expect(next[1].globalControlSettings?.dateRange).toBe(true);
    expect(next[1].globalControlSettings?.metricId).toBe(false);
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
    // Team Velocity has no metric
    expect(applicability.showMetric).toBe(false);
    expect(applicability.hasDateExcludedBlock).toBe(false);
  });

  it("flags the date-excluded block and metric support for Experiments with Lift", () => {
    const applicability = getDashboardExperimentFilterApplicability([
      metricExperimentsBlock(),
    ]);
    expect(applicability.showMetric).toBe(true);
    expect(applicability.showDateRange).toBe(false);
    expect(applicability.hasDateExcludedBlock).toBe(true);
  });
});

describe("resolveGlobalControlsBlockEnrollment", () => {
  it("enrolls supported blocks for each newly enabled filter", () => {
    const enrolled = resolveGlobalControlsBlockEnrollment({
      existingGlobalControls: {},
      nextGlobalControls: { metricId: "met_dashboard" },
      nextBlocks: [scaledImpactBlock(), statusBlock()],
    });
    // Scaled impact supports metric -> enrolled; status does not -> untouched
    expect(enrolled?.[0].globalControlSettings?.metricId).toBe(true);
    expect(enrolled?.[1].globalControlSettings?.metricId).toEqual(undefined);
  });

  it("does nothing when no filter is newly enabled", () => {
    expect(
      isEnablingGlobalFilter({ metricId: "a" }, { metricId: "b" }, "metricId"),
    ).toBe(false);
  });
});

describe("getActiveExperimentGlobalFilterKeys", () => {
  it("returns only supported filters that are active on the dashboard", () => {
    // Scaled impact supports all four; only projects/metric are active here.
    expect(
      getActiveExperimentGlobalFilterKeys(scaledImpactBlock(), {
        projects: ["prj_dashboard"],
        metricId: "met_dashboard",
      }),
    ).toEqual(["projects", "metricId"]);
  });

  it("excludes date range for Experiments with Lift", () => {
    expect(
      getActiveExperimentGlobalFilterKeys(
        metricExperimentsBlock(),
        globalControls,
      ),
    ).toEqual(["projects", "metricId", "experimentSearchString"]);
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
        metricId: true,
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
        metricId: false,
        experimentSearchString: true,
      },
    });
    expect(experimentBlockFollowsGlobalFilters(block, globalControls)).toBe(
      false,
    );
  });

  it("ignores opt-in for filters the dashboard does not expose", () => {
    // Only projects is active; metric opt-in is irrelevant.
    const block = scaledImpactBlock({
      globalControlSettings: { projects: true, metricId: false },
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
        metricId: true,
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
      metricId: true,
      experimentSearchString: true,
    });
  });

  it("opts out of every active supported filter", () => {
    const settings = setExperimentBlockGlobalFilterFollowing(
      scaledImpactBlock({
        globalControlSettings: {
          dateRange: true,
          projects: true,
          metricId: true,
          experimentSearchString: true,
        },
      }),
      globalControls,
      false,
    );
    expect(settings).toEqual({
      dateRange: false,
      projects: false,
      metricId: false,
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
