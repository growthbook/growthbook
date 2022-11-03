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

export function useSearch<T>({
  items,
  fields,
  transformQuery,
  filterResults,
}: {
  items: T[];
  fields?: Fuse.FuseOptionKey<T>[];
  transformQuery?: (q: string) => string;
  filterResults?: (items: T[], originalQuery: string) => T[];
}): {
  list: T[];
  isFiltered: boolean;
  clear: () => void;
  searchInputProps: {
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  };
} {
  const router = useRouter();
  const { q } = router.query;
  const initialSearchTerm = Array.isArray(q) ? q.join(" ") : q;
  const [value, setValue] = useState(initialSearchTerm ?? "");

  const fuse = useMemo(() => {
    return new Fuse(items, {
      includeScore: true,
      useExtendedSearch: true,
      findAllMatches: true,
      keys: fields,
    });
  }, [items, fields]);

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
  }, [value, fuse, transformQuery, filterResults]);

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

export function parseEnvFilterFromSearchTerm(value: string) {
  const searchTermArr: string[] = [];
  const environmentFilter: Record<string, boolean> = {};
  const parts = value.split(" ");
  if (parts.length) {
    parts.map((s) => {
      if (s.toLowerCase().startsWith("on:")) {
        const env = s.replace(/on:/gi, "");
        environmentFilter[env] = true;
      } else if (s.toLowerCase().startsWith("off:")) {
        const env = s.replace(/off:/gi, "");
        environmentFilter[env] = false;
      } else {
        searchTermArr.push(s);
      }
    });
  }
  const searchTerm = searchTermArr.join(" ");

  return {
    searchTerm,
    environmentFilter,
  };
}

export function filterFeaturesByEnvironment(
  list: FeatureInterface[],
  value: string
) {
  const { environmentFilter } = parseEnvFilterFromSearchTerm(value);

  if (Object.keys(environmentFilter).length !== 0) {
    list = list.filter((o) => {
      // filtering by environment:
      for (const env in environmentFilter) {
        // special case for all environments:
        if (env === "all") {
          let match = true;
          Object.keys(o.environmentSettings).map((e) => {
            if (o.environmentSettings[e].enabled !== environmentFilter[env]) {
              match = false;
            }
          });
          return match;
        } else {
          // if we have a comma for multiple environments...
          if (env.includes(",")) {
            // AND these environments:
            const andEnvs = env.split(",");
            let match = true;
            andEnvs.map((e) => {
              if (
                !o.environmentSettings[e] ||
                o.environmentSettings[e].enabled !== environmentFilter[env]
              ) {
                match = false;
              }
            });
            return match;
          } else if (
            o.environmentSettings[env] &&
            o.environmentSettings[env].enabled === environmentFilter[env]
          ) {
            return true;
          }
        }
      }
      return false;
    });
  }

  return list;
}

export function useSort<T>({
  items,
  defaultField,
  defaultDir = 1,
  fieldName,
  compFunctions,
  disableSort = false,
}: {
  items: T[];
  defaultField: string;
  defaultDir?: number;
  fieldName: string;
  compFunctions?: Record<string, (a: T, b: T) => number>;
  disableSort?: boolean;
}) {
  const [sort, setSort] = useLocalStorage(`${fieldName}:sort-dir`, {
    field: defaultField,
    dir: defaultDir,
  });

  const sorted = useMemo(() => {
    if (disableSort) return items;

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
  }, [sort, items, disableSort]);

  const SortableTH = useMemo(() => {
    const th: FC<{
      field: string;
      className?: string;
      children: ReactNode;
    }> = ({ children, field, className = "" }) => {
      if (disableSort) return <th className={className}>{children}</th>;
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
  }, [sort.dir, sort.field, disableSort]);

  return {
    sorted,
    SortableTH,
  };
}
