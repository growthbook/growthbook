import {
  useState,
  useMemo,
  ChangeEvent,
  FC,
  MouseEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { FaSort, FaSortDown, FaSortUp } from "react-icons/fa";
import { useRouter } from "next/router";
import MiniSearch from "minisearch";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Pagination from "@/components/Pagination";

export function useAddComputedFields<T, ExtraFields>(
  items: T[] | undefined,
  add: (item: T) => ExtraFields,
  dependencies: unknown[] = [],
): (T & ExtraFields)[] {
  return useMemo(() => {
    return (items || []).map((item) => ({
      ...item,
      ...add(item),
    }));
  }, [items, ...dependencies]);
}

export type SearchFields<T> = (
  | keyof T
  | `${Exclude<keyof T, symbol>}^${number}`
)[];

// Builds a list-page URL with a pre-applied `q` syntax filter for useSearch.
// Always quotes value so reserved chars are literal; strips inner quotes (parser has no escape).
export function buildFilterUrl(
  pathname: string,
  field: string,
  value: string,
): string {
  const params = new URLSearchParams();
  params.set("q", `${field}:"${value.replace(/"/g, "")}"`);
  return `${pathname}?${params.toString()}`;
}

// Props for <SortedTags> to link each tag to `/${entity}?q=tag:"..."`.
export function tagLinkProps(
  entity: "features" | "experiments" | "metrics" | "bandits",
) {
  return {
    getTagHref: (tag: string) => buildFilterUrl(`/${entity}`, "tag", tag),
    linkEntity: entity,
  };
}

// Matches a `tag:` clause in a search value so we can replace just that portion.
const tagFilterClauseRegex =
  /(^|\s)tag:!?[><=^~]?(?:"[^"]*"|[^\s,]+)(?:,(?:"[^"]*"|[^\s,]+))*/gi;

// Click handler for list pages: filter the current list in place instead of navigating.
// Replaces only the tag clause in the current search value so other filters are preserved.
// Modifier clicks (cmd/ctrl/shift/alt) fall through to the anchor's href so the browser
// can open the filter page in a new tab/window as the user expects.
export function tagFilterOnClick(
  currentValue: string,
  setSearchValue: (value: string) => void,
): (tag: string, e: MouseEvent) => void {
  return (tag, e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const safe = tag.replace(/"/g, "");
    const stripped = currentValue
      .replace(tagFilterClauseRegex, " ")
      .replace(/\s+/g, " ")
      .trim();
    setSearchValue(stripped ? `${stripped} tag:"${safe}"` : `tag:"${safe}"`);
  };
}

const searchTermOperators = [">", "<", "^", "=", "~", ""] as const;

export type SyntaxFilter = {
  field: string;
  values: string[];
  operator: SearchTermFilterOperator;
  negated: boolean;
};

export type SearchTermFilterOperator = (typeof searchTermOperators)[number];

export interface SearchProps<T extends { id: string }> {
  items: T[];
  searchFields: SearchFields<T>;
  localStorageKey: string;
  defaultSortField: keyof T;
  defaultSortDir?: number;
  undefinedLast?: boolean;
  defaultMappings?: Partial<Record<keyof T, unknown>>;
  searchTermFilters?: {
    [key: string]: (
      item: T,
    ) =>
      | number
      | string
      | null
      | undefined
      | Date
      | (number | null | undefined)[]
      | (string | null | undefined)[]
      | (Date | null | undefined)[];
  };
  filterResults?: (items: T[]) => T[];
  updateSearchQueryOnChange?: boolean;
  pageSize?: number;
}

export interface SearchReturn<T> {
  items: T[];
  unpaginatedItems: T[];
  isFiltered: boolean;
  filteredItems: T[];
  clear: () => void;
  syntaxFilters: SyntaxFilter[];
  searchInputProps: {
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  };
  setSearchValue: (value: string) => void;
  SortableTH: FC<{
    field: keyof T;
    className?: string;
    children: ReactNode;
    style?: React.CSSProperties;
  }>;
  page: number;
  resetPage: () => void;
  pagination: ReactNode;
}

export function useSearch<T extends { id: string }>({
  items,
  searchFields,
  filterResults,
  localStorageKey,
  defaultSortField,
  defaultSortDir,
  undefinedLast,
  defaultMappings = {},
  searchTermFilters,
  updateSearchQueryOnChange,
  pageSize,
}: SearchProps<T>): SearchReturn<T> {
  const [sort, setSort] = useLocalStorage(`${localStorageKey}:sort-dir`, {
    field: defaultSortField,
    dir: defaultSortDir || 1,
  });

  const router = useRouter();
  const { q } = router.query;
  const initialSearchTerm = Array.isArray(q) ? q.join(" ") : q;
  const [value, setValue] = useState(initialSearchTerm ?? "");
  const [disableRelevanceSort, setDisableRelevanceSort] = useState(false);

  const [page, setPage] = useState(1);

  // We only want to re-create the MiniSearch instance if the fields actually changed
  // It's really easy to forget to add `useMemo` around the fields declaration
  // So, we turn it into a string here to use in the dependency array
  const { miniSearch, itemMap } = useMemo(() => {
    const keys: Record<string, number> = Object.fromEntries(
      searchFields.map((f) => {
        const [key, weight] = (f as string).split("^");
        const weightNum = weight ? parseFloat(weight) : 1;
        return [key, weightNum];
      }),
    );
    const fields = Object.keys(keys);

    // MiniSearch requires globally unique document IDs.
    // Some lists can contain duplicate business IDs (e.g. experiment tracking keys),
    // so we store a separate internal ID only for indexing.
    const internalSearchIdField = "__gb_search_id";
    const itemMap = new Map<string, T>();
    const indexedItems = items.map((item, index) => {
      const indexedId = `${item.id}::${index}`;
      itemMap.set(indexedId, item);
      return {
        ...item,
        [internalSearchIdField]: indexedId,
      };
    });

    const miniSearchInstance = new MiniSearch({
      idField: internalSearchIdField,
      fields,
      searchOptions: {
        boost: keys,
        fuzzy: true,
        prefix: true,
      },
    });

    // Add items to the index
    try {
      miniSearchInstance.addAll(indexedItems);
    } catch (error) {
      console.error("Error adding items to search index:", error);
    }

    return { miniSearch: miniSearchInstance, itemMap };
  }, [items, JSON.stringify(searchFields)]);

  const { filtered, syntaxFilters, searchTerm } = useMemo(() => {
    // remove any syntax filters from the search term
    const { searchTerm, syntaxFilters } = searchTermFilters
      ? transformQuery(value, Object.keys(searchTermFilters))
      : { searchTerm: value, syntaxFilters: [] };

    let filtered = items;
    if (searchTerm.length > 0) {
      const searchResults = miniSearch.search(searchTerm);
      filtered = searchResults
        .map((result) => itemMap.get(result.id + ""))
        .filter((item): item is T => !!item);
    }
    if (updateSearchQueryOnChange) {
      const searchParams = new URLSearchParams(window.location.search);
      const currentQ = searchParams.has("q") ? searchParams.get("q") : null;

      const shouldRemoveQ = value.length === 0 && currentQ !== null;
      const shouldSetQ = value !== currentQ && value.length > 0;
      const shouldUpdateURL = shouldRemoveQ || shouldSetQ;

      if (shouldRemoveQ) {
        searchParams.delete("q");
      } else if (shouldSetQ) {
        searchParams.set("q", value);
      }

      if (shouldUpdateURL) {
        router
          .replace(
            router.pathname +
              (searchParams.size > 0 ? `?${searchParams.toString()}` : "") +
              window.location.hash,
            undefined,
            {
              shallow: true,
            },
          )
          .then();
      }
    }

    // Search term filters
    if (syntaxFilters.length > 0) {
      // If multiple filters are present, we want to match all of them
      filtered = filtered.filter((item) =>
        syntaxFilters.every((filter) => {
          // If a filter has multiple values, at least one has to match
          const res = filter.values.some((searchValue) => {
            const itemValue = searchTermFilters?.[filter.field]?.(item) ?? null;
            return filterSearchTerm(itemValue, filter.operator, searchValue);
          });

          return filter.negated ? !res : res;
        }),
      );
    }

    // Custom filtering logic
    if (filterResults) {
      filtered = filterResults(filtered);
    }
    return { filtered, syntaxFilters, searchTerm };
  }, [value, miniSearch, filterResults, transformQuery]);

  const previousSearchTerm = useRef(searchTerm);
  const hasSearchTerm = searchTerm.length > 0;
  const isRelevanceSortActive = hasSearchTerm && !disableRelevanceSort;

  useEffect(() => {
    if (previousSearchTerm.current !== searchTerm) {
      const previousHadSearchTerm = previousSearchTerm.current.length > 0;
      const nextHasSearchTerm = searchTerm.length > 0;

      if (previousHadSearchTerm || nextHasSearchTerm) {
        setDisableRelevanceSort(false);
      }
      previousSearchTerm.current = searchTerm;
    }
  }, [searchTerm]);

  const isFiltered = value.length > 0;

  const sorted = useMemo(() => {
    if (isRelevanceSortActive) return filtered;

    const sorted = [...filtered];

    sorted.sort((a, b) => {
      const comp1 = a[sort.field] || defaultMappings[sort.field];
      const comp2 = b[sort.field] || defaultMappings[sort.field];
      if (undefinedLast) {
        if (comp1 === undefined && comp2 !== undefined) return 1;
        if (comp2 === undefined && comp1 !== undefined) return -1;
      }
      if (typeof comp1 === "string" && typeof comp2 === "string") {
        return comp1.localeCompare(comp2) * sort.dir;
      }
      if (Array.isArray(comp1) && Array.isArray(comp2)) {
        // Sorting an array is a bit odd
        // We'll just sort length of the array, then by the first element alphabetically
        // This is typically for tags
        if (comp1.length !== comp2.length) {
          return (comp2.length - comp1.length) * sort.dir;
        }
        const temp1 = comp1[0] ?? "";
        const temp2 = comp2[0] ?? "";
        if (typeof temp1 === "string" && typeof temp2 === "string") {
          return temp1.localeCompare(temp2) * sort.dir;
        }
        return (temp1 - temp2) * sort.dir;
      }
      if (typeof comp1 === "number" && typeof comp2 === "number") {
        return (comp1 - comp2) * sort.dir;
      }
      return 0;
    });
    return sorted;
  }, [sort.field, sort.dir, filtered, isRelevanceSortActive]);

  const paginated = useMemo(() => {
    if (!pageSize) return sorted;

    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return sorted.slice(start, end);
  }, [sorted, page, pageSize]);

  // When a filter is applied, reset the page
  useEffect(() => {
    setPage(1);
  }, [sorted.length]);

  const SortableTH = useMemo(() => {
    const th: FC<{
      field: keyof T;
      className?: string;
      children: ReactNode;
      style?: React.CSSProperties;
    }> = ({ children, field, className = "", style }) => {
      const showSortDirection = !isRelevanceSortActive && sort.field === field;

      return (
        <th className={className} style={style}>
          <span
            className="cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              setDisableRelevanceSort(true);
              setSort({
                field,
                dir: sort.field === field ? sort.dir * -1 : 1,
              });
            }}
          >
            {children}{" "}
            <a
              href="#"
              className={showSortDirection ? "activesort" : "inactivesort"}
            >
              {showSortDirection ? (
                sort.dir < 0 ? (
                  <FaSortDown />
                ) : (
                  <FaSortUp />
                )
              ) : (
                <FaSort />
              )}
            </a>
          </span>
        </th>
      );
    };
    return th;
  }, [sort.dir, sort.field, isRelevanceSortActive]);

  const clear = useCallback(() => {
    setValue("");
  }, []);

  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>): void => {
    setValue(e.target.value);
  }, []);

  return {
    items: paginated,
    unpaginatedItems: sorted,
    isFiltered,
    filteredItems: filtered,
    clear,
    syntaxFilters,
    searchInputProps: {
      value,
      onChange,
    },
    setSearchValue: setValue,
    SortableTH,
    page,
    resetPage: () => setPage(1),
    pagination:
      pageSize && sorted.length > pageSize ? (
        <Pagination
          currentPage={page}
          numItemsTotal={sorted.length}
          onPageChange={setPage}
          perPage={pageSize}
        />
      ) : null,
  };
}

export function filterSearchTerm(
  itemValue: unknown,
  op: SearchTermFilterOperator,
  searchValue: string,
): boolean {
  if ((!itemValue && itemValue !== 0) || !searchValue) {
    return false;
  }

  if (Array.isArray(itemValue)) {
    return itemValue.some((v) => filterSearchTerm(v, op, searchValue));
  }

  searchValue = searchValue.toLowerCase();
  const strVal =
    itemValue instanceof Date
      ? itemValue.toISOString()
      : (itemValue + "").toLowerCase();
  const [comp1, comp2]: [number, number] | [string, string] | [Date, Date] =
    typeof itemValue === "number"
      ? [itemValue, parseFloat(searchValue)]
      : (op === ">" || op === "<") && itemValue instanceof Date
        ? [itemValue, new Date(Date.parse(searchValue))]
        : [strVal, searchValue];

  switch (op) {
    case ">":
      return comp1 > comp2;
    case "<":
      return comp1 < comp2;
    case "=":
      return strVal === searchValue;
    case "~":
      return strVal.includes(searchValue);
    case "^":
      return strVal.startsWith(searchValue);
    // The default comparison depends on the type
    case "":
      if (itemValue instanceof Date) {
        // This is the full datetime object,
        // but most people will just type "2024" or "2024-01-01"
        return strVal.startsWith(searchValue);
      } else {
        return strVal === searchValue;
      }
  }
}

export function transformQuery(
  searchTerm: string,
  searchTermFilterKeys: string[],
) {
  // split up the string into the search term and the filters, and support OR'ing
  // multiple search terms, even if they are in quotes
  const regex = new RegExp(
    `(^|\\s)(${searchTermFilterKeys.join(
      "|",
    )}):(\\!?)([${searchTermOperators.join(
      "",
    )}]?)((?:"[^"]*"|[^\\s,]+)(?:,(?:"[^"]*"|[^\\s,]+))*)`,
    "gi",
  );
  return parseQuery(searchTerm, regex);
}

export function parseQuery(query: string, regex: RegExp) {
  const syntaxFilters: SyntaxFilter[] = [];

  const matches = query.matchAll(regex);
  for (const match of matches) {
    if (match && match.length >= 3) {
      const field = match[2];
      const negated = !!match[3];
      const operator = match[4] as SearchTermFilterOperator;
      const rawValue = match[5];
      // Split on commas that are outside of quotes, then strip quotes
      const values = (rawValue.match(/"[^"]*"|[^,]+/g) || []).map((s) =>
        s.trim().replace(/^"|"$/g, ""),
      );

      syntaxFilters.push({
        field,
        operator,
        negated,
        values,
      });
    }
  }

  const searchTerm = query.replace(regex, "$1").trim().replace(/\s+/g, " ");

  return {
    searchTerm,
    syntaxFilters,
  };
}
