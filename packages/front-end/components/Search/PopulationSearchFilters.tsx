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
    populations: Pick<
      ApiPopulation,
      "datasource" | "owner" | "userIdTypes" | "projects"
    >[];
  }
> = ({ searchInputProps, syntaxFilters, populations, setSearchValue }) => {
  const {
    dropdownFilterOpen,
    setDropdownFilterOpen,
    project,
    projects,
    updateQuery,
  } = useSearchFiltersBase({
    searchInputProps,
    syntaxFilters,
    setSearchValue,
  });
  const { datasources } = useDefinitions();
  const { getOwnerDisplay } = useUser();

  // Every dropdown offers only values some Population carries, and a dropdown
  // with nothing to offer is not rendered.
  const usedDatasources = useMemo(
    () =>
      datasources.filter((d) => populations.some((p) => p.datasource === d.id)),
    [datasources, populations],
  );

  // A Population with no Projects is in all of them, so it makes every Project
  // a useful filter.
  const usedProjects = useMemo(
    () =>
      populations.some((p) => !p.projects.length)
        ? projects
        : projects.filter((proj) =>
            populations.some((p) => p.projects.includes(proj.id)),
          ),
    [projects, populations],
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
      {usedDatasources.length > 0 && (
        <FilterDropdown
          filter="datasource"
          heading="Data Source"
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
      )}
      {!project && usedProjects.length > 0 && (
        <FilterDropdown
          filter="project"
          heading="Project"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={usedProjects.map((p) => ({
            name: p.name,
            id: p.id,
            searchValue: p.name,
          }))}
          updateQuery={updateQuery}
        />
      )}
      {owners.length > 0 && (
        <FilterDropdown
          filter="owner"
          heading="Owner"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={owners.map((o) => ({ name: o, id: o, searchValue: o }))}
          updateQuery={updateQuery}
        />
      )}
      {identifierTypes.length > 0 && (
        <FilterDropdown
          filter="identifier"
          heading="Identifier type"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={identifierTypes.map((t) => ({
            name: t,
            id: t,
            searchValue: t,
          }))}
          updateQuery={updateQuery}
          menuPlacement="end"
        />
      )}
    </Flex>
  );
};

export default PopulationSearchFilters;
