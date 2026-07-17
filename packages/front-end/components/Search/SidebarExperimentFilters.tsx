import React, { ChangeEvent, FC, useMemo, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCaretRight, PiPlus, PiX } from "react-icons/pi";
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
export const EXPERIMENT_FILTER_KEYS = [
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

// A caller-supplied pill filter that isn't backed by the search string (e.g. a
// date-range picker writing to a block field). The component handles the pill /
// popover / category-list mechanics; the caller owns the value and the panel.
export interface ExtraFilter {
  key: string;
  heading: string;
  // Whether a pill is currently shown (i.e. the filter has a value).
  isActive: boolean;
  // Pill value text rendered after the heading (omit for none).
  label?: React.ReactNode;
  // Create the filter (with a sensible default) when picked from the category
  // list. The pill and its popover open immediately after.
  onAdd: () => void;
  // Clear the filter (called from the pill's remove button).
  onRemove: () => void;
  // Panel rendered inside the pill's popover (e.g. a date-range picker).
  renderPanel: () => React.ReactNode;
  // Panel width in px (defaults to the standard menu width).
  panelWidth?: number;
  // Keep the popover open when interacting with nested poppers (a Select
  // dropdown or calendar) that render in their own portals.
  keepOpenOnNestedPopper?: boolean;
}

interface Props {
  searchValue: string;
  setSearchValue: (value: string) => void;
  experiments: ExperimentInterfaceStringDates[];
  allowDrafts?: boolean;
  showStatusFilter?: boolean;
  // Set to false when the caller already renders a dedicated Project control
  // (e.g. a Projects multi-select above this filter list), so Project isn't
  // offered twice.
  showProjectFilter?: boolean;
  // Additional non-search-string pill filters (e.g. date ranges).
  extraFilters?: ExtraFilter[];
  // Render the category list inline (no "Add filter" button) for wide surfaces
  // like the dashboard filter bar. Clicking a category still creates its pill
  // in place and opens the value panel.
  categoriesInline?: boolean;
  // Hide the built-in "Clear filters" link (the caller renders its own, e.g. in
  // a popover header).
  hideClearFilters?: boolean;
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
  showProjectFilter = true,
  extraFilters = [],
  categoriesInline = false,
  hideClearFilters = false,
}) => {
  const { searchTerm, syntaxFilters } = useMemo(
    () => transformQuery(searchValue, EXPERIMENT_FILTER_KEYS),
    [searchValue],
  );

  // This UI can only author plain filters (`field:value`). Negated (`!`) or
  // operator (`>`, `^`, ...) filters typed by hand elsewhere are kept separate:
  // they never satisfy a checkbox's checked state (a `tag:!checkout` must not
  // render as a checked "checkout"), and they render as their own read-only
  // chips below instead of being folded into a category chip.
  const isPlainFilter = (f: SyntaxFilter) => !f.negated && !f.operator;
  const plainFilters = useMemo(
    () => syntaxFilters.filter(isPlainFilter),
    [syntaxFilters],
  );
  const advancedFilters = useMemo(
    () => syntaxFilters.filter((f) => !isPlainFilter(f)),
    [syntaxFilters],
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

    if (showProjectFilter && !project && projects.length > 0) {
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
    showProjectFilter,
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

  // One chip per category (field): every field with selected values, plus a
  // draft field created on category click that has no values selected yet.
  // Only plain filters get a category chip; negated/operator filters render as
  // their own chips.
  const chipFields = useMemo(() => {
    const fields: string[] = [];
    plainFilters.forEach((f) => {
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
  }, [plainFilters, categoryByKey, draftField]);

  const extraByKey = useMemo(() => {
    const m = new Map<string, ExtraFilter>();
    extraFilters.forEach((f) => m.set(f.key, f));
    return m;
  }, [extraFilters]);

  // Keep a pill's popover open when the click lands inside a nested Radix
  // popper (e.g. a date-range Select dropdown or calendar) that portals out of
  // our content; a genuine outside click still dismisses.
  const keepOpenOnNestedPopper = (e: {
    target: EventTarget | null;
    preventDefault: () => void;
  }) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-radix-popper-content-wrapper]")) {
      e.preventDefault();
    }
  };

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
    // Also clear active extra (non-search-string) filters, e.g. date pickers.
    extraFilters.forEach((f) => {
      if (f.isActive) f.onRemove();
    });
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
    const extra = extraByKey.get(key);
    if (extra) {
      if (!extra.isActive) extra.onAdd();
      setActiveField(key);
      return;
    }
    setActiveField(key);
    setDraftField(plainFilters.some((f) => f.field === key) ? "" : key);
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
    const extra = extraByKey.get(field);
    if (extra) {
      extra.onRemove();
      if (activeField === field) setActiveField("");
      return;
    }
    const filter = plainFilters.find((f) => f.field === field);
    if (filter) removeFilter(filter);
    if (draftField === field) setDraftField("");
    if (activeField === field) setActiveField("");
  };

  // Renders a removable filter chip. In the default (popover) layout this is a
  // soft violet Badge; in the inline layout each chip is its own full-width
  // bordered row (matching the category rows) with a grayish background, violet
  // label, and a gray remove "X" aligned right like the category chevron.
  const renderChip = ({
    label,
    ariaLabel,
    onRemove,
    isTrigger,
  }: {
    label: React.ReactNode;
    ariaLabel: string;
    onRemove: () => void;
    isTrigger: boolean;
  }) => {
    if (categoriesInline) {
      return (
        <Flex
          align="center"
          justify="between"
          gap="2"
          px="2"
          py="2"
          className={isTrigger ? "cursor-pointer" : undefined}
          style={{
            width: "100%",
            borderBottom: "1px solid var(--gray-a5)",
          }}
        >
          <span style={{ color: "var(--violet-11)", minWidth: 0 }}>
            <Text
              size="small"
              weight="medium"
              whiteSpace="normal"
              overflowWrap="anywhere"
            >
              {label}
            </Text>
          </span>
          <Flex
            align="center"
            role="button"
            tabIndex={0}
            aria-label={ariaLabel}
            className="cursor-pointer"
            style={{ flexShrink: 0 }}
            onPointerDown={isTrigger ? (e) => e.stopPropagation() : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onKeyDown={(e) => activateOnKey(e, onRemove)}
          >
            <PiX size={12} color="var(--slate-9)" />
          </Flex>
        </Flex>
      );
    }

    const removeButton = (
      <IconButton
        size="1"
        variant="ghost"
        color="violet"
        radius="full"
        aria-label={ariaLabel}
        onPointerDown={isTrigger ? (e) => e.stopPropagation() : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <PiX size={12} />
      </IconButton>
    );

    return (
      <Badge
        color="violet"
        variant="soft"
        radius="small"
        className={isTrigger ? "cursor-pointer" : undefined}
        style={{ maxWidth: "100%", whiteSpace: "normal" }}
        label={
          <Flex align="center" gap="1">
            <Text
              size="small"
              whiteSpace="normal"
              weight="medium"
              overflowWrap="anywhere"
            >
              {label}
            </Text>
            {removeButton}
          </Flex>
        }
      />
    );
  };

  // The addable-category rows, shared by the "Add filter" popover and the inline
  // list. Categories that already have a pill are hidden (each field maps to a
  // single chip); a field with only a negated/operator filter has no category
  // pill, so it stays addable.
  const categoryRows = (
    <>
      {categories
        .filter(
          (c) =>
            !plainFilters.some((f) => f.field === c.key) &&
            c.key !== draftField,
        )
        .map((c) => (
          <Flex
            key={c.key}
            align="center"
            justify="between"
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
            <PiCaretRight size={12} color="var(--slate-9)" />
          </Flex>
        ))}
      {/* Extra (non-search-string) filters that aren't already active. */}
      {extraFilters
        .filter((f) => !f.isActive)
        .map((f) => (
          <Flex
            key={f.key}
            align="center"
            justify="between"
            px="2"
            py="2"
            role="button"
            tabIndex={0}
            className="cursor-pointer hover-highlight"
            style={{ borderRadius: 6 }}
            onClick={() => openCategory(f.key)}
            onKeyDown={(e) => activateOnKey(e, () => openCategory(f.key))}
          >
            <Text size="small">{f.heading}</Text>
            <PiCaretRight size={12} color="var(--slate-9)" />
          </Flex>
        ))}
    </>
  );

  // Category list ("Add filter" view): a flat list of categories that drills
  // into the selected category's pill panel.
  const categoryListView = (
    // Outer box owns the scroll (and thus the scrollbar), so it sits flush
    // against the popover edge. Inner box holds the padding, keeping the gap
    // between the scrollbar and the content instead.
    <Box style={{ width: 248, maxHeight: 360, overflowY: "auto" }}>
      <Box style={{ padding: "6px 8px" }}>{categoryRows}</Box>
    </Box>
  );

  // Panel rendered inside an extra filter's pill popover: back arrow header +
  // the caller-supplied content (e.g. a date-range picker).
  const renderExtraPanel = (extra: ExtraFilter) => (
    <Box style={{ width: extra.panelWidth ?? 248 }}>
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
            {extra.heading}
          </Text>
        </Flex>
        <Box px="1" pb="1">
          {extra.renderPanel()}
        </Box>
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
              <Box px="2" py="1">
                <Text size="small" color="text-low">
                  No options
                </Text>
              </Box>
            )}
            {items.map((item) => {
              // Only plain filters can check a box — a negated `tag:!checkout`
              // must not render as a checked "checkout".
              const exists = plainFilters.some(
                (f) =>
                  f.field === category.key &&
                  f.values.some(
                    (v) => v.toLowerCase() === item.searchValue.toLowerCase(),
                  ),
              );
              const selectItem = () => {
                if (item.disabled) return;
                // If a hand-typed negated filter already excludes this exact
                // value, checking the box lifts the exclusion instead of
                // appending a contradictory `tag:!x tag:x` (zero results).
                const negatedMatch = advancedFilters.find(
                  (f) =>
                    f.field === category.key &&
                    f.negated &&
                    f.values.some(
                      (v) => v.toLowerCase() === item.searchValue.toLowerCase(),
                    ),
                );
                if (negatedMatch) {
                  const remaining = negatedMatch.values.filter(
                    (v) => v.toLowerCase() !== item.searchValue.toLowerCase(),
                  );
                  const tokens = syntaxFilters
                    .filter((f) => f !== negatedMatch)
                    .map(filterToString);
                  if (remaining.length > 0) {
                    tokens.push(
                      filterToString({ ...negatedMatch, values: remaining }),
                    );
                  }
                  const joined = tokens.join(" ");
                  setSearchValue(
                    joined
                      ? searchTerm
                        ? `${joined} ${searchTerm}`
                        : joined
                      : searchTerm,
                  );
                  return;
                }
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

      <Flex
        direction={categoriesInline ? "column" : "row"}
        align={categoriesInline ? "stretch" : "center"}
        gap={categoriesInline ? "0" : "2"}
        wrap={categoriesInline ? "nowrap" : "wrap"}
      >
        {chipFields.map((field) => {
          const category = categoryByKey.get(field);
          if (!category) return null;
          const filter = plainFilters.find((f) => f.field === field);
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
              trigger={renderChip({
                label: `${category.heading}${valueText ? `: ${valueText}` : ""}`,
                ariaLabel: `Remove ${category.heading} filter`,
                onRemove: () => removeChip(field),
                isTrigger: true,
              })}
              content={renderFilterPanel(category)}
            />
          );
        })}

        {/* Hand-typed negated/operator filters this UI can't author. Rendered
            as read-only chips (no popover panel): "Not Tag: checkout" for a
            plain negation, or the raw token for operator filters. The X strips
            exactly that filter from the search string. */}
        {advancedFilters.map((filter, i) => {
          const heading = categoryByKey.get(filter.field)?.heading;
          const label =
            filter.negated && !filter.operator && heading
              ? `Not ${heading}: ${filter.values
                  .map((v) => labelFor(filter.field, v))
                  .join(", ")}`
              : filterToString(filter);
          return (
            <React.Fragment key={`advanced-${filter.field}-${i}`}>
              {renderChip({
                label,
                ariaLabel: `Remove ${label} filter`,
                onRemove: () => removeFilter(filter),
                isTrigger: false,
              })}
            </React.Fragment>
          );
        })}

        {/* Extra (non-search-string) filter pills, e.g. date ranges. */}
        {extraFilters
          .filter((f) => f.isActive)
          .map((extra) => (
            <Popover
              key={extra.key}
              open={activeField === extra.key}
              onOpenChange={(o) => {
                if (o) {
                  setActiveField(extra.key);
                } else {
                  closeActiveField();
                }
              }}
              showArrow={false}
              align="start"
              contentStyle={{ padding: 0 }}
              onFocusOutside={(e) => e.preventDefault()}
              onInteractOutside={
                extra.keepOpenOnNestedPopper
                  ? keepOpenOnNestedPopper
                  : undefined
              }
              trigger={
                <Badge
                  color="violet"
                  variant="soft"
                  radius="small"
                  className="cursor-pointer"
                  style={{ maxWidth: "100%", whiteSpace: "normal" }}
                  label={
                    <Flex align="center" gap="1">
                      <Text
                        size="small"
                        whiteSpace="normal"
                        overflowWrap="anywhere"
                      >
                        <Text as="span" size="small" color="text-low">
                          {extra.heading}
                        </Text>
                        {extra.label ? <>: {extra.label}</> : ""}
                      </Text>
                      <IconButton
                        size="1"
                        variant="ghost"
                        color="violet"
                        radius="full"
                        aria-label={`Remove ${extra.heading} filter`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeChip(extra.key);
                        }}
                      >
                        <PiX size={12} />
                      </IconButton>
                    </Flex>
                  }
                />
              }
              content={renderExtraPanel(extra)}
            />
          ))}

        {!categoriesInline && (
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
        )}

        {!hideClearFilters &&
          (chipFields.length > 0 ||
            advancedFilters.length > 0 ||
            extraFilters.some((f) => f.isActive)) && (
            <Link
              size="1"
              onClick={clearFilters}
              style={{ whiteSpace: "nowrap" }}
            >
              Clear filters
            </Link>
          )}
      </Flex>

      {categoriesInline && (
        <Box style={{ maxHeight: 260, overflowY: "auto" }}>{categoryRows}</Box>
      )}
    </Flex>
  );
};

export default SidebarExperimentFilters;
