/// <reference types="jest" />

import {
  getEffectiveExperimentBlock,
  blockUsesGlobalFilter,
  autoEnrollDashboardBlocksInGlobalFilter,
  getDashboardExperimentFilterApplicability,
  resolveGlobalControlsBlockEnrollment,
  isEnablingGlobalFilter,
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
