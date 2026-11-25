import React, { FC, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { useLingui } from "@lingui/react/macro";
import { MetricTableItem } from "@/components/Metrics/MetricsList";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
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
  const { t } = useLingui();
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
  const { getOwnerDisplay } = useUser();

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
        owners.add(getOwnerDisplay(m.owner));
      }
    });
    return Array.from(owners).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [combinedMetrics, getOwnerDisplay]);

  const hasArchivedMetrics = combinedMetrics.some((m) => m.archived);
  const metricTypes = [
    "ratio",
    "binomial",
    "proportion",
    "mean",
    "duration",
    "revenue",
    "count",
    "funnel",
    "compound",
  ];

  return (
    <Flex gap="5" align="center">
      <FilterDropdown
        filter="datasource"
        heading={t`datasource`}
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
        heading={t`project`}
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
        heading={t`owner`}
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
        heading={t`tag`}
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={availableTags.map((tag) => {
          return {
            name: <Tag tag={tag} key={tag} skipMargin={true} variant="dot" />,
            id: tag,
            searchValue: tag,
          };
        })}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="type"
        heading={t`type`}
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={metricTypes.map((type) => {
          return { name: type, id: type, searchValue: type };
        })}
        updateQuery={updateQuery}
      />

      <DropdownMenu
        trigger={FilterHeading({
          heading: t`more`,
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
            item={t`Official metrics`}
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
            item={t`Archived metrics`}
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
            item={t`Fact metric`}
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
            item={t`Non-fact metric`}
            exists={doesFilterExist("is", "fact", "", true)}
          />
        </DropdownMenuItem>
      </DropdownMenu>
    </Flex>
  );
};

export default MetricSearchFilters;
