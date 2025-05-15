import React, {
  ChangeEvent,
  FC, Fragment,
  useCallback,
  useMemo,
  useRef,
  useState
} from "react";
import { Box, Flex, Heading, IconButton } from "@radix-ui/themes";
import { FaAngleDown, FaAngleUp, FaCheck } from "react-icons/fa";
import { FeatureInterface } from "back-end/types/feature";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@/components/Radix/DropdownMenu";
import { MetricTableItem } from "@/components/Metrics/MetricsList";
import { SearchTermFilterOperator, SyntaxFilter } from "@/services/search";
import Field from "@/components/Forms/Field";
import { useEnvironments } from "@/services/features";

// Common interfaces
interface SearchFiltersItem {
  id: string;
  name: string;
  searchValue: string;
  operator?: SearchTermFilterOperator;
  negated?: boolean;
  filter?: string;
  hr?: boolean;
}

interface BaseSearchFiltersProps {
  searchInputProps: {
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  };
  syntaxFilters: SyntaxFilter[];
  setSearchValue: (value: string) => void;
}

// Common FilterItem and FilterHeading components remain unchanged
const FilterHeading: FC<{
  heading: string;
  open: boolean;
}> = ({ heading, open }) => {
  return (
    <IconButton
      variant="ghost"
      color="gray"
      radius="small"
      size="3"
      highContrast
    >
      <Flex gap="2" align="center">
        <Flex gap="0" align="center">
          {heading}
        </Flex>
        {open ? <FaAngleUp /> : <FaAngleDown />}
      </Flex>
    </IconButton>
  );
};

const FilterItem: FC<{ item: string; exists: boolean }> = ({
  item,
  exists,
}) => {
  return (
    <Box className="position-relative">
      {exists ? (
        <Box
          className="position-absolute"
          style={{ left: "-2px", fontSize: "0.8rem" }}
        >
          <FaCheck />{" "}
        </Box>
      ) : (
        ""
      )}
      <Box pl="4">{item}</Box>
    </Box>
  );
};

// SearchFilterMenu component remains unchanged
const SearchFilterMenu: FC<{
  filter: string;
  items: SearchFiltersItem[];
  syntaxFilters: SyntaxFilter[];
  open: string;
  setOpen: (value: string) => void;
  updateQuery: (filter: SyntaxFilter) => void;
  operator?: string;
  heading?: string;
}> = ({
  filter,
  items,
  open,
  setOpen,
  updateQuery,
  syntaxFilters,
  operator = "",
  heading,
}) => {
  const [filterSearch, setFilterSearch] = useState<string>("");
  const showSearchFilter = useMemo(() => items.length > 10, [items]);
  const filteredItems = filterSearch
    ? items.filter(
        (i) =>
          i.name.toLowerCase().startsWith(filterSearch.toLowerCase()) ||
          i.name.toLowerCase().includes(filterSearch.toLowerCase())
      )
    : items;

  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <DropdownMenu
      trigger={FilterHeading({
        heading: heading ?? filter,
        open: open === filter,
      })}
      open={open === filter}
      onOpenChange={(o) => {
        setOpen(o ? filter : "");
      }}
    >
      <Box px="2" py="1" mb="1">
        <Heading as="h4" size="2" weight="bold" mb="0">
          Filter by {heading ?? filter}
        </Heading>
        {showSearchFilter && (
          <Field
            ref={inputRef}
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            type="search"
          />
        )}
      </Box>
      <Box overflowY="auto">
        {filteredItems.map((i) => (
          <Fragment key={i.id}>
            {i.hr && <Box my="2" style={{ borderBottom: "1px solid #ccc" }} />}
            <DropdownMenuItem
              key={i.id}
              onClick={() => {
                const f: SyntaxFilter = {
                  field: i?.filter ?? filter,
                  values: [i.searchValue],
                  operator: i?.operator ?? "",
                  negated: i?.negated ?? false,
                };
                updateQuery(f);
              }}
            >
              <FilterItem
                item={i.name}
                exists={doesFilterExistInSearch({
                  syntaxFilters,
                  field: i?.filter ?? filter,
                  value: i.searchValue,
                  operator: i?.operator ?? operator,
                })}
              />
            </DropdownMenuItem>
          </Fragment>
        ))}
      </Box>
    </DropdownMenu>
  );
};

// Helper function for checking if a filter exists
function doesFilterExistInSearch({
  syntaxFilters,
  field,
  value,
  operator,
  negated,
}: {
  syntaxFilters: SyntaxFilter[];
  field: string;
  value: string;
  operator?: string;
  negated?: boolean;
}): boolean {
  if (negated !== undefined && operator !== undefined) {
    return syntaxFilters.some(
      (filter) =>
        filter.field === field &&
        filter.operator === operator &&
        filter.values.includes(value) &&
        filter.negated === negated
    );
  }
  if (operator !== undefined) {
    return syntaxFilters.some(
      (filter) =>
        filter.field === field &&
        filter.operator === operator &&
        filter.values.includes(value)
    );
  } else {
    return syntaxFilters.some(
      (filter) => filter.field === field && filter.values.includes(value)
    );
  }
}

// Base hooks factory - creates common hooks for both components
const useSearchFiltersBase = ({
  searchInputProps,
  syntaxFilters,
  setSearchValue,
}: BaseSearchFiltersProps) => {
  const [dropdownFilterOpen, setDropdownFilterOpen] = useState("");
  const { projects } = useDefinitions();

  const filterToString = useCallback((filter: SyntaxFilter) => {
    return (
      filter.field +
      ":" +
      (filter.negated ? "!" : "") +
      filter.operator +
      filter.values
        .map((v) => {
          return v.includes(" ") ? '"' + v + '"' : v;
        })
        .join(",")
    );
  }, []);

  const addFilterToSearch = useCallback(
    (filter: SyntaxFilter) => {
      const term = filterToString(filter);
      setSearchValue(
        (searchInputProps.value.length > 0
          ? searchInputProps.value + " " + term
          : term
        ).trim()
      );
    },
    [filterToString, searchInputProps.value, setSearchValue]
  );

  const updateFilterToSearch = useCallback(
    (filter: SyntaxFilter) => {
      const term = filterToString(filter);
      const startsWith =
        filter.field + ":" + (filter.negated ? "!" : "") + filter.operator;
      const newValue = searchInputProps.value.replace(
        new RegExp(`${startsWith}(?:"[^"]*"|[^\\s])*`, "g"),
        term
      );
      setSearchValue(newValue.trim());
    },
    [filterToString, searchInputProps, setSearchValue]
  );

  const removeFilterToSearch = useCallback(
    (filter: SyntaxFilter) => {
      const startsWith =
        filter.field + ":" + (filter.negated ? "!" : "") + filter.operator;
      const newValue = searchInputProps.value.replace(
        new RegExp(`${startsWith}(?:"[^"]*"|[^\\s])*`, "g"),
        ""
      );
      setSearchValue(newValue.trim());
    },
    [searchInputProps.value, setSearchValue]
  );

  const updateQuery = useCallback(
    (filter: SyntaxFilter) => {
      const existingFilter = syntaxFilters.find(
        (f) =>
          f.field === filter.field &&
          f.operator === filter.operator &&
          f.negated === filter.negated
      );

      if (existingFilter) {
        const valueExists = existingFilter.values.some(
          (v) => v === filter.values[0]
        );

        if (valueExists) {
          existingFilter.values = existingFilter.values.filter(
            (v) => v !== filter.values[0]
          );

          if (existingFilter.values.length === 0) {
            removeFilterToSearch(existingFilter);
          } else {
            updateFilterToSearch(existingFilter);
          }
        } else {
          existingFilter.values = existingFilter.values.concat(filter.values);
          updateFilterToSearch(existingFilter);
        }
      } else {
        addFilterToSearch(filter);
      }
    },
    [
      syntaxFilters,
      addFilterToSearch,
      updateFilterToSearch,
      removeFilterToSearch,
    ]
  );

  return {
    dropdownFilterOpen,
    setDropdownFilterOpen,
    projects,
    updateQuery,
    doesFilterExist: useCallback(
      (field: string, value: string, operator?: string, negated?: boolean) =>
        doesFilterExistInSearch({
          syntaxFilters,
          field,
          value,
          operator,
          negated,
        }),
      [syntaxFilters]
    ),
  };
};

// Metric specific component
export const MetricSearchFilters: FC<
  BaseSearchFiltersProps & { combinedMetrics: MetricTableItem[] }
> = ({ searchInputProps, syntaxFilters, combinedMetrics, setSearchValue }) => {
  const {
    dropdownFilterOpen,
    setDropdownFilterOpen,
    projects,
    updateQuery,
    doesFilterExist,
  } = useSearchFiltersBase({
    searchInputProps,
    syntaxFilters,
    setSearchValue,
  });
  const { datasources } = useDefinitions();

  // Metric specific state
  const availableTags = useMemo(() => {
    const availableTags: string[] = [];
    combinedMetrics.forEach((item) => {
      if (item.tags) {
        item.tags.forEach((tag) => {
          if (!availableTags.includes(tag)) {
            availableTags.push(tag);
          }
        });
      }
    });
    return availableTags;
  }, [combinedMetrics]);

  const owners = useMemo(() => {
    const owners = new Set<string>();
    combinedMetrics.forEach((m) => {
      if (m.owner) {
        owners.add(m.owner);
      }
    });
    return Array.from(owners);
  }, [combinedMetrics]);

  const hasArchivedMetrics = combinedMetrics.some((m) => m.archived);
  const metricTypes = [
    "ratio",
    "binomial",
    "proportion",
    "mean",
    "duration",
    "revenue",
    "count",
  ];

  return (
    <Flex gap="5" align="center">
      <SearchFilterMenu
        filter="datasource"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={datasources.map((d) => {
          return { name: d.name, id: d.id, searchValue: d.name };
        })}
        updateQuery={updateQuery}
      />
      <SearchFilterMenu
        filter="project"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={projects.map((p) => {
          return { name: p.name, id: p.id, searchValue: p.name };
        })}
        updateQuery={updateQuery}
      />
      <SearchFilterMenu
        filter="owner"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={owners.map((o) => {
          return { name: o, id: o, searchValue: o };
        })}
        updateQuery={updateQuery}
      />
      <SearchFilterMenu
        filter="tag"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={availableTags.map((t) => {
          return { name: t, id: t, searchValue: t };
        })}
        updateQuery={updateQuery}
      />
      <SearchFilterMenu
        filter="type"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={metricTypes.map((t) => {
          return { name: t, id: t, searchValue: t };
        })}
        updateQuery={updateQuery}
      />

      <DropdownMenu
        trigger={FilterHeading({
          heading: "more",
          open: dropdownFilterOpen === "more",
        })}
        open={dropdownFilterOpen === "more"}
        onOpenChange={(o) => {
          setDropdownFilterOpen(o ? "more" : "");
        }}
      >
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "is",
              values: ["official"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Official metric"
            exists={doesFilterExist("is", "official", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasArchivedMetrics}
          onClick={() => {
            updateQuery({
              field: "is",
              values: ["archived"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Archived metric"
            exists={doesFilterExist("is", "archived", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "is",
              values: ["fact"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Fact metric"
            exists={doesFilterExist("is", "fact", "", false)}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "is",
              values: ["fact"],
              operator: "",
              negated: true,
            });
          }}
        >
          <FilterItem
            item="Non-fact metric"
            exists={doesFilterExist("is", "fact", "", true)}
          />
        </DropdownMenuItem>
      </DropdownMenu>
    </Flex>
  );
};

// Feature specific component
export const FeatureSearchFilters: FC<
  BaseSearchFiltersProps & {
    features: FeatureInterface[];
    hasArchived: boolean;
    setShowArchived: (value: boolean) => void;
  }
> = ({
  searchInputProps,
  syntaxFilters,
  features,
  setSearchValue,
  hasArchived,
  setShowArchived,
}) => {
  const {
    dropdownFilterOpen,
    setDropdownFilterOpen,
    projects,
    updateQuery,
    doesFilterExist,
  } = useSearchFiltersBase({
    searchInputProps,
    syntaxFilters,
    setSearchValue,
  });
  // get the environments:
  const environments = useEnvironments();

  // Feature specific state
  const availableTags = useMemo(() => {
    const availableTags: string[] = [];
    features.forEach((item) => {
      if (item.tags) {
        item.tags.forEach((tag) => {
          if (!availableTags.includes(tag)) {
            availableTags.push(tag);
          }
        });
      }
    });
    return availableTags;
  }, [features]);

  const owners = useMemo(() => {
    const owners = new Set<string>();
    features.forEach((f) => {
      if (f.owner) {
        owners.add(f.owner);
      }
    });
    return Array.from(owners);
  }, [features]);

  const onEnv = environments.map((e) => {
    return {
      searchValue: e.id,
      id: e.id,
      name: "On on " + e.id,
    };
  });
  const offEnv = environments.map((e, i) => {
    return {
      filter: "off",
      searchValue: e.id,
      id: e.id,
      name: "Off on " + e.id,
      hr: i === 0,
    };
  });
  // merge onEnv and offEnv:
  const allEnv = [...onEnv, ...offEnv];

  return (
    <Flex gap="5" align="center">
      <SearchFilterMenu
        filter="project"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={projects.map((p) => {
          return { name: p.name, id: p.id, searchValue: p.name };
        })}
        updateQuery={updateQuery}
      />
      <SearchFilterMenu
        filter="owner"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={owners.map((o) => {
          return { name: o, id: o, searchValue: o };
        })}
        updateQuery={updateQuery}
      />
      <SearchFilterMenu
        filter="tag"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={availableTags.map((t) => {
          return { name: t, id: t, searchValue: t };
        })}
        updateQuery={updateQuery}
      />
      <SearchFilterMenu
        filter="has"
        heading="rules"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={[
          {
            searchValue: "experiment",
            id: "hasExperiment",
            name: "has an experiment",
          },
          {
            searchValue: "rollout",
            id: "hasRollout",
            name: "has a rollout rule",
          },
          {
            searchValue: "force",
            id: "hasForce",
            name: "has an force rule",
          },
        ]}
        updateQuery={updateQuery}
      />
      <SearchFilterMenu
        filter="on"
        heading="environment"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={allEnv}
        updateQuery={updateQuery}
      />
      <DropdownMenu
        trigger={FilterHeading({
          heading: "more",
          open: dropdownFilterOpen === "more",
        })}
        open={dropdownFilterOpen === "more"}
        onOpenChange={(o) => {
          setDropdownFilterOpen(o ? "more" : "");
        }}
      >
        <DropdownMenuItem
          disabled={!hasArchived}
          onClick={() => {
            updateQuery({
              field: "is",
              values: ["archived"],
              operator: "",
              negated: false,
            });
            setShowArchived(!doesFilterExist("is", "archived"));
          }}
        >
          <FilterItem
            item="Archived features"
            exists={doesFilterExist("is", "archived", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "has",
              values: ["draft"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Has rule(s) in draft"
            exists={doesFilterExist("has", "draft", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "has",
              values: ["prereqs"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Has prerequisites"
            exists={doesFilterExist("has", "prereqs", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "is",
              values: ["stale"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Is stale"
            exists={doesFilterExist("is", "stale", "")}
          />
        </DropdownMenuItem>
      </DropdownMenu>
    </Flex>
  );
};
