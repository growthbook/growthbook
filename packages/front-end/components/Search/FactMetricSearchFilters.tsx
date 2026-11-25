import React, { FC, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { useLingui } from "@lingui/react/macro";
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
    <Flex gap="5" align="center" wrap="wrap">
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
          return {
            name: <FactMetricTypeDisplayName type={type} />,
            id: type,
            searchValue: type,
          };
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
            item={t`Archived metrics`}
            exists={doesFilterExist("is", "archived", "")}
          />
        </DropdownMenuItem>
      </DropdownMenu>
    </Flex>
  );
};

export default FactMetricSearchFilters;
