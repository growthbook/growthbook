import React, { ChangeEvent, FC, useMemo, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight, PiPlus, PiX } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Tag from "@/components/Tags/Tag";
import {
  FilterItem,
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
  "metric",
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

// Rebuild a `field:[!][op]value1,value2` token from a parsed filter, matching
// the serialization in useSearchFiltersBase so free-text edits preserve tokens.
function filterToToken(filter: SyntaxFilter): string {
  return (
    filter.field +
    ":" +
    (filter.negated ? "!" : "") +
    filter.operator +
    filter.values.map((v) => (v.includes(" ") ? '"' + v + '"' : v)).join(",")
  );
}

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

  const [open, setOpen] = useState(false);
  // Which category's panel is expanded inside the popover ("" = all collapsed).
  // Only one is open at a time (single-open accordion).
  const [expandedCategory, setExpandedCategory] = useState("");
  const [filterSearch, setFilterSearch] = useState("");

  // Shared source of truth for the filter taxonomy (see ExperimentSearchFilters).
  const {
    availableTags,
    metricItems,
    owners,
    resultItems,
    statusItems,
    typeItems,
  } = useExperimentFilterCategories({ experiments, allowDrafts });

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

    cats.push({ key: "metric", heading: "Metric", items: metricItems });
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
    metricItems,
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

  // One chip per category (field), even when multiple values are selected.
  const chipFilters = syntaxFilters.filter((f) => categoryByKey.has(f.field));

  const handleFreeTextChange = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    const tokens = syntaxFilters.map(filterToToken).join(" ");
    setSearchValue(tokens ? (text ? `${tokens} ${text}` : tokens) : text);
  };

  // Remove an entire category's filter (all of its values) at once.
  const removeFilter = (filter: SyntaxFilter) => {
    const tokens = syntaxFilters
      .filter((f) => f !== filter)
      .map(filterToToken)
      .join(" ");
    setSearchValue(
      tokens ? (searchTerm ? `${tokens} ${searchTerm}` : tokens) : searchTerm,
    );
  };

  const clearFilters = () => setSearchValue(searchTerm);

  const toggleCategory = (key: string) => {
    setExpandedCategory((prev) => (prev === key ? "" : key));
    setFilterSearch("");
  };

  // Items shown under the currently-expanded category, filtered by its search.
  const visibleItems = useMemo(() => {
    const category = categoryByKey.get(expandedCategory);
    if (!category) return [];
    if (!filterSearch) return category.items;
    const q = filterSearch.toLowerCase();
    return category.items.filter((i) => {
      const haystack = typeof i.name === "string" ? i.name : i.searchValue;
      return haystack.toLowerCase().includes(q);
    });
  }, [categoryByKey, expandedCategory, filterSearch]);

  const resetMenu = () => {
    setExpandedCategory("");
    setFilterSearch("");
  };

  const menuContent = (
    // Outer box owns the scroll (and thus the scrollbar), so it sits flush
    // against the popover edge. Inner box holds the padding, keeping the gap
    // between the scrollbar and the content instead.
    <Box style={{ width: 248, maxHeight: 360, overflowY: "auto" }}>
      <Box style={{ padding: "6px 8px" }}>
        {categories.map((c) => {
          const count =
            syntaxFilters.find((f) => f.field === c.key)?.values.length ?? 0;
          const isOpen = expandedCategory === c.key;
          const showCategorySearch = isOpen && c.items.length > 10;
          return (
            <Box key={c.key}>
              {/* Header (and per-category search) pin to the top while the
                  open section's options scroll under them. */}
              <Box
                style={{
                  position: isOpen ? "sticky" : undefined,
                  top: 0,
                  zIndex: isOpen ? 1 : undefined,
                  // Solid (opaque) so scrolling options don't leak through the
                  // pinned header + search box.
                  backgroundColor: isOpen
                    ? "var(--color-panel-solid)"
                    : undefined,
                }}
              >
                <Flex
                  align="center"
                  justify="between"
                  px="2"
                  py="1"
                  className="cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  style={{
                    borderRadius: 6,
                    marginBottom: 2,
                    backgroundColor: isOpen ? "var(--accent-3)" : undefined,
                    color: isOpen ? "var(--accent-11)" : undefined,
                  }}
                  onClick={() => toggleCategory(c.key)}
                  onKeyDown={(e) =>
                    activateOnKey(e, () => toggleCategory(c.key))
                  }
                >
                  <Flex align="center" gap="1">
                    {isOpen ? (
                      <PiCaretDown size={12} />
                    ) : (
                      <PiCaretRight size={12} className="text-muted" />
                    )}
                    <Text size="small" weight={isOpen ? "medium" : "regular"}>
                      {c.heading}
                    </Text>
                  </Flex>
                  {count > 0 && (
                    <Text size="small" color={isOpen ? undefined : "text-low"}>
                      {count}
                    </Text>
                  )}
                </Flex>
                {showCategorySearch && (
                  <Box px="2" pb="1">
                    <Field
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                      type="search"
                      placeholder={`Search ${c.heading}`}
                      autoFocus
                    />
                  </Box>
                )}
              </Box>

              {isOpen && (
                <Box pl="2" pb="1">
                  {visibleItems.length === 0 && (
                    <Box
                      px="2"
                      py="1"
                      className="text-muted"
                      style={{ fontSize: 13 }}
                    >
                      No options
                    </Box>
                  )}
                  {visibleItems.map((item) => {
                    const exists = syntaxFilters.some(
                      (f) =>
                        f.field === c.key &&
                        f.values.some(
                          (v) =>
                            v.toLowerCase() === item.searchValue.toLowerCase(),
                        ),
                    );
                    const selectItem = () => {
                      if (item.disabled) return;
                      updateQuery({
                        field: c.key,
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
                        role="button"
                        tabIndex={item.disabled ? -1 : 0}
                        aria-disabled={item.disabled || undefined}
                        aria-pressed={exists}
                        className={
                          item.disabled
                            ? "text-muted"
                            : "cursor-pointer hover-highlight"
                        }
                        style={{
                          borderRadius: 6,
                          opacity: item.disabled ? 0.5 : 1,
                          pointerEvents: item.disabled ? "none" : undefined,
                        }}
                        onClick={selectItem}
                        onKeyDown={(e) => activateOnKey(e, selectItem)}
                      >
                        <FilterItem item={item.name} exists={exists} />
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );

  return (
    <Flex direction="column" gap="2">
      <Field
        placeholder="Search..."
        type="search"
        value={searchTerm}
        onChange={handleFreeTextChange}
      />

      <Flex align="center" gap="2" wrap="wrap">
        {chipFilters.map((filter) => {
          const heading = categoryByKey.get(filter.field)?.heading;
          const valueText = filter.values
            .map((value) => labelFor(filter.field, value))
            .join(", ");
          return (
            <Badge
              key={filter.field}
              color="violet"
              variant="soft"
              radius="full"
              label={
                <Flex align="center" gap="1">
                  <Text size="small">
                    <Text as="span" color="text-low">
                      {heading}:
                    </Text>{" "}
                    {valueText}
                  </Text>
                  <IconButton
                    size="1"
                    variant="ghost"
                    color="violet"
                    radius="full"
                    aria-label={`Remove ${heading} filter`}
                    onClick={() => removeFilter(filter)}
                  >
                    <PiX size={12} />
                  </IconButton>
                </Flex>
              }
            />
          );
        })}

        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) resetMenu();
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
          content={menuContent}
        />

        {chipFilters.length > 0 && (
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
