import React, { FC, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { SDKAttribute } from "shared/types/organization";
import { attributeDataTypes } from "shared/constants";
import {
  BaseSearchFiltersProps,
  FilterDropdown,
  FilterItem,
  FilterHeading,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Tag from "@/components/Tags/Tag";

export type AttributeWithId = SDKAttribute & {
  id: string;
  projectNames?: string[];
};

const AttributeSearchFilters: FC<
  BaseSearchFiltersProps & {
    attributes: AttributeWithId[];
    hasArchived: boolean;
  }
> = ({
  searchInputProps,
  syntaxFilters,
  attributes,
  setSearchValue,
  hasArchived,
}) => {
  const {
    dropdownFilterOpen,
    setDropdownFilterOpen,
    project,
    projects,
    updateQuery,
    doesFilterExist,
  } = useSearchFiltersBase({
    searchInputProps,
    syntaxFilters,
    setSearchValue,
  });

  const availableDatatypes = useMemo(() => {
    const types = new Set<string>();
    attributes.forEach((attr) => types.add(attr.datatype));
    return attributeDataTypes.map((dt) => ({
      name: dt,
      id: "datatype-" + dt,
      searchValue: dt,
      disabled: !types.has(dt),
    }));
  }, [attributes]);

  const availableTags = useMemo(() => {
    const tags: string[] = [];
    attributes.forEach((attr) => {
      (attr.tags || []).forEach((tag) => {
        if (!tags.includes(tag)) tags.push(tag);
      });
    });
    return tags;
  }, [attributes]);

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
        />
      )}
      <FilterDropdown
        filter="datatype"
        heading="data type"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={availableDatatypes}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="tag"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={availableTags.map((t) => ({
          name: <Tag tag={t} key={t} skipMargin={true} variant="dot" />,
          id: t,
          searchValue: t,
        }))}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="identifier"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={[
          { searchValue: "yes", id: "identifier-yes", name: "Yes" },
          { searchValue: "no", id: "identifier-no", name: "No" },
        ]}
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
          }}
        >
          <FilterItem
            item="Archived attributes"
            exists={doesFilterExist("is", "archived", "")}
          />
        </DropdownMenuItem>
      </DropdownMenu>
    </Flex>
  );
};

export default AttributeSearchFilters;
