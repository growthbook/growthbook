import { describe, it, expect } from "vitest";
import type { ExplorationConfig } from "shared/validators";
import type { FactTableInterface } from "shared/types/fact-table";
import {
  createEmptyDataset,
  createEmptyFunnelStep,
  isSubmittableConfig,
  removeIncompleteInputs,
  hasSubmittablePayload,
  formatDurationMs,
  explorationPollDelayMs,
  fromStartRate,
  fromPrevRate,
  stepChange,
} from "@/enterprise/components/ProductAnalytics/util";

function makeFactTable(
  id: string,
  userIdTypes: string[] = ["user_id"],
): FactTableInterface {
  return {
    id,
    organization: "org_1",
    name: id,
    datasource: "ds_1",
    sql: `SELECT * FROM ${id}`,
    userIdTypes,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    description: "",
    eventName: "",
    owner: "",
    projects: [],
    tags: [],
    filters: [],
    columns: [
      {
        column: "user_id",
        datatype: "string",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        name: "user_id",
        description: "",
        numberFormat: "",
        alwaysInlineFilter: false,
        deleted: false,
        autoSlices: [],
        isAutoSliceColumn: false,
      },
      {
        column: "timestamp",
        datatype: "date",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        name: "timestamp",
        description: "",
        numberFormat: "",
        alwaysInlineFilter: false,
        deleted: false,
        autoSlices: [],
        isAutoSliceColumn: false,
      },
    ],
  } as FactTableInterface;
}

const ordersFt = makeFactTable("orders");
const visitsFt = makeFactTable("visits", ["anonymous_id"]);
const factTableById = (id: string): FactTableInterface | null => {
  if (id === "orders") return ordersFt;
  if (id === "visits") return visitsFt;
  return null;
};

function makeFunnelConfig(overrides: {
  unit?: string | null;
  steps?: { factTableId: string }[];
}): ExplorationConfig {
  return {
    type: "funnel",
    datasource: "ds_1",
    chartType: "bar",
    dimensions: [],
    dateRange: {
      predefined: "last7Days",
      startDate: null,
      endDate: null,
      lookbackValue: null,
      lookbackUnit: null,
    },
    dataset: {
      type: "funnel",
      // Use `in` rather than `??` so a caller-provided `null` survives the
      // default — `null ?? default` would replace it.
      unit: "unit" in overrides ? (overrides.unit ?? null) : "user_id",
      steps: (
        overrides.steps ?? [
          { factTableId: "orders" },
          { factTableId: "orders" },
        ]
      ).map((s, i) => ({
        name: `Step ${i + 1}`,
        factTableId: s.factTableId,
        rowFilters: [],
        optional: false,
      })),
    },
  } as ExplorationConfig;
}

describe("ProductAnalytics util — funnel branches", () => {
  describe("createEmptyDataset", () => {
    it("seeds a single empty step for new funnels", () => {
      const dataset = createEmptyDataset("funnel");
      if (dataset.type !== "funnel") throw new Error("type narrowing");
      expect(dataset.steps).toHaveLength(1);
      expect(dataset.steps[0]).toEqual({
        name: "Step 1",
        factTableId: "",
        rowFilters: [],
        optional: false,
      });
      expect(dataset.unit).toBeNull();
    });
  });

  describe("createEmptyFunnelStep", () => {
    it("prefills the fact-table id when one is supplied (inherited steps)", () => {
      expect(
        createEmptyFunnelStep({ name: "Step 2", factTableId: "orders" }),
      ).toEqual({
        name: "Step 2",
        factTableId: "orders",
        rowFilters: [],
        optional: false,
      });
    });
  });

  describe("removeIncompleteInputs", () => {
    it("drops funnel steps that haven't picked a fact table", () => {
      const dataset = {
        type: "funnel" as const,
        unit: "user_id",
        steps: [
          {
            name: "Step 1",
            factTableId: "orders",
            rowFilters: [],
            optional: false,
          },
          {
            name: "Step 2",
            factTableId: "",
            rowFilters: [],
            optional: false,
          },
        ],
      };
      const cleaned = removeIncompleteInputs(dataset);
      if (cleaned.type !== "funnel") throw new Error("type narrowing");
      expect(cleaned.steps).toHaveLength(1);
      expect(cleaned.steps[0].factTableId).toBe("orders");
    });
  });

  describe("isSubmittableConfig", () => {
    it("rejects funnels with fewer than 2 steps", () => {
      const config = makeFunnelConfig({ steps: [{ factTableId: "orders" }] });
      expect(isSubmittableConfig(config, factTableById)).toBe(false);
    });

    it("rejects funnels with no unit", () => {
      const config = makeFunnelConfig({ unit: null });
      expect(isSubmittableConfig(config, factTableById)).toBe(false);
    });

    it("rejects funnels whose unit isn't a userIdType on every step's fact table", () => {
      const config = makeFunnelConfig({
        unit: "user_id",
        steps: [{ factTableId: "orders" }, { factTableId: "visits" }],
      });
      // visits doesn't expose user_id as a userIdType.
      expect(isSubmittableConfig(config, factTableById)).toBe(false);
    });

    it("accepts a well-formed two-step funnel", () => {
      const config = makeFunnelConfig({
        unit: "user_id",
        steps: [{ factTableId: "orders" }, { factTableId: "orders" }],
      });
      expect(isSubmittableConfig(config, factTableById)).toBe(true);
    });
  });

  describe("hasSubmittablePayload", () => {
    it("requires ≥2 steps for funnels", () => {
      const single = makeFunnelConfig({ steps: [{ factTableId: "orders" }] });
      const pair = makeFunnelConfig({
        steps: [{ factTableId: "orders" }, { factTableId: "orders" }],
      });
      expect(hasSubmittablePayload(single)).toBe(false);
      expect(hasSubmittablePayload(pair)).toBe(true);
    });
  });

  describe("formatDurationMs", () => {
    it("formats sub-minute durations as seconds", () => {
      expect(formatDurationMs(42_000)).toBe("42s");
    });
    it("formats minute-scale durations as 'Nm Ss'", () => {
      expect(formatDurationMs(83_000)).toBe("1m 23s");
    });
    it("formats hour-scale durations as 'Nh Mm'", () => {
      expect(formatDurationMs(3_900_000)).toBe("1h 5m");
    });
    it("returns em-dash for nullish input", () => {
      expect(formatDurationMs(null)).toBe("—");
      expect(formatDurationMs(undefined)).toBe("—");
    });
  });

  describe("explorationPollDelayMs", () => {
    it("backs off as elapsed time grows", () => {
      expect(explorationPollDelayMs(0)).toBe(2000);
      expect(explorationPollDelayMs(9)).toBe(2000);
      expect(explorationPollDelayMs(10)).toBe(3000);
      expect(explorationPollDelayMs(29)).toBe(3000);
      expect(explorationPollDelayMs(30)).toBe(5000);
      expect(explorationPollDelayMs(59)).toBe(5000);
      expect(explorationPollDelayMs(60)).toBe(10000);
      expect(explorationPollDelayMs(299)).toBe(10000);
      expect(explorationPollDelayMs(300)).toBe(20000);
      expect(explorationPollDelayMs(599)).toBe(20000);
    });
    it("returns 0 (stop polling) after ~10 minutes", () => {
      expect(explorationPollDelayMs(600)).toBe(0);
      expect(explorationPollDelayMs(100000)).toBe(0);
    });
  });
});

describe("funnel compare helpers", () => {
  const cur = { counts: [200, 50, 20] };
  const prev = { counts: [160, 48, 8] };

  it("fromStartRate divides by step 1 and is null when step 1 is empty", () => {
    expect(fromStartRate(cur, 1)).toBe(0.25);
    expect(fromStartRate({ counts: [0, 0] }, 1)).toBeNull();
    expect(fromStartRate(undefined, 1)).toBeNull();
  });

  it("fromPrevRate divides by the previous step and is null on step 1", () => {
    expect(fromPrevRate(cur, 2)).toBe(0.4);
    expect(fromPrevRate(cur, 0)).toBeNull();
    expect(fromPrevRate({ counts: [10, 0, 0] }, 2)).toBeNull();
  });

  it("stepChange is the % change in users on step 1", () => {
    expect(stepChange(cur, prev, 0)).toBe(25);
    expect(stepChange(cur, { counts: [0, 0, 0] }, 0)).toBeNull();
  });

  it("stepChange is the change in from-start conversion in pts on later steps", () => {
    // 25% now vs 30% before
    expect(stepChange(cur, prev, 1)).toBe(-5);
    // 10% now vs 5% before
    expect(stepChange(cur, prev, 2)).toBe(5);
    expect(stepChange(cur, undefined, 1)).toBeNull();
  });

  it("stepChange rounds to 1 decimal and never returns -0", () => {
    expect(stepChange({ counts: [3, 1] }, { counts: [3, 1] }, 1)).toBe(0);
    expect(
      Object.is(
        stepChange({ counts: [1000, 333] }, { counts: [1000, 333.4] }, 1),
        0,
      ),
    ).toBe(true);
  });
});
