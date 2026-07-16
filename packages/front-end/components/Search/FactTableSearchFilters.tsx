import React, { FC, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { FactTableInterface } from "shared/types/fact-table";
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

const FactTableSearchFilters: FC<
  BaseSearchFiltersProps & {
    factTables: Pick<
      FactTableInterface,
      "tags" | "owner" | "archived" | "userIdTypes"
    >[];
  }
> = ({ searchInputProps, syntaxFilters, factTables, setSearchValue }) => {
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

  const availableTags = useMemo(() => {
    const availableTags: string[] = [];
    factTables.forEach((t) => {
      t.tags?.forEach((tag) => {
        if (!availableTags.includes(tag)) {
          availableTags.push(tag);
        }
      });
    });
    return availableTags;
  }, [factTables]);

  const owners = useMemo(() => {
    const owners = new Set<string>();
    factTables.forEach((t) => {
      if (t.owner) {
        owners.add(getOwnerDisplay(t.owner));
      }
    });
    return Array.from(owners).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [factTables, getOwnerDisplay]);

  const identifierTypes = useMemo(() => {
    const identifierTypes = new Set<string>();
    factTables.forEach((t) => {
      t.userIdTypes?.forEach((type) => {
        identifierTypes.add(type);
      });
    });
    return Array.from(identifierTypes).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [factTables]);

  const hasArchivedFactTables = factTables.some((t) => t.archived);

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
        filter="identifier"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={identifierTypes.map((t) => {
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
            item="Official fact tables"
            exists={doesFilterExist("is", "official", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={
            !hasArchivedFactTables && !doesFilterExist("is", "archived", "")
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
            item="Archived fact tables"
            exists={doesFilterExist("is", "archived", "")}
          />
        </DropdownMenuItem>
      </DropdownMenu>
    </Flex>
  );
};

export default FactTableSearchFilters;
