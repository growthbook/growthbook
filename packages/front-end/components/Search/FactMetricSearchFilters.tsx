import React, { FC, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { metricTypeValidator } from "shared/validators";
import { FactMetricInterface } from "shared/types/fact-table";
import { useUser } from "@/services/UserContext";
import Tag from "@/components/Tags/Tag";
import FactMetricTypeDisplayName from "@/components/Metrics/FactMetricTypeDisplayName";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import {
  BaseSearchFiltersProps,
  FilterDropdown,
  FilterHeading,
  FilterItem,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";

const metricTypes = metricTypeValidator.options;

const FactMetricSearchFilters: FC<
  BaseSearchFiltersProps & { factMetrics: FactMetricInterface[] }
> = ({ searchInputProps, syntaxFilters, factMetrics, setSearchValue }) => {
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
  const { getOwnerDisplay } = useUser();

  const availableTags = useMemo(() => {
    const availableTags: string[] = [];
    factMetrics.forEach((m) => {
      m.tags?.forEach((tag) => {
        if (!availableTags.includes(tag)) {
          availableTags.push(tag);
        }
      });
    });
    return availableTags;
  }, [factMetrics]);

  const owners = useMemo(() => {
    const owners = new Set<string>();
    factMetrics.forEach((m) => {
      if (m.owner) {
        owners.add(getOwnerDisplay(m.owner));
      }
    });
    return Array.from(owners).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [factMetrics, getOwnerDisplay]);

  const hasArchivedMetrics = factMetrics.some((m) => m.archived);

  return (
    <Flex gap="5" align="center">
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
          return {
            name: <FactMetricTypeDisplayName type={t} />,
            id: t,
            searchValue: t,
          };
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
          disabled={
            !hasArchivedMetrics && !doesFilterExist("is", "archived", "")
          }
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
      </DropdownMenu>
    </Flex>
  );
};

export default FactMetricSearchFilters;
