import React, { FC, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { MetricTableItem } from "@/components/Metrics/MetricsList";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tag from "@/components/Tags/Tag";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import {
  BaseSearchFiltersProps,
  FilterDropdown,
  FilterHeading,
  FilterItem,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";

const MetricSearchFilters: FC<
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
      <FilterDropdown
        filter="datasource"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={datasources.map((d) => {
          return { name: d.name, id: d.id, searchValue: d.name };
        })}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="project"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={projects.map((p) => {
          return { name: p.name, id: p.id, searchValue: p.name };
        })}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="owner"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={owners.map((o) => {
          return { name: o, id: o, searchValue: o };
        })}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="tag"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={availableTags.map((t) => {
          return {
            name: <Tag tag={t} key={t} skipMargin={true} variant="dot" />,
            id: t,
            searchValue: t,
          };
        })}
        updateQuery={updateQuery}
      />
      <FilterDropdown
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
            item="Official metrics"
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
            item="Archived metrics"
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

export default MetricSearchFilters;
