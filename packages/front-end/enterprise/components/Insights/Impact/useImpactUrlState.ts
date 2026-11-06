import { useCallback, useMemo } from "react";
import { useRouter } from "next/router";
import {
  ExplorationDateRange,
  dateRangePredefined,
  lookbackUnit,
} from "shared/validators";

const DEFAULT_RANGE: ExplorationDateRange["predefined"] = "last90Days";

function oneOf<T extends string>(
  options: readonly T[],
  value: unknown,
): T | null {
  return options.includes(value as T) ? (value as T) : null;
}

function readString(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value ? value : null;
}

// Pins All Projects in a link, so the viewer's sidebar Project doesn't apply
const ALL_PROJECTS_PARAM = "all";

// Page state lives in the URL, so a copied link reproduces the view
export function useImpactUrlState() {
  const router = useRouter();
  const { query } = router;

  const metricId = readString(query.metric) ?? "";
  const projectParam = readString(query.project);
  // Null follows the sidebar's Project
  const project = projectParam === ALL_PROJECTS_PARAM ? "" : projectParam;
  const debias = query.debias !== "0";
  const dateRange = useMemo<ExplorationDateRange>(() => {
    const lookback = Number(readString(query.lookback));
    return {
      predefined: oneOf(dateRangePredefined, query.range) ?? DEFAULT_RANGE,
      startDate: readString(query.start),
      endDate: readString(query.end),
      lookbackValue:
        Number.isFinite(lookback) && lookback > 0 ? lookback : null,
      lookbackUnit: oneOf(lookbackUnit, query.unit),
    };
  }, [query.range, query.start, query.end, query.lookback, query.unit]);

  const update = useCallback(
    (changes: Record<string, string | number | null | undefined>) => {
      // Read the live URL: the search box writes `q` outside this hook
      const params = new URLSearchParams(window.location.search);
      Object.entries(changes).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      });
      const search = params.toString();
      router.replace(
        router.pathname + (search ? `?${search}` : "") + window.location.hash,
        undefined,
        { shallow: true },
      );
    },
    [router],
  );

  const setMetricId = useCallback(
    (id: string) => update({ metric: id }),
    [update],
  );
  const setDebias = useCallback(
    (on: boolean) => update({ debias: on ? null : "0" }),
    [update],
  );
  const setDateRange = useCallback(
    (range: ExplorationDateRange) =>
      update({
        range: range.predefined === DEFAULT_RANGE ? null : range.predefined,
        start: range.startDate,
        end: range.endDate,
        lookback: range.lookbackValue,
        unit: range.lookbackUnit,
      }),
    [update],
  );

  // The current view, with the Project it resolved to written into the link
  const getShareUrl = useCallback((resolvedProject: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("project", resolvedProject || ALL_PROJECTS_PARAM);
    return url.toString();
  }, []);

  return {
    ready: router.isReady,
    project,
    getShareUrl,
    metricId,
    setMetricId,
    debias,
    setDebias,
    dateRange,
    setDateRange,
  };
}
