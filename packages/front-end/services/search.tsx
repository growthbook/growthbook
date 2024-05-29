import {
  useState,
  useMemo,
  ChangeEvent,
  FC,
  ReactNode,
  useCallback,
} from "react";
import { FaSort, FaSortDown, FaSortUp } from "react-icons/fa";
import { useRouter } from "next/router";
import Fuse from "fuse.js";
import { useLocalStorage } from "@/hooks/useLocalStorage";

export function useAddComputedFields<T, ExtraFields>(
  items: T[] | undefined,
  add: (item: T) => ExtraFields,
  dependencies: unknown[] = []
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

const searchTermOperators = [">", "<", "^", "=", "~", ""] as const;

export type SearchTermFilterOperator = typeof searchTermOperators[number];

export interface SearchProps<T> {
  items: T[];
  searchFields: SearchFields<T>;
  localStorageKey: string;
  defaultSortField: keyof T;
  defaultSortDir?: number;
  searchTermFilters?: {
    [key: string]: (
      item: T
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
}

export interface SearchReturn<T> {
  items: T[];
  isFiltered: boolean;
  clear: () => void;
  searchInputProps: {
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  };
  SortableTH: FC<{
    field: keyof T;
    className?: string;
    children: ReactNode;
  }>;
}

export function useSearch<T>({
  items,
  searchFields,
  filterResults,
  localStorageKey,
  defaultSortField,
  defaultSortDir,
  searchTermFilters,
}: SearchProps<T>): SearchReturn<T> {
  const [sort, setSort] = useLocalStorage(`${localStorageKey}:sort-dir`, {
    field: defaultSortField,
    dir: defaultSortDir || 1,
  });

  const router = useRouter();
  const { q } = router.query;
  const initialSearchTerm = Array.isArray(q) ? q.join(" ") : q;
  const [value, setValue] = useState(initialSearchTerm ?? "");

  // We only want to re-create the Fuse instance if the fields actually changed
  // It's really easy to forget to add `useMemo` around the fields declaration
  // So, we turn it into a string here to use in the dependency array
  const fuse = useMemo(() => {
    const keys: Fuse.FuseOptionKey<T>[] = searchFields.map((f) => {
      const [key, weight] = (f as string).split("^");
      return { name: key, weight: weight ? parseFloat(weight) : 1 };
    });
    return new Fuse(items, {
      includeScore: true,
      useExtendedSearch: true,
      findAllMatches: true,
      ignoreLocation: true,
      keys,
    });
  }, [items, JSON.stringify(searchFields)]);

  const filtered = useMemo(() => {
    // remove any syntax filters from the search term
    const { searchTerm, syntaxFilters } = searchTermFilters
      ? transformQuery(value, Object.keys(searchTermFilters))
      : { searchTerm: value, syntaxFilters: [] };

    let filtered = items;
    if (searchTerm.length > 0) {
      filtered = fuse.search(searchTerm).map((item) => item.item);
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
        })
      );
    }

    // Custom filtering logic
    if (filterResults) {
      filtered = filterResults(filtered);
    }
    return filtered;
  }, [value, fuse, filterResults, transformQuery]);

  const isFiltered = value.length > 0;

  const sorted = useMemo(() => {
    if (isFiltered) return filtered;

    const sorted = [...filtered];

    sorted.sort((a, b) => {
      const comp1 = a[sort.field];
      const comp2 = b[sort.field];
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
  }, [sort.field, sort.dir, filtered, isFiltered]);

  const SortableTH = useMemo(() => {
    const th: FC<{
      field: keyof T;
      className?: string;
      children: ReactNode;
    }> = ({ children, field, className = "" }) => {
      if (isFiltered) return <th className={className}>{children}</th>;
      return (
        <th className={className}>
          <span
            className="cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              setSort({
                field,
                dir: sort.field === field ? sort.dir * -1 : 1,
              });
            }}
          >
            {children}{" "}
            <a
              href="#"
              className={sort.field === field ? "activesort" : "inactivesort"}
            >
              {sort.field === field ? (
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
  }, [sort.dir, sort.field, isFiltered]);

  const clear = useCallback(() => {
    setValue("");
  }, []);

  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>): void => {
    setValue(e.target.value);
  }, []);

  return {
    items: sorted,
    isFiltered,
    clear,
    searchInputProps: {
      value,
      onChange,
    },
    SortableTH,
  };
}

export function filterSearchTerm(
  itemValue: unknown,
  op: SearchTermFilterOperator,
  searchValue: string
): boolean {
  if (!itemValue || !searchValue) {
    return false;
  }

  if (Array.isArray(itemValue)) {
    return itemValue.some((v) => filterSearchTerm(v, op, searchValue));
  }

  const strVal =
    itemValue instanceof Date ? itemValue.toISOString() : itemValue + "";
  const [comp1, comp2]: [number, number] | [string, string] =
    typeof itemValue === "number"
      ? [itemValue, parseFloat(searchValue)]
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
      if (typeof itemValue === "number") {
        return strVal === searchValue;
      } else if (itemValue instanceof Date) {
        return strVal.includes(searchValue);
      } else {
        return strVal.startsWith(searchValue);
      }
  }
}

export function transformQuery(
  searchTerm: string,
  searchTermFilterKeys: string[]
) {
  const regex = new RegExp(
    `(^|\\s)(${searchTermFilterKeys.join("|")}):([^\\s].*)`,
    "gi"
  );
  return parseQuery(searchTerm, regex);
}

export function parseQuery(query: string, regex: RegExp) {
  const parts = query.split(" ");
  const searchTerms: string[] = [];
  const syntaxFilters: {
    field: string;
    values: string[];
    operator: SearchTermFilterOperator;
    negated: boolean;
  }[] = [];
  parts.forEach((p) => {
    if (p.includes(":")) {
      // this could be a syntax filter
      const matches = p.matchAll(regex);
      let hasMatches = false;
      for (const match of matches) {
        hasMatches = true;
        if (match && match.length >= 3) {
          const field = match[2];
          let rawValue = match[3];

          let negated = false;
          if (rawValue.startsWith("!")) {
            negated = true;
            rawValue = rawValue.substring(1);
          }

          let operator: SearchTermFilterOperator = "";
          const firstChar = rawValue.substring(0, 1);
          for (const op of searchTermOperators) {
            if (op && firstChar === op) {
              operator = firstChar;
              rawValue = rawValue.substring(op.length);
              break;
            }
          }

          syntaxFilters.push({
            field,
            operator,
            negated,
            values: rawValue.split(",").map((s) => s.trim()),
          });
        } else {
          searchTerms.push(p);
        }
      }

      if (!hasMatches) {
        searchTerms.push(p);
      }
    } else {
      searchTerms.push(p);
    }
  });
  return { searchTerm: searchTerms.join(" "), syntaxFilters };
}
