import {
  useState,
  useMemo,
  ChangeEvent,
  FC,
  ReactNode,
  useCallback,
} from "react";
import { FaSort, FaSortDown, FaSortUp } from "react-icons/fa";
import { FeatureInterface } from "back-end/types/feature";
import { useRouter } from "next/router";
import Fuse from "fuse.js";
import { useLocalStorage } from "../hooks/useLocalStorage";

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

export interface SearchProps<T> {
  items: T[];
  searchFields: SearchFields<T>;
  localStorageKey: string;
  defaultSortField: keyof T;
  defaultSortDir?: number;
  transformQuery?: (q: string) => string;
  filterResults?: (items: T[], originalQuery: string) => T[];
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
  transformQuery,
  filterResults,
  localStorageKey,
  defaultSortField,
  defaultSortDir,
}: SearchProps<T>): SearchReturn<T> {
  const [sort, setSort] = useLocalStorage(`${localStorageKey}:sort-dir`, {
    field: defaultSortField,
    dir: defaultSortDir,
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
      keys,
    });
  }, [items, JSON.stringify(searchFields)]);

  const filtered = useMemo(() => {
    const searchTerm = transformQuery ? transformQuery(value) : value;

    let filtered = items;
    if (searchTerm.length > 0) {
      filtered = fuse.search(searchTerm).map((item) => item.item);
    }
    if (filterResults) {
      filtered = filterResults(filtered, value);
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

// Helpers for searching features by environment
const envRegex = /(^|\s)(on|off):([^\s]*)/gi;
export function removeEnvFromSearchTerm(searchTerm: string) {
  return searchTerm.replace(envRegex, " ").trim();
}
export function filterFeaturesByEnvironment(
  filtered: FeatureInterface[],
  searchTerm: string,
  environments: string[]
) {
  // Determine which environments (if any) are being filtered by the search term
  const environmentFilter: Map<string, boolean> = new Map();
  const matches = searchTerm.matchAll(envRegex);
  for (const match of matches) {
    const enabled = match[2].toLowerCase() === "on";
    match[3]?.split(",").forEach((env) => {
      environmentFilter.set(env, enabled);
    });
  }
  if (environmentFilter.has("all")) {
    environments.forEach((env) => {
      environmentFilter.set(env, environmentFilter.get("all"));
    });
  }

  // No filtering required
  if (!environmentFilter.size) return filtered;

  return filtered.filter((f) => {
    for (const env of environments) {
      if (environmentFilter.has(env)) {
        const enabled = !!f.environmentSettings?.[env]?.enabled;
        if (enabled !== environmentFilter.get(env)) {
          return false;
        }
      }
    }
    return true;
  });
}
