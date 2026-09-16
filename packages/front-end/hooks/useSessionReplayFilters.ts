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
  const queryParams = useMemo(
    () => routerQueryToParams(router.query),
    [router.query],
  );

  // Canonical search string derived from URL — used to reset the input
  // when the URL changes externally (back/forward, dropdown commit).
  const committedSearchString = useMemo(
    () => queryParamsToSearchString(router.query),
    [router.query],
  );

  // === LOCAL INPUT STATE ===

  const [inputValue, setInputValue] = useState(committedSearchString);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // When URL changes externally (back/forward nav, or after our own push
  // completes), reset the input to match. prevCommittedRef is pre-updated
  // in commitToUrl so our own pushes don't trigger a redundant reset.
  const prevCommittedRef = useRef(committedSearchString);
  useEffect(() => {
    if (committedSearchString === prevCommittedRef.current) return;
    prevCommittedRef.current = committedSearchString;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
    }
    setInputValue(committedSearchString);
  }, [committedSearchString]);

  // syntaxFilters derived from inputValue so dropdowns always see filters
  // matching the text in the search box. No cycle — nothing watches
  // syntaxFilters to push back to the URL.
  const { syntaxFilters } = useMemo(
    () => transformQuery(inputValue, FILTER_KEYS),
    [inputValue],
  );

  // === COMMIT: parse input and push to URL ===

  const routerRef = useRef(router);
  routerRef.current = router;

  const commitToUrl = useCallback((searchString: string) => {
    const { syntaxFilters: parsed } = transformQuery(searchString, FILTER_KEYS);
    const newParams = syntaxFiltersToQueryParams(parsed);
    const r = routerRef.current;
    const currentParams = routerQueryToParams(r.query);
    if (JSON.stringify(newParams) === JSON.stringify(currentParams)) return;
    const query: Record<string, string> = { page: "1" };
    for (const [k, v] of Object.entries(newParams)) {
      if (v) query[k] = v;
    }
    const sessionId = r.query.sessionId;
    if (typeof sessionId === "string" && sessionId) {
      query.sessionId = sessionId;
    }
    prevCommittedRef.current = queryParamsToSearchString(query);
    void r.push({ pathname: "/session-replay", query }, undefined, {
      shallow: true,
    });
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // === PUBLIC API ===

  const searchInputProps = useMemo(
    () => ({
      value: inputValue,
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setInputValue(newValue);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          debounceRef.current = undefined;
          commitToUrl(newValue);
        }, 400);
      },
    }),
    [inputValue, commitToUrl],
  );

  // Called by dropdown actions — commits immediately (discrete action).
  const setSearchValueAndNavigate = useCallback(
    (value: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = undefined;
      }
      setInputValue(value);
      commitToUrl(value);
    },
    [commitToUrl],
  );

  return {
    searchInputProps,
    syntaxFilters,
    setSearchValue: setSearchValueAndNavigate,
    queryParams,
    project,
  };
}
