import { FC, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import {
  BaseSearchFiltersProps,
  FilterHeading,
  FilterItem,
  FilterDropdown,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { useUser } from "@/services/UserContext";

const TYPE_OPTIONS = [
  { name: "String", id: "string", searchValue: "string" },
  { name: "JSON", id: "json", searchValue: "json" },
];

const ConstantSearchFilters: FC<
  BaseSearchFiltersProps & {
    constants: { owner?: string; archived?: boolean }[];
    hasArchived: boolean;
    hasDraftStates: boolean;
  }
> = ({
  searchInputProps,
  syntaxFilters,
  setSearchValue,
  constants,
  hasArchived,
  hasDraftStates,
}) => {
  const {
    dropdownFilterOpen,
    setDropdownFilterOpen,
    project,
    projects,
    updateQuery,
    doesFilterExist,
  } = useSearchFiltersBase({ searchInputProps, syntaxFilters, setSearchValue });
  const { getOwnerDisplay } = useUser();

  const owners = useMemo(() => {
    const set = new Set<string>();
    constants.forEach((c) => {
      if (c.owner) set.add(getOwnerDisplay(c.owner));
    });
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [constants, getOwnerDisplay]);

  return (
    <Flex gap="5" align="center">
      {!project && (
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
          menuPlacement="end"
        />
      )}
      <FilterDropdown
        filter="type"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={TYPE_OPTIONS}
        updateQuery={updateQuery}
        menuPlacement="end"
      />
      <FilterDropdown
        filter="owner"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={owners.map((o) => ({ name: o, id: o, searchValue: o }))}
        updateQuery={updateQuery}
        menuPlacement="end"
      />
      <DropdownMenu
        trigger={FilterHeading({
          heading: "more",
          open: dropdownFilterOpen === "more",
        })}
        open={dropdownFilterOpen === "more"}
        menuPlacement="end"
        variant="soft"
        onOpenChange={(o) => setDropdownFilterOpen(o ? "more" : "")}
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
          }}
        >
          <FilterItem
            item="Archived constants"
            exists={doesFilterExist("is", "archived", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasDraftStates}
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
            item="Has active draft"
            exists={doesFilterExist("has", "draft", "")}
          />
        </DropdownMenuItem>
      </DropdownMenu>
    </Flex>
  );
};

export default ConstantSearchFilters;
