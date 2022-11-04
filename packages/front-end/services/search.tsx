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
import { useLocalStorage } from "../hooks/useLocalStorage";
import Fuse from "fuse.js";

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

export interface SearchPropsNoDeps<T> {
  items: T[];
  fields: Fuse.FuseOptionKey<T>[];
}
// If using filters or transforms, require dependencies to be specified
export interface SearchPropsFilter<T> extends SearchPropsNoDeps<T> {
  filterResults: (items: T[], originalQuery: string) => T[];
  dependencies: unknown[];
}
export interface SearchPropsTransform<T> extends SearchPropsFilter<T> {
  transformQuery: (q: string) => string;
}
export interface SearchReturn<T> {
  list: T[];
  isFiltered: boolean;
  clear: () => void;
  searchInputProps: {
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  };
}

export function useSearch<T>(props: SearchPropsNoDeps<T>): SearchReturn<T>;
export function useSearch<T>(props: SearchPropsFilter<T>): SearchReturn<T>;
export function useSearch<T>(props: SearchPropsTransform<T>): SearchReturn<T>;
export function useSearch<T>({
  items,
  fields,
  transformQuery,
  filterResults,
  dependencies = [],
}: Partial<SearchPropsTransform<T>>): SearchReturn<T> {
  const router = useRouter();
  const { q } = router.query;
  const initialSearchTerm = Array.isArray(q) ? q.join(" ") : q;
  const [value, setValue] = useState(initialSearchTerm ?? "");

  // We only want to re-create the Fuse instance if the fields actually changed
  // It's really easy to forget to add `useMemo` around the fields declaration
  // So, we turn it into a string here to use in the dependency array
  const fuse = useMemo(() => {
    console.log("Creating Fuse instance");
    return new Fuse(items, {
      includeScore: true,
      useExtendedSearch: true,
      findAllMatches: true,
      keys: fields,
    });
  }, [items, JSON.stringify(fields)]);

  const list = useMemo(() => {
    const searchTerm = transformQuery ? transformQuery(value) : value;

    let list = items;
    if (searchTerm.length > 0) {
      list = fuse.search(searchTerm).map((item) => item.item);
    }
    if (filterResults) {
      list = filterResults(list, value);
    }
    return list;
  }, [value, fuse, ...dependencies]);

  const isFiltered = value.length > 0;

  const clear = useCallback(() => {
    setValue("");
  }, []);

  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>): void => {
    setValue(e.target.value);
  }, []);

  return {
    list,
    isFiltered,
    clear,
    searchInputProps: {
      value,
      onChange,
    },
  };
}

export type EnvironmentFilter = Map<string, boolean>;

export function parseEnvFilterFromSearchTerm(value: string) {
  const regex = /(^|\s)(on|off):([^\s]*)(\s|$)/gi;

  const searchTerm = value.replace(regex, " ").trim();
  const environmentFilter: EnvironmentFilter = new Map();

  const matches = value.matchAll(regex);
  for (const match of matches) {
    const enabled = match[2].toLowerCase() === "on";
    match[3]?.split(",").forEach((env) => {
      environmentFilter.set(env, enabled);
    });
  }

  return {
    searchTerm,
    environmentFilter,
  };
}

export function filterFeaturesByEnvironment(
  list: FeatureInterface[],
  value: string,
  environments: string[]
) {
  const { environmentFilter } = parseEnvFilterFromSearchTerm(value);
  if (environmentFilter.has("all")) {
    environments.forEach((env) => {
      environmentFilter.set(env, environmentFilter.get("all"));
    });
  }

  if (!environmentFilter.size) return list;

  return list.filter((f) => {
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

export function useSort<T>({
  items,
  defaultField,
  defaultDir = 1,
  fieldName,
  compFunctions,
  isFiltered = false,
}: {
  items: T[];
  defaultField: string;
  defaultDir?: number;
  fieldName: string;
  compFunctions?: Record<string, (a: T, b: T) => number>;
  isFiltered?: boolean;
}) {
  const [sort, setSort] = useLocalStorage(`${fieldName}:sort-dir`, {
    field: defaultField,
    dir: defaultDir,
  });

  const sorted = useMemo(() => {
    if (isFiltered) return items;

    const sorted = [...items];

    sorted.sort((a, b) => {
      if (compFunctions && sort.field in compFunctions) {
        return compFunctions[sort.field](a, b) * sort.dir;
      }

      const comp1 = a[sort.field];
      const comp2 = b[sort.field];
      if (typeof comp1 === "string") {
        return comp1.localeCompare(comp2) * sort.dir;
      }
      if (Array.isArray(comp1)) {
        // sorting an array is a bit odd - we'll just sort length of the array, then by the first element alphabetically
        // this is typically for tags.
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
      return (comp1 - comp2) * sort.dir;
    });
    return sorted;
  }, [sort, items, isFiltered]);

  const SortableTH = useMemo(() => {
    const th: FC<{
      field: string;
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
              setSort({ field, dir: sort.field === field ? sort.dir * -1 : 1 });
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

  return {
    sorted,
    SortableTH,
  };
}
