import React, { FC, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { SDKAttribute } from "shared/types/organization";
import { CustomField } from "shared/types/custom-fields";
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
import { customFieldFilterValue } from "@/components/CustomFields/renderCustomFieldValue";

export type AttributeWithId = SDKAttribute & {
  id: string;
  projectNames?: string[];
};

const AttributeSearchFilters: FC<
  BaseSearchFiltersProps & {
    attributes: AttributeWithId[];
    hasArchived: boolean;
    customFields?: CustomField[];
  }
> = ({
  searchInputProps,
  syntaxFilters,
  attributes,
  setSearchValue,
  hasArchived,
  customFields = [],
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

  // Every dropdown offers only values some attribute actually carries, and a
  // dropdown with nothing left to offer is not rendered at all.
  const availableDatatypes = useMemo(() => {
    const types = new Set(attributes.map((attr) => attr.datatype));
    return attributeDataTypes
      .filter((dt) => types.has(dt))
      .map((dt) => ({ name: dt, id: "datatype-" + dt, searchValue: dt }));
  }, [attributes]);

  const availableProjects = useMemo(
    () =>
      projects.filter((p) =>
        attributes.some((attr) => attr.projects?.includes(p.id)),
      ),
    [attributes, projects],
  );

  const availableTags = useMemo(() => {
    const tags: string[] = [];
    attributes.forEach((attr) => {
      (attr.tags || []).forEach((tag) => {
        if (!tags.includes(tag)) tags.push(tag);
      });
    });
    return tags;
  }, [attributes]);

  const identifierItems = useMemo(
    () =>
      [
        { searchValue: "yes", id: "identifier-yes", name: "Yes" },
        { searchValue: "no", id: "identifier-no", name: "No" },
      ].filter(({ searchValue }) =>
        attributes.some(
          (attr) => !!attr.hashAttribute === (searchValue === "yes"),
        ),
      ),
    [attributes],
  );

  // Only fields with a known value set make sense as a dropdown; free-text
  // fields are still reachable via `<fieldId>:value` in the search box.
  const filterableCustomFields = useMemo(() => {
    const used = new Map<string, Set<string>>();
    attributes.forEach((attr) => {
      customFields.forEach((f) => {
        const values = customFieldFilterValue(
          f,
          attr.customFields?.[f.id] ?? "",
        );
        const set = used.get(f.id) ?? new Set<string>();
        (Array.isArray(values) ? values : [values]).forEach((v) => {
          if (v) set.add(v.toLowerCase());
        });
        used.set(f.id, set);
      });
    });
    return customFields.flatMap((f) => {
      // Display casing matches the Identifier filter on the same bar; the
      // query value stays lowercase.
      const candidates =
        f.type === "boolean"
          ? [
              { name: "Yes", searchValue: "yes" },
              { name: "No", searchValue: "no" },
            ]
          : f.type === "enum" || f.type === "multiselect"
            ? (f.values ?? "")
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean)
                .map((v) => ({ name: v, searchValue: v }))
            : [];
      const values = candidates.filter((v) =>
        used.get(f.id)?.has(v.searchValue.toLowerCase()),
      );
      return values.length ? [{ field: f, values }] : [];
    });
  }, [attributes, customFields]);

  return (
    <Flex gap="5" align="center" wrap="wrap">
      {!project && availableProjects.length > 0 && (
        <FilterDropdown
          filter="project"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={availableProjects.map((p) => ({
            name: p.name,
            id: p.id,
            searchValue: p.name,
          }))}
          updateQuery={updateQuery}
        />
      )}
      {availableDatatypes.length > 0 && (
        <FilterDropdown
          filter="datatype"
          heading="data type"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={availableDatatypes}
          updateQuery={updateQuery}
        />
      )}
      {availableTags.length > 0 && (
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
      )}
      {identifierItems.length > 0 && (
        <FilterDropdown
          filter="identifier"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={identifierItems}
          updateQuery={updateQuery}
          exclusive
        />
      )}
      {filterableCustomFields.map(({ field, values }) => (
        <FilterDropdown
          key={field.id}
          filter={field.id.toLowerCase()}
          heading={field.name.toLowerCase()}
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={values.map(({ name, searchValue }) => ({
            name,
            id: `${field.id}-${searchValue}`,
            searchValue,
          }))}
          updateQuery={updateQuery}
          // A boolean has one answer per row, so yes/no act as radios.
          exclusive={field.type === "boolean"}
        />
      ))}
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
