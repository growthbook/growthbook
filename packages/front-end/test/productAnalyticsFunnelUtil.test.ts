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
  steps?: { factTable: string }[];
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
        overrides.steps ?? [{ factTable: "orders" }, { factTable: "orders" }]
      ).map((s, i) => ({
        name: `Step ${i + 1}`,
        factTable: s.factTable,
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
        factTable: "",
        rowFilters: [],
        optional: false,
      });
      expect(dataset.unit).toBeNull();
    });
  });

  describe("createEmptyFunnelStep", () => {
    it("prefills the fact-table id when one is supplied (inherited steps)", () => {
      expect(
        createEmptyFunnelStep({ name: "Step 2", factTable: "orders" }),
      ).toEqual({
        name: "Step 2",
        factTable: "orders",
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
            factTable: "orders",
            rowFilters: [],
            optional: false,
          },
          {
            name: "Step 2",
            factTable: "",
            rowFilters: [],
            optional: false,
          },
        ],
      };
      const cleaned = removeIncompleteInputs(dataset);
      if (cleaned.type !== "funnel") throw new Error("type narrowing");
      expect(cleaned.steps).toHaveLength(1);
      expect(cleaned.steps[0].factTable).toBe("orders");
    });
  });

  describe("isSubmittableConfig", () => {
    it("rejects funnels with fewer than 2 steps", () => {
      const config = makeFunnelConfig({ steps: [{ factTable: "orders" }] });
      expect(isSubmittableConfig(config, factTableById)).toBe(false);
    });

    it("rejects funnels with no unit", () => {
      const config = makeFunnelConfig({ unit: null });
      expect(isSubmittableConfig(config, factTableById)).toBe(false);
    });

    it("rejects funnels whose unit isn't a userIdType on every step's fact table", () => {
      const config = makeFunnelConfig({
        unit: "user_id",
        steps: [{ factTable: "orders" }, { factTable: "visits" }],
      });
      // visits doesn't expose user_id as a userIdType.
      expect(isSubmittableConfig(config, factTableById)).toBe(false);
    });

    it("accepts a well-formed two-step funnel", () => {
      const config = makeFunnelConfig({
        unit: "user_id",
        steps: [{ factTable: "orders" }, { factTable: "orders" }],
      });
      expect(isSubmittableConfig(config, factTableById)).toBe(true);
    });
  });

  describe("hasSubmittablePayload", () => {
    it("requires ≥2 steps for funnels", () => {
      const single = makeFunnelConfig({ steps: [{ factTable: "orders" }] });
      const pair = makeFunnelConfig({
        steps: [{ factTable: "orders" }, { factTable: "orders" }],
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
