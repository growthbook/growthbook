import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NextRouter } from "next/router";
import { transformQuery, SyntaxFilter } from "@/services/search";

const FILTER_KEYS = [
  "user",
  "client",
  "url",
  "country",
  "device",
  "duration",
  "events",
  "date",
  "flag",
  "experiment",
];

/** Maps from URL query param names to search syntax tokens. */
const PARAM_TO_SYNTAX: Record<string, string> = {
  userId: "user:",
  clientKey: "client:",
  url: "url:",
  country: "country:",
  device: "device:",
  durationMinSecs: "duration:>",
  durationMaxSecs: "duration:<",
  eventCountMin: "events:>",
  eventCountMax: "events:<",
  dateAfter: "date:>",
  dateBefore: "date:<",
  featureKey: "flag:",
  experimentKey: "experiment:",
};

/** Needs quoting if the value contains spaces or commas (parser delimiters). */
function quoteIfNeeded(val: string): string {
  return val.includes(" ") || val.includes(",") ? `"${val}"` : val;
}

function queryParamsToSearchString(
  query: Record<string, string | string[] | undefined>,
): string {
  const parts: string[] = [];
  for (const [param, prefix] of Object.entries(PARAM_TO_SYNTAX)) {
    const val = query[param];
    if (typeof val === "string" && val) {
      parts.push(`${prefix}${quoteIfNeeded(val)}`);
    }
  }
  return parts.join(" ");
}

function syntaxFiltersToQueryParams(
  filters: SyntaxFilter[],
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const f of filters) {
    if (!f.values.length) continue;
    const val = f.values[0];
    if (!val) continue;

    switch (f.field) {
      case "user":
        params.userId = val;
        break;
      case "client":
        params.clientKey = val;
        break;
      case "url":
        params.url = val;
        break;
      case "country":
        params.country = f.values.join(",");
        break;
      case "device":
        params.device = f.values.join(",");
        break;
      case "duration":
        if (f.operator === ">") params.durationMinSecs = val;
        else if (f.operator === "<") params.durationMaxSecs = val;
        else params.durationMinSecs = val;
        break;
      case "events":
        if (f.operator === ">") params.eventCountMin = val;
        else if (f.operator === "<") params.eventCountMax = val;
        else params.eventCountMin = val;
        break;
      case "date":
        if (f.operator === ">") params.dateAfter = val;
        else if (f.operator === "<") params.dateBefore = val;
        break;
      case "flag":
        params.featureKey = val;
        break;
      case "experiment":
        params.experimentKey = val;
        break;
    }
  }
  return params;
}

/**
 * Extracts the filter-relevant query params from the router, ignoring
 * non-filter params like page/sessionId. Used as the single source of
 * truth for committed filters — the API always reads from here.
 */
function routerQueryToParams(
  query: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of Object.keys(PARAM_TO_SYNTAX)) {
    const val = query[key];
    if (typeof val === "string" && val) {
      params[key] = val;
    }
  }
  return params;
}

export function useSessionReplayFilters(router: NextRouter, project: string) {
  const [searchValue, setSearchValue] = useState(() =>
    queryParamsToSearchString(router.query),
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // queryParams for the API comes directly from the URL — single source of truth.
  const queryParams = useMemo(
    () => routerQueryToParams(router.query),
    [router.query],
  );

  // syntaxFilters for the filter dropdowns come from the search input
  const { syntaxFilters } = useMemo(
    () => transformQuery(searchValue, FILTER_KEYS),
    [searchValue],
  );

  // Sync searchValue from URL on back/forward, but only when there's
  // no pending user edit (active debounce means the user is still typing).
  const urlSearchString = useMemo(
    () => queryParamsToSearchString(router.query),
    [router.query],
  );
  const prevUrlRef = useRef(urlSearchString);
  useEffect(() => {
    if (urlSearchString === prevUrlRef.current) return;
    prevUrlRef.current = urlSearchString;
    if (debounceRef.current) return;
    setSearchValue(urlSearchString);
  }, [urlSearchString]);

  // Push search input changes to the URL (debounced).
  const parsedParams = useMemo(
    () => syntaxFiltersToQueryParams(syntaxFilters),
    [syntaxFilters],
  );
  const prevParsedRef = useRef<string>(JSON.stringify(parsedParams));
  useEffect(() => {
    const serialized = JSON.stringify(parsedParams);
    if (serialized === prevParsedRef.current) return;
    prevParsedRef.current = serialized;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = undefined;
      const query: Record<string, string> = { page: "1" };
      for (const [k, v] of Object.entries(parsedParams)) {
        if (v) query[k] = v;
      }
      const sessionId = router.query.sessionId;
      if (typeof sessionId === "string" && sessionId) {
        query.sessionId = sessionId;
      }
      prevUrlRef.current = queryParamsToSearchString(query);
      void router.push({ pathname: "/session-replay", query }, undefined, {
        shallow: true,
      });
    }, 400);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedParams]);

  const searchInputProps = useMemo(
    () => ({
      value: searchValue,
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        setSearchValue(e.target.value);
      },
    }),
    [searchValue],
  );

  const setSearchValueAndNavigate = useCallback((value: string) => {
    setSearchValue(value);
  }, []);

  return {
    searchInputProps,
    syntaxFilters,
    setSearchValue: setSearchValueAndNavigate,
    queryParams,
    project,
  };
}
