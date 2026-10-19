import React, { FC, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import type { ApiPopulation } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import {
  BaseSearchFiltersProps,
  FilterDropdown,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";

const PopulationSearchFilters: FC<
  BaseSearchFiltersProps & {
    populations: Pick<ApiPopulation, "datasource" | "owner" | "userIdTypes">[];
  }
> = ({ searchInputProps, syntaxFilters, populations, setSearchValue }) => {
  const { dropdownFilterOpen, setDropdownFilterOpen, projects, updateQuery } =
    useSearchFiltersBase({
      searchInputProps,
      syntaxFilters,
      setSearchValue,
    });
  const { datasources } = useDefinitions();
  const { getOwnerDisplay } = useUser();

  const usedDatasources = useMemo(
    () =>
      datasources.filter((d) => populations.some((p) => p.datasource === d.id)),
    [datasources, populations],
  );

  const owners = useMemo(() => {
    const owners = new Set<string>();
    populations.forEach((p) => {
      if (p.owner) owners.add(getOwnerDisplay(p.owner));
    });
    return Array.from(owners).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [populations, getOwnerDisplay]);

  const identifierTypes = useMemo(() => {
    const identifierTypes = new Set<string>();
    populations.forEach((p) =>
      p.userIdTypes.forEach((t) => identifierTypes.add(t)),
    );
    return Array.from(identifierTypes).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [populations]);

  return (
    <Flex gap="5" align="center" wrap="wrap">
      <FilterDropdown
        filter="datasource"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={usedDatasources.map((d) => ({
          name: d.name,
          id: d.id,
          searchValue: d.name,
        }))}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="project"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={projects.map((p) => ({
          name: p.name,
          id: p.id,
          searchValue: p.name,
        }))}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="owner"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={owners.map((o) => ({ name: o, id: o, searchValue: o }))}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="identifier"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={identifierTypes.map((t) => ({ name: t, id: t, searchValue: t }))}
        updateQuery={updateQuery}
        menuPlacement="end"
      />
    </Flex>
  );
};

export default PopulationSearchFilters;
