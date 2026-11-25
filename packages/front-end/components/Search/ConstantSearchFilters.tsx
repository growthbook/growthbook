import { FC, useMemo } from "react";
import { useLingui } from "@lingui/react/macro";
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

const ConstantSearchFilters: FC<
  BaseSearchFiltersProps & {
    constants: { owner?: string; archived?: boolean }[];
    hasArchived: boolean;
  }
> = ({
  searchInputProps,
  syntaxFilters,
  setSearchValue,
  constants,
  hasArchived,
}) => {
  const {
    dropdownFilterOpen,
    setDropdownFilterOpen,
    project,
    projects,
    updateQuery,
    doesFilterExist,
  } = useSearchFiltersBase({ searchInputProps, syntaxFilters, setSearchValue });
  const { t } = useLingui();
  const { getOwnerDisplay } = useUser();

  const typeOptions = useMemo(
    () => [
      { name: t`String`, id: "string", searchValue: "string" },
      { name: "JSON", id: "json", searchValue: "json" },
    ],
    [t],
  );

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
          heading={t`project`}
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
        heading={t`type`}
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={typeOptions}
        updateQuery={updateQuery}
        menuPlacement="end"
      />
      <FilterDropdown
        filter="owner"
        heading={t`owner`}
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={owners.map((o) => ({ name: o, id: o, searchValue: o }))}
        updateQuery={updateQuery}
        menuPlacement="end"
      />
      <DropdownMenu
        trigger={FilterHeading({
          heading: t`more`,
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
            item={t`Archived Constants`}
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
            item={t`Has active draft`}
            exists={doesFilterExist("has", "draft", "")}
          />
        </DropdownMenuItem>
      </DropdownMenu>
    </Flex>
  );
};

export default ConstantSearchFilters;
