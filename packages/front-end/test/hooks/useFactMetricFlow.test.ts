import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactMetricInterface } from "shared/types/fact-table";
import useFactMetricFlow from "@/hooks/useFactMetricFlow";
import { getDefaultFactMetricProps } from "@/services/metrics";

const state = vi.hoisted(() => ({
  newFlow: false,
  premium: false,
  ready: true,
  project: "project-a",
  projects: [],
  factTables: [] as { id: string; datasource: string; projects: string[] }[],
  router: { asPath: "/metrics", push: vi.fn() },
}));
vi.mock("next/router", () => ({ useRouter: () => state.router }));
vi.mock("@growthbook/growthbook-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@growthbook/growthbook-react")>()),
  useFeatureIsOn: () => state.newFlow,
}));
vi.mock("@/services/UserContext", () => ({
  useUser: () => ({ hasCommercialFeature: () => state.premium }),
}));
vi.mock("@/components/Settings/UpgradeModal", () => ({ default: () => null }));
vi.mock("@/services/DefinitionsContext", () => ({
  useDefinitions: () => state,
}));
vi.mock("@/hooks/usePermissionsUtils", () => ({
  default: () => ({
    canCreateOfficialResources: () => false,
    canCreateFactMetric: () => true,
    canViewCreateFactTableModal: () => true,
  }),
}));
vi.mock("@/services/env", () => ({ envAllowsCreatingMetrics: () => true }));
vi.mock("@/components/FactTables/FactTableModal", () => ({
  default: () => null,
}));
vi.mock("@/components/FactTables/FactMetricModal", () => ({
  default: () => null,
}));

const metric: FactMetricInterface = {
  ...getDefaultFactMetricProps({
    datasources: [],
    settings: {},
    metricDefaults: {},
  }),
  metricType: "mean",
  funnelSettings: null,
  id: "fact__revenue",
  organization: "org_1",
  dateCreated: new Date("2026-01-01"),
  dateUpdated: new Date("2026-01-01"),
};

beforeEach(() => {
  state.newFlow = false;
  state.premium = false;
  state.factTables = [];
  state.ready = true;
  state.router.push.mockReset();
});
afterEach(cleanup);

describe("useFactMetricFlow", () => {
  it("sends the user to Fact Tables without a project-visible Fact Table", () => {
    state.factTables = [
      { id: "ft_b", datasource: "ds", projects: ["project-b"] },
    ];
    const { result } = renderHook(() => useFactMetricFlow("test"));
    expect(result.current.creation().mode).toBe("fact-table");
    act(() => {
      result.current.open();
    });
    expect(result.current.modal).toBeNull();
    expect(state.router.push).toHaveBeenCalledWith("/fact-tables");
  });

  it.each([
    { factTable: "ft_b" },
    {
      duplicate: {
        ...metric,
        numerator: { ...metric.numerator, factTableId: "ft_b" },
      },
    },
  ])(
    "opens the old modal for a target outside the selected Project: %o",
    (target) => {
      state.factTables = [
        { id: "ft_b", datasource: "ds", projects: ["project-b"] },
      ];
      const { result } = renderHook(() => useFactMetricFlow("test"));
      expect(result.current.creation().mode).toBe("fact-table");
      expect(result.current.creation(target).mode).toBe("modal");
      act(() => {
        result.current.open(target);
      });
      expect(result.current.modal?.props.duplicate).toBe(!!target.duplicate);
    },
  );

  it.each([false, true])(
    "preserves a direct edit URL's tracking source with newFlow=%s",
    (newFlow) => {
      state.newFlow = newFlow;
      const { result } = renderHook(() => useFactMetricFlow("fact-metric"));
      act(() => {
        result.current.edit(metric, "metrics-list");
      });
      if (newFlow) {
        expect(state.router.push).toHaveBeenCalledWith(
          `/fact-metrics/${metric.id}?edit=true&source=metrics-list`,
        );
      } else {
        expect(result.current.modal?.props.source).toBe("metrics-list");
      }
    },
  );

  it.each(["quantile", "retention", "funnel"] as const)(
    "gates %s duplication in the old modal before allowing edits",
    (metricType) => {
      state.factTables = [{ id: "ft_1", datasource: "ds", projects: [] }];
      const source: FactMetricInterface =
        metricType === "funnel"
          ? {
              ...metric,
              metricType,
              numerator: null,
              funnelSettings: {
                steps: [{ factTableId: "ft_1" }],
              } as NonNullable<FactMetricInterface["funnelSettings"]>,
            }
          : {
              ...metric,
              metricType,
              numerator: { ...metric.numerator, factTableId: "ft_1" },
            };
      const { result, rerender } = renderHook(() => useFactMetricFlow("test"));
      act(() => {
        result.current.open({ duplicate: source });
      });
      expect(result.current.modal?.props.commercialFeature).toBe(
        `${metricType}-metrics`,
      );
      state.premium = true;
      rerender();
      expect(result.current.modal?.props.existing.metricType).toBe(metricType);
    },
  );

  it("does not wait for the flag to load before opening", () => {
    state.factTables = [{ id: "ft_1", datasource: "ds", projects: [] }];
    const { result } = renderHook(() => useFactMetricFlow("test"));
    expect(result.current.creation().disabledReason).toBeNull();
    expect(result.current.editDisabledReason).toBeNull();
  });

  it("preserves creation context and edit tracking source when navigating", () => {
    state.newFlow = true;
    const { result } = renderHook(() => useFactMetricFlow("metrics-list"));
    act(() => {
      result.current.open({
        factTable: "ft_1",
        datasource: "ds_1",
        duplicate: metric,
      });
    });
    const url = new URL(
      state.router.push.mock.calls[0][0],
      "https://example.com",
    );
    expect(url.pathname).toBe("/fact-metrics/new");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      returnUrl: "/metrics",
      source: "metrics-list-duplicate",
      factTable: "ft_1",
      datasource: "ds_1",
      duplicate: metric.id,
    });
    act(() => {
      result.current.edit(metric);
    });
    expect(state.router.push).toHaveBeenLastCalledWith(
      `/fact-metrics/${metric.id}?edit=true&source=metrics-list`,
    );
    expect(result.current.modal).toBeNull();
  });

  it("opens creation and edit modals in the old flow", () => {
    state.factTables = [{ id: "ft_1", datasource: "ds", projects: [] }];
    const { result } = renderHook(() => useFactMetricFlow("test"));
    act(() => {
      result.current.open();
    });
    expect(result.current.modal).not.toBeNull();
    act(() => {
      result.current.edit(metric);
    });
    expect(result.current.modal).not.toBeNull();
    expect(state.router.push).not.toHaveBeenCalled();
  });
});
