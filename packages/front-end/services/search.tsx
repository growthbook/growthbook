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
  searchTermFilterKeys: string[]
) {
  // TODO: Support comma-separated quoted values (e.g. `foo:"bar","baz"`)
  const regex = new RegExp(
    `(^|\\s)(${searchTermFilterKeys.join(
      "|"
    )}):(\\!?)([${searchTermOperators.join("")}]?)([^\\s"]+|"[^"]*"?)`,
    "gi"
  );
  return parseQuery(searchTerm, regex);
}

export function parseQuery(query: string, regex: RegExp) {
  const syntaxFilters: {
    field: string;
    values: string[];
    operator: SearchTermFilterOperator;
    negated: boolean;
  }[] = [];

  const matches = query.matchAll(regex);
  for (const match of matches) {
    if (match && match.length >= 3) {
      const field = match[2];
      const negated = !!match[3];
      const operator = match[4] as SearchTermFilterOperator;
      const rawValue = match[5].replace(/"/g, "");

      syntaxFilters.push({
        field,
        operator,
        negated,
        values: rawValue.split(",").map((s) => s.trim()),
      });
    }
  }

  const searchTerm = query.replace(regex, "$1").trim().replace(/\s+/g, " ");

  return {
    searchTerm,
    syntaxFilters,
  };
}
