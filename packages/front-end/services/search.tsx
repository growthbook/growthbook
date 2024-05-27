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

export interface SearchProps<T> {
  items: T[];
  searchFields: SearchFields<T>;
  localStorageKey: string;
  defaultSortField: keyof T;
  defaultSortDir?: number;
  transformQuery?: (
    q: string
  ) => { searchTerm: string; syntaxFilters: Record<string, string[]>[] };
  filterResults?: (
    items: T[],
    originalQuery: string,
    syntaxFilters: Record<string, string[]>[]
  ) => T[];
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
    const { searchTerm, syntaxFilters } = transformQuery
      ? transformQuery(value)
      : { searchTerm: value, syntaxFilters: [] };

    let filtered = items;
    if (searchTerm.length > 0) {
      filtered = fuse.search(searchTerm).map((item) => item.item);
    }
    if (filterResults) {
      filtered = filterResults(filtered, value, syntaxFilters);
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

// Helpers for searching features by syntax
const featureSyntaxRegex = /(on|off|is|has|owner|key|name|desc|project|tag|created|updated|type):([^\s].*)/gi;
// Helpers for searching experiments by syntax
const experimentSyntaxRegex = /(is|has|status|owner|name|desc|project|tag|created|updated|datasource|metric):([^\s].*)/gi;
// Helpers for searching features by environment
const envRegex = /(^|\s)(on|off):([^\s]*)/gi;

export function removeEnvFromSearchTerm(searchTerm: string) {
  return parseQuery(searchTerm, envRegex);
}
export function filterFeatureSearchTerms(searchTerm: string) {
  return parseQuery(searchTerm, featureSyntaxRegex);
}
export function filterExperimentSearchTerms(searchTerm: string) {
  return parseQuery(searchTerm, experimentSyntaxRegex);
}
export function filterFeaturesByEnvironment<
  T extends { environmentSettings?: Record<string, { enabled: boolean }> }
>(filtered: T[], searchTerm: string, environments: string[]) {
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
      const value = environmentFilter.get("all");
      if (value) environmentFilter.set(env, value);
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

export function parseQuery(query: string, regex: RegExp = featureSyntaxRegex) {
  const parts = query.split(" ");
  const searchTerms: string[] = [];
  const syntaxFilters: Record<string, string[]>[] = [];
  parts.forEach((p) => {
    if (p.includes(":")) {
      // this could be a syntax filter
      const matches = p.matchAll(regex);
      for (const match of matches) {
        if (match && match.length >= 2) {
          const newFilter: Record<string, string[]> = {};
          newFilter[match[1]] = match[2]
            .split(",")
            .map((s) => s.trim().toLowerCase());
          syntaxFilters.push(newFilter);
        } else {
          searchTerms.push(p);
        }
      }
    } else {
      searchTerms.push(p);
    }
  });
  return { searchTerm: searchTerms.join(" "), syntaxFilters };
}

function dateFilter<
  T extends { dateCreated: Date | string; dateUpdated: Date | string }
>(
  filtered: T[],
  dateField: "dateCreated" | "dateUpdated",
  filterString: string
): T[] {
  //let filteredItems: Array<FeatureInterface | ExperimentInterface> = [];
  if (
    filterString.substring(0, 1) === ">" ||
    filterString.substring(0, 1) === "<"
  ) {
    const filterDate = new Date(Date.parse(filterString.substring(1)));
    filtered = filtered.filter((f) => {
      const checkDate = new Date(f[dateField]);
      if (filterString.substring(0, 1) === ">") {
        return checkDate > filterDate;
      } else {
        return checkDate < filterDate;
      }
    });
  } else {
    filtered = filtered.filter((f) => {
      const created = new Date(f.dateCreated);
      return created
        .toDateString()
        .toLowerCase()
        .includes(filterString.toLowerCase());
    });
  }
  return filtered;
}

export function filterBySyntax<
  T extends {
    id?: string;
    dateCreated: Date | string;
    dateUpdated: Date | string;
    name?: string;
    ownerName?: string;
    owner?: string;
    description?: string;
    project?: string;
    tags?: string[];
    status?: string;
    datasource?: string;
    results?: string;
    environmentSettings?: Record<string, { enabled: boolean }>;
  }
>(
  list: T[],
  searchTerm: string,
  syntaxFilters: Record<string, string[]>[],
  environments: string[] = []
  //experiments: unknown[]
) {
  let filtered = list;
  //const { syntaxFilters } = parseQuery(searchTerm);
  // name:foo,bar
  syntaxFilters.forEach((filter) => {
    // exact matches on id/name for the feature (which supports comma separated list)
    if (filter.name) {
      filtered = filtered.filter((e) => {
        if ("name" in e && typeof e.name === "string") {
          return filter.name.includes(e.name.toLowerCase());
        } else if ("id" in e && typeof e.id === "string") {
          return filter.name.includes(e.id.toLowerCase());
        }
      });
    }
    // desc:foo (no comma supported)
    if (filter.desc) {
      filtered = filtered.filter((e) => {
        if (e.description) {
          return e.description
            .toLowerCase()
            .includes(filter.desc[0].toLowerCase());
        }
        return false;
      });
    }
    if (filter.key) {
      filtered = filtered.filter((f) => {
        if ("id" in f && typeof f.id === "string") {
          // exact matches on id/name for the feature (which supports comma separated list)
          return filter.key.includes(f.id.toLowerCase());
        }
      });
    }
    // on:[env1,env2] off:[env3,env4]
    if (filter.on || filter.off) {
      filtered = filterFeaturesByEnvironment(
        filtered,
        searchTerm,
        environments
      );
    }
    // rule: [experiment, force, rollout] - not supported yet.
    // if (syntaxFilters.rules) {
    //   filtered = filtered.filter((f) =>
    //     f. ?.toLowerCase().includes(syntaxFilters.rules.toLowerCase())
    //   );
    // }
    //
    // project:foo,bar (exact match on project)
    if (filter.project) {
      filtered = filtered.filter((f) => {
        if (f.project) {
          return filter.project.includes(f.project.toLowerCase());
        }
      });
    }
    // tag:foo (exact match on tag, no comma supported)
    if (filter.tag) {
      filtered = filtered.filter((f) =>
        f.tags?.includes(filter.tag[0].toLowerCase())
      );
    }
    // type: [boolean, string, number, json]
    if (filter.type) {
      filtered = filtered.filter((f) => {
        if ("valueType" in f && typeof f.valueType === "string") {
          return filter.type.includes(f.valueType.toLowerCase());
        }
      });
    }
    // project:foo,bar (exact match on project)
    if (filter.project) {
      filtered = filtered.filter((e) => {
        if (e.project) {
          return filter.project.includes(e.project.toLowerCase());
        }
      });
    }
    // tag:foo (exact match on tag, no comma supported)
    if (filter.tag) {
      filtered = filtered.filter((e) =>
        e.tags?.includes(filter.tag[0].toLowerCase())
      );
    }
    // owner:abbie,barry (exact match on owner)
    if (filter.owner) {
      filtered = filtered.filter((e) => {
        if ("ownerName" in e && typeof e.ownerName === "string") {
          return filter.owner.includes(e.ownerName.toLowerCase());
        } else if ("owner" in e && typeof e.owner === "string") {
          return filter.owner.includes(e.owner.toLowerCase());
        } else {
          // if no owner somehow, include them? I guess so
          return true;
        }
      });
    }
    // status: [stopped, running, draft, archived]
    if (filter.status) {
      filtered = filtered.filter((e) => {
        if ("status" in e && typeof e.status === "string") {
          return filter.status.includes(e.status.toLowerCase());
        }
      });
    }
    // datasource:bigQuery (match on datasource)
    if (filter.datasource) {
      filtered = filtered.filter((e) => {
        if ("datasource" in e && typeof e.datasource === "string") {
          return e.datasource
            .toLowerCase()
            .includes(filter.datasource[0].toLowerCase());
        }
      });
    }
    // is:running, stopped, draft, draft, stale
    if (filter.is) {
      if (filter.is.includes("running")) {
        filtered = filtered.filter(
          (e) => "status" in e && e.status === "running"
        );
      } else if (filter.is.includes("stopped")) {
        filtered = filtered.filter((e) => "status" && e.status === "stopped");
      } else if (filter.is.includes("draft")) {
        filtered = filtered.filter((e) => {
          if ("status" in e && typeof e.status === "string") {
            return e.status === "draft";
          } else if ("hasDrafts" in e) {
            return e.hasDrafts;
          }
        });
      } else if (filter.is.includes("stale")) {
        filtered = filtered.filter((e) => {
          if ("neverStale" in e) {
            return !e.neverStale;
          }
        });
      } else {
        // none match
        filtered = [];
      }
    }
    // has:won, dnf, lost, inconclusive
    if (filter.has) {
      let returnFiltered: T[] = [];
      if (filter.has.includes("won")) {
        returnFiltered = filtered.filter(
          (e) => "results" in e && e.results === "won"
        );
      }
      if (filter.has.includes("dnf")) {
        returnFiltered = filtered.filter(
          (e) => "results" in e && e.results === "dnf"
        );
      }
      if (filter.has.includes("lost")) {
        returnFiltered = filtered.filter(
          (e) => "results" in e && e.results === "lost"
        );
      }
      if (filter.has.includes("inconclusive")) {
        returnFiltered = filtered.filter(
          (e) => "results" in e && e.results === "inconclusive"
        );
      }
      if (filter.has.includes("draft")) {
        returnFiltered = filtered.filter((e) => {
          if ("status" in e && typeof e.status === "string") {
            return e.status === "draft";
          } else if ("hasDrafts" in e) {
            return e.hasDrafts;
          }
        });
      }
      if (filter.has.includes("stale")) {
        returnFiltered = filtered.filter((e) => {
          if ("neverStale" in e) {
            return !e.neverStale;
          }
        });
      }
      filtered = returnFiltered;
    }
    if (filter.created) {
      filtered = dateFilter(filtered, "dateCreated", filter.created[0]);
    }
    if (filter.updated) {
      filtered = dateFilter(filtered, "dateUpdated", filter.updated[0]);
    }
  });
  return filtered;
}
