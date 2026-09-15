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

function queryParamsToSearchString(
  query: Record<string, string | string[] | undefined>,
): string {
  const parts: string[] = [];
  for (const [param, prefix] of Object.entries(PARAM_TO_SYNTAX)) {
    const val = query[param];
    if (typeof val === "string" && val) {
      const escaped = val.includes(" ") ? `"${val}"` : val;
      parts.push(`${prefix}${escaped}`);
    }
  }
  return parts.join(" ");
}

function syntaxFiltersToQueryParams(
  filters: SyntaxFilter[],
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const f of filters) {
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
        params.country = val;
        break;
      case "device":
        params.device = val;
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

export function useSessionReplayFilters(router: NextRouter, project: string) {
  const initializedRef = useRef(false);
  const [searchValue, setSearchValue] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // One-time init: convert URL query params → search string on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const initial = queryParamsToSearchString(router.query);
    if (initial) setSearchValue(initial);
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { syntaxFilters } = useMemo(
    () => transformQuery(searchValue, FILTER_KEYS),
    [searchValue],
  );

  const queryParams = useMemo(
    () => syntaxFiltersToQueryParams(syntaxFilters),
    [syntaxFilters],
  );

  // Push filter changes to the URL (debounced)
  const prevParamsRef = useRef<string>("");
  useEffect(() => {
    const serialized = JSON.stringify(queryParams);
    if (serialized === prevParamsRef.current) return;
    prevParamsRef.current = serialized;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const query: Record<string, string> = { page: "1" };
      for (const [k, v] of Object.entries(queryParams)) {
        if (v) query[k] = v;
      }
      // Preserve sessionId if present
      const sessionId = router.query.sessionId;
      if (typeof sessionId === "string" && sessionId) {
        query.sessionId = sessionId;
      }
      void router.push({ pathname: "/session-replay", query }, undefined, {
        shallow: true,
      });
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryParams]);

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
