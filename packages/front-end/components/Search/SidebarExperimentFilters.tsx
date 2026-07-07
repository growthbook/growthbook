import React, { ChangeEvent, FC, useMemo, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPlus, PiX } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Tag from "@/components/Tags/Tag";
import {
  filterToString,
  SearchFiltersItem,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { useExperimentFilterCategories } from "@/components/Search/experimentFilterCategories";
import { SyntaxFilter, transformQuery } from "@/services/search";
import { Popover } from "@/ui/Popover";
import Field from "@/components/Forms/Field";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";

// Activate a role="button" element on Enter/Space, matching native button keys.
function activateOnKey(e: React.KeyboardEvent, fn: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
}

// Filter keys this component understands, kept in sync with the syntax filters
// useExperimentSearch recognizes. Mirrors ExperimentSearchFilters so the parsed
// tokens map back onto the same categories.
const EXPERIMENT_FILTER_KEYS = [
  "project",
  "owner",
  "is",
  "status",
  "tag",
  "has",
];

type FilterCategory = {
  // Syntax field written into the search string (e.g. "is", "has").
  key: string;
  heading: string;
  items: SearchFiltersItem[];
};

interface Props {
  searchValue: string;
  setSearchValue: (value: string) => void;
  experiments: ExperimentInterfaceStringDates[];
  allowDrafts?: boolean;
  showStatusFilter?: boolean;
}

/**
 * Compact experiment filter builder used in narrow surfaces like the dashboard
 * block editor sidebar. Presents an "Add filter" menu plus removable chips
 * instead of a wide row of dropdowns, but writes into the exact same raw
 * search string (and therefore the same syntax filters) as
 * ExperimentSearchFilters — so backend parsing/filtering is unchanged and the
 * shared list-view component is untouched.
 */
const SidebarExperimentFilters: FC<Props> = ({
  searchValue,
  setSearchValue,
  experiments,
  allowDrafts = true,
  showStatusFilter = true,
}) => {
  const { searchTerm, syntaxFilters } = useMemo(
    () => transformQuery(searchValue, EXPERIMENT_FILTER_KEYS),
    [searchValue],
  );

  const searchInputProps = useMemo(
    () => ({ value: searchValue, onChange: () => {} }),
    [searchValue],
  );

  const { project, projects, updateQuery } = useSearchFiltersBase({
    searchInputProps,
    syntaxFilters,
    setSearchValue,
  });

  // "Add filter" popover (category list) open state.
  const [addOpen, setAddOpen] = useState(false);
  // Field whose pill popover is currently open (its filter panel). "" = none.
  const [activeField, setActiveField] = useState("");
  // A pill created on category click that has no selected values yet. Kept
  // separate from syntaxFilters (which only tracks fields with >=1 value) so the
  // pill can exist — and anchor the popover — before the first selection.
  const [draftField, setDraftField] = useState("");
  const [filterSearch, setFilterSearch] = useState("");

  // Shared source of truth for the filter taxonomy (see ExperimentSearchFilters).
  const { availableTags, owners, resultItems, statusItems, typeItems } =
    useExperimentFilterCategories({ experiments, allowDrafts });

  const categories = useMemo<FilterCategory[]>(() => {
    const cats: FilterCategory[] = [];

    if (!project && projects.length > 0) {
      cats.push({
        key: "project",
        heading: "Project",
        items: projects.map((p) => ({
          name: p.name,
          id: p.id,
          searchValue: p.name,
        })),
      });
    }

    cats.push({
      key: "owner",
      heading: "Owner",
      items: owners.map((o) => ({ name: o, id: o, searchValue: o })),
    });
    cats.push({ key: "is", heading: "Result", items: resultItems });

    if (showStatusFilter) {
      cats.push({ key: "status", heading: "Status", items: statusItems });
    }

    cats.push({
      key: "tag",
      heading: "Tag",
      items: availableTags.map((t) => ({
        name: <Tag tag={t} key={t} skipMargin={true} variant="dot" />,
        id: t,
        searchValue: t,
      })),
    });
    cats.push({ key: "has", heading: "Type", items: typeItems });

    return cats;
  }, [
    project,
    projects,
    owners,
    resultItems,
    statusItems,
    typeItems,
    availableTags,
    showStatusFilter,
  ]);

  const categoryByKey = useMemo(() => {
    const map = new Map<string, FilterCategory>();
    categories.forEach((c) => map.set(c.key, c));
    return map;
  }, [categories]);

  // Human-readable label for a chip value (falls back to the raw value).
  const labelFor = (field: string, value: string): string => {
    const category = categoryByKey.get(field);
    const item = category?.items.find(
      (i) => i.searchValue.toLowerCase() === value.toLowerCase(),
    );
    if (item && typeof item.name === "string") return item.name;
    return value;
  };

  // One chip per category (field): every field with selected values, plus a
  // draft field created on category click that has no values selected yet.
  const chipFields = useMemo(() => {
    const fields: string[] = [];
    syntaxFilters.forEach((f) => {
      if (categoryByKey.has(f.field) && !fields.includes(f.field)) {
        fields.push(f.field);
      }
    });
    if (
      draftField &&
      categoryByKey.has(draftField) &&
      !fields.includes(draftField)
    ) {
      fields.push(draftField);
    }
    return fields;
  }, [syntaxFilters, categoryByKey, draftField]);

  const handleFreeTextChange = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    const tokens = syntaxFilters.map(filterToString).join(" ");
    setSearchValue(tokens ? (text ? `${tokens} ${text}` : tokens) : text);
  };

  // Remove an entire category's filter (all of its values) at once.
  const removeFilter = (filter: SyntaxFilter) => {
    const tokens = syntaxFilters
      .filter((f) => f !== filter)
      .map(filterToString)
      .join(" ");
    setSearchValue(
      tokens ? (searchTerm ? `${tokens} ${searchTerm}` : tokens) : searchTerm,
    );
  };

  const clearFilters = () => {
    setSearchValue(searchTerm);
    setDraftField("");
    setActiveField("");
  };

  // Drill into a category from the "Add filter" list: create its pill (as a
  // draft when it has no values yet) and open that pill's popover, so the panel
  // anchors to the pill instead of the "Add filter" button and won't move as
  // more values are selected.
  const openCategory = (key: string) => {
    setAddOpen(false);
    setFilterSearch("");
    setActiveField(key);
    setDraftField(syntaxFilters.some((f) => f.field === key) ? "" : key);
  };

  // Back arrow: leave the pill panel and reopen the category list. Discards the
  // draft pill if the user never selected a value.
  const backToCategories = () => {
    setActiveField("");
    setDraftField("");
    setFilterSearch("");
    setAddOpen(true);
  };

  // Pill popover dismissed by an outside click.
  const closeActiveField = () => {
    setActiveField("");
    setDraftField("");
    setFilterSearch("");
  };

  // Remove a chip entirely: its filter values (if any) and its draft state.
  const removeChip = (field: string) => {
    const filter = syntaxFilters.find((f) => f.field === field);
    if (filter) removeFilter(filter);
    if (draftField === field) setDraftField("");
    if (activeField === field) setActiveField("");
  };

  // Category list ("Add filter" view): a flat list of categories that drills
  // into the selected category's pill panel.
  const categoryListView = (
    // Outer box owns the scroll (and thus the scrollbar), so it sits flush
    // against the popover edge. Inner box holds the padding, keeping the gap
    // between the scrollbar and the content instead.
    <Box style={{ width: 248, maxHeight: 360, overflowY: "auto" }}>
      <Box style={{ padding: "6px 8px" }}>
        {categories
          // Hide categories that already have a pill; each field maps to a
          // single chip, so it shouldn't be addable again.
          .filter((c) => !syntaxFilters.some((f) => f.field === c.key))
          .map((c) => (
            <Flex
              key={c.key}
              align="center"
              px="2"
              py="2"
              role="button"
              tabIndex={0}
              className="cursor-pointer hover-highlight"
              style={{ borderRadius: 6 }}
              onClick={() => openCategory(c.key)}
              onKeyDown={(e) => activateOnKey(e, () => openCategory(c.key))}
            >
              <Text size="small">{c.heading}</Text>
            </Flex>
          ))}
      </Box>
    </Box>
  );

  // Filter panel ("Filter by X") rendered inside a pill's popover: back arrow,
  // search box, and a checkbox list for the category.
  const renderFilterPanel = (category: FilterCategory) => {
    const q = filterSearch.toLowerCase();
    const items = filterSearch
      ? category.items.filter((i) => {
          const haystack = typeof i.name === "string" ? i.name : i.searchValue;
          return haystack.toLowerCase().includes(q);
        })
      : category.items;
    return (
      <Box style={{ width: 248, maxHeight: 360, overflowY: "auto" }}>
        <Box style={{ padding: "6px 8px" }}>
          <Flex
            align="center"
            gap="1"
            px="2"
            py="1"
            mb="1"
            role="button"
            tabIndex={0}
            aria-label="Back to filters"
            className="cursor-pointer"
            style={{ borderRadius: 6 }}
            onClick={backToCategories}
            onKeyDown={(e) => activateOnKey(e, backToCategories)}
          >
            <Text size="small" weight="medium">
              Filter by {category.heading}
            </Text>
          </Flex>

          <Box px="1" pb="1">
            <Field
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              type="search"
              placeholder="Search..."
              autoFocus
              style={{ height: 30, fontSize: 13, padding: "0 8px" }}
            />
          </Box>

          <Box px="1" pb="1">
            {items.length === 0 && (
              <Box
                px="2"
                py="1"
                className="text-muted"
                style={{ fontSize: 13 }}
              >
                No options
              </Box>
            )}
            {items.map((item) => {
              const exists = syntaxFilters.some(
                (f) =>
                  f.field === category.key &&
                  f.values.some(
                    (v) => v.toLowerCase() === item.searchValue.toLowerCase(),
                  ),
              );
              const selectItem = () => {
                if (item.disabled) return;
                updateQuery({
                  field: category.key,
                  values: [item.searchValue],
                  operator: "",
                  negated: false,
                });
              };
              return (
                <Box
                  key={item.id}
                  px="2"
                  py="1"
                  className="hover-highlight"
                  style={{ borderRadius: 6 }}
                >
                  <Checkbox
                    size="sm"
                    weight="regular"
                    value={exists}
                    setValue={selectItem}
                    disabled={item.disabled}
                    label={item.name}
                    mb="0"
                  />
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    );
  };

  return (
    <Flex direction="column" gap="2">
      <Field
        placeholder="Search..."
        type="search"
        value={searchTerm}
        onChange={handleFreeTextChange}
      />

      <Flex align="center" gap="2" wrap="wrap">
        {chipFields.map((field) => {
          const category = categoryByKey.get(field);
          if (!category) return null;
          const filter = syntaxFilters.find((f) => f.field === field);
          const valueText = (filter?.values ?? [])
            .map((value) => labelFor(field, value))
            .join(", ");
          return (
            <Popover
              key={field}
              // The popover anchors to this pill (not the "Add filter" button),
              // so it stays put as more values grow the pill.
              open={activeField === field}
              onOpenChange={(o) => {
                if (o) {
                  setActiveField(field);
                  setFilterSearch("");
                } else {
                  closeActiveField();
                }
              }}
              showArrow={false}
              align="start"
              contentStyle={{ padding: 0 }}
              // Toggling a checkbox blurs focus out of the popover, which Radix
              // would otherwise treat as a dismiss. Keep the menu open on focus
              // changes so users can select multiple items; a real outside
              // pointer-down still closes it.
              onFocusOutside={(e) => e.preventDefault()}
              trigger={
                <Badge
                  color="violet"
                  variant="soft"
                  radius="full"
                  className="cursor-pointer"
                  // Let the pill grow up to the container width and wrap its
                  // text instead of overflowing on long value lists.
                  style={{ maxWidth: "100%", whiteSpace: "normal" }}
                  label={
                    <Flex align="center" gap="1">
                      <Text
                        size="small"
                        whiteSpace="normal"
                        overflowWrap="anywhere"
                      >
                        <Text as="span" size="small" color="text-low">
                          {category.heading}
                        </Text>
                        {valueText ? `: ${valueText}` : ""}
                      </Text>
                      <IconButton
                        size="1"
                        variant="ghost"
                        color="violet"
                        radius="full"
                        aria-label={`Remove ${category.heading} filter`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeChip(field);
                        }}
                      >
                        <PiX size={12} />
                      </IconButton>
                    </Flex>
                  }
                />
              }
              content={renderFilterPanel(category)}
            />
          );
        })}

        <Popover
          open={addOpen}
          onOpenChange={(o) => {
            setAddOpen(o);
            if (!o) setFilterSearch("");
          }}
          showArrow={false}
          align="start"
          contentStyle={{ padding: 0 }}
          trigger={
            <Button variant="outline" size="xs">
              <Flex align="center" gap="1">
                <PiPlus size={12} />
                Add filter
              </Flex>
            </Button>
          }
          content={categoryListView}
        />

        {chipFields.length > 0 && (
          <Link
            size="1"
            onClick={clearFilters}
            style={{ whiteSpace: "nowrap" }}
          >
            Clear filters
          </Link>
        )}
      </Flex>
    </Flex>
  );
};

export default SidebarExperimentFilters;
