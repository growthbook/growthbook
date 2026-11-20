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

/** Params whose value is a comma-joined list rather than a single value. */
const MULTI_VALUE_PARAMS = new Set([
  "country",
  "device",
  "featureKey",
  "experimentKey",
]);

// Mirrors the caps in session-replay.router.ts. The server limits the whole
// joined value, so enough selections build a request it rejects with a 400
// that the UI can only report as "Failed to load sessions".
const PARAM_MAX_LENGTH: Record<string, number> = {
  country: 64,
  device: 64,
  featureKey: 255,
  experimentKey: 255,
};

/** Needs quoting if the value contains spaces or commas (parser delimiters). */
function quoteIfNeeded(val: string): string {
  return val.includes(" ") || val.includes(",") ? `"${val}"` : val;
}

// Quote each value separately, or the comma joining a multi-value param gets
// quoted too and the whole list parses back as one value.
function formatParamValue(param: string, val: string): string {
  if (!MULTI_VALUE_PARAMS.has(param)) return quoteIfNeeded(val);
  return val.split(",").filter(Boolean).map(quoteIfNeeded).join(",");
}

function queryParamsToSearchString(
  query: Record<string, string | string[] | undefined>,
): string {
  const parts: string[] = [];
  for (const [param, prefix] of Object.entries(PARAM_TO_SYNTAX)) {
    const val = query[param];
    if (typeof val === "string" && val) {
      parts.push(`${prefix}${formatParamValue(param, val)}`);
    }
  }
  return parts.join(" ");
}

export type DroppedFilters = {
  /** Param names whose selections exceeded the server's length cap. */
  truncated: Set<string>;
  /** Syntax fields whose exclusion tokens the API cannot express. */
  negated: Set<string>;
};

export function emptyDroppedFilters(): DroppedFilters {
  return { truncated: new Set(), negated: new Set() };
}

export function syntaxFiltersToQueryParams(
  filters: SyntaxFilter[],
  dropped: DroppedFilters = emptyDroppedFilters(),
): Record<string, string> {
  const params: Record<string, string> = {};
  // Repeated tokens for one field accumulate rather than overwrite, so
  // `country:US country:CA` doesn't silently drop US
  const addMulti = (param: string, values: string[]) => {
    const max = PARAM_MAX_LENGTH[param];
    const existing = params[param] ? params[param].split(",") : [];
    for (const v of values) {
      if (!v || existing.includes(v)) continue;
      const next = existing.concat(v).join(",");
      if (max !== undefined && next.length > max) {
        dropped.truncated.add(param);
        continue;
      }
      existing.push(v);
    }
    params[param] = existing.join(",");
  };

  for (const f of filters) {
    if (!f.values.length) continue;
    const val = f.values[0];
    if (!val) continue;
    // The API has no exclusion filter, so sending the bare value would invert
    // what was asked for. Drop it rather than return the opposite sessions.
    if (f.negated) {
      dropped.negated.add(f.field);
      continue;
    }

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
        addMulti("country", f.values);
        break;
      case "device":
        addMulti("device", f.values);
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
        addMulti("featureKey", f.values);
        break;
      case "experiment":
        addMulti("experimentKey", f.values);
        break;
    }
  }
  return params;
}

// Report the token the user typed, not the param name: `durationMinSecs` is
// `duration:>` in the search box.
function paramToFieldLabel(param: string): string {
  const syntax = PARAM_TO_SYNTAX[param];
  return syntax ? syntax.split(":")[0] : param;
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
  // Filters the request could not carry, reported back to the user
  const [droppedFilters, setDroppedFilters] = useState<{
    truncated: string[];
    negated: string[];
  }>({ truncated: [], negated: [] });
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
    // The rebuilt string never contains the tokens that were dropped, so a
    // warning about them no longer matches what the input shows. Our own
    // pushes pre-set prevCommittedRef and return above, keeping theirs.
    setDroppedFilters({ truncated: [], negated: [] });
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
    const dropped = emptyDroppedFilters();
    const newParams = syntaxFiltersToQueryParams(parsed, dropped);
    setDroppedFilters({
      truncated: Array.from(dropped.truncated).map(paramToFieldLabel),
      negated: Array.from(dropped.negated),
    });
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
    droppedFilters,
    project,
  };
}
