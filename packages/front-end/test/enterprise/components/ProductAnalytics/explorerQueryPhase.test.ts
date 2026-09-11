import { describe, expect, it } from "vitest";
import type { ProductAnalyticsExploration } from "shared/validators";
import type { ExplorerDraftConfig } from "@/enterprise/components/ProductAnalytics/util";
import {
  getExplorerFloatingCallout,
  getExplorerQueryPhase,
  getQueryTimeoutErrorMessage,
  resolveExplorerQueryErrorKind,
  type ExplorerQueryErrorKind,
} from "@/enterprise/components/ProductAnalytics/explorerQueryPhase";

const submitted: ExplorerDraftConfig = {
  type: "fact_table",
  datasource: "ds_1",
  chartType: "bar",
  dimensions: [],
  dateRange: { predefined: "last7Days" },
  dataset: {
    type: "fact_table",
    factTableId: "ft_1",
    values: [
      {
        type: "fact_table",
        name: "value",
        rowFilters: [],
        valueType: "count",
        valueColumn: null,
        unit: null,
      },
    ],
  },
};

const settled = {
  loading: false,
  isStale: false,
  needsFetch: false,
  needsUpdate: false,
  error: null as string | null,
  errorKind: null as ExplorerQueryErrorKind | null,
  submittedExploreState: submitted,
};

describe("getQueryTimeoutErrorMessage", () => {
  it("mentions fewer steps only for funnels", () => {
    expect(getQueryTimeoutErrorMessage(true)).toContain("or fewer steps");
    expect(getQueryTimeoutErrorMessage(false)).not.toContain("or fewer steps");
  });
});

describe("resolveExplorerQueryErrorKind", () => {
  it("records an explicit timeout even when there is no exploration", () => {
    expect(
      resolveExplorerQueryErrorKind({
        result: null,
        resultError: getQueryTimeoutErrorMessage(false),
        timeout: true,
      }),
    ).toBe("timeout");
  });

  it("treats a warehouse error exploration as a query failure", () => {
    const result = {
      status: "error",
      error: "permission denied",
    } as ProductAnalyticsExploration;
    expect(resolveExplorerQueryErrorKind({ result, resultError: null })).toBe(
      "query",
    );
  });

  it("treats a fetch error string as a query failure", () => {
    expect(
      resolveExplorerQueryErrorKind({
        result: null,
        resultError: "connection reset",
      }),
    ).toBe("query");
  });

  it("returns null on success", () => {
    const result = { status: "success" } as ProductAnalyticsExploration;
    expect(resolveExplorerQueryErrorKind({ result, resultError: null })).toBe(
      null,
    );
  });
});

describe("getExplorerQueryPhase", () => {
  it("prefers loading over a leftover error", () => {
    expect(
      getExplorerQueryPhase({
        ...settled,
        loading: true,
        errorKind: "timeout",
        error: getQueryTimeoutErrorMessage(false),
      }),
    ).toEqual({ type: "loading" });
  });

  it("is idle until a submittable config has been submitted", () => {
    expect(
      getExplorerQueryPhase({
        ...settled,
        submittedExploreState: null,
      }),
    ).toEqual({ type: "idle" });
  });

  it("surfaces the last timeout while the draft still matches submitted", () => {
    expect(
      getExplorerQueryPhase({
        ...settled,
        errorKind: "timeout",
        error: getQueryTimeoutErrorMessage(false),
      }),
    ).toEqual({
      type: "error",
      kind: "timeout",
      message: getQueryTimeoutErrorMessage(false),
    });
  });

  it("surfaces a warehouse failure without matching error copy", () => {
    expect(
      getExplorerQueryPhase({
        ...settled,
        errorKind: "query",
        error: "permission denied",
      }),
    ).toEqual({
      type: "error",
      kind: "query",
      message: "permission denied",
    });
  });

  it("treats a required-cache miss after a failed submit as stale, not a new failure", () => {
    expect(
      getExplorerQueryPhase({
        ...settled,
        isStale: true,
        needsFetch: true,
        errorKind: "timeout",
        error: getQueryTimeoutErrorMessage(false),
      }),
    ).toEqual({ type: "stale" });
  });

  it("restores the failed outcome when the draft is dialed back to submitted", () => {
    expect(
      getExplorerQueryPhase({
        ...settled,
        errorKind: "timeout",
        error: getQueryTimeoutErrorMessage(false),
      }).type,
    ).toBe("error");
  });

  it("is stale when the draft needs a fetch and the last run succeeded", () => {
    expect(
      getExplorerQueryPhase({
        ...settled,
        isStale: true,
        needsFetch: true,
      }),
    ).toEqual({ type: "stale" });
  });

  it("is success when the last run applies and did not fail", () => {
    expect(getExplorerQueryPhase(settled)).toEqual({ type: "success" });
  });
});

describe("getExplorerFloatingCallout", () => {
  it("returns null for idle and success", () => {
    expect(getExplorerFloatingCallout({ type: "idle" })).toBe(null);
    expect(getExplorerFloatingCallout({ type: "success" })).toBe(null);
  });

  it("maps loading, stale, timeout, and query failure onto one banner model", () => {
    expect(getExplorerFloatingCallout({ type: "loading" })).toEqual({
      status: "info",
      text: "Loading...",
      action: null,
    });
    expect(getExplorerFloatingCallout({ type: "stale" })).toMatchObject({
      status: "info",
      text: "Latest changes not applied",
      action: "refresh",
    });
    expect(
      getExplorerFloatingCallout({
        type: "error",
        kind: "timeout",
        message: "ignored",
      }),
    ).toEqual({
      status: "error",
      text: "Query timed out",
      action: "retry",
    });
    expect(
      getExplorerFloatingCallout({
        type: "error",
        kind: "query",
        message: "ignored",
      }),
    ).toEqual({
      status: "error",
      text: "Query failed",
      action: "retry",
    });
  });
});
