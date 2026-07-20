import React, { ChangeEvent, FC, useMemo, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCaretRight, PiCaretDown, PiPlus, PiX } from "react-icons/pi";
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

// A caller-supplied filter that isn't backed by the search string (e.g. a
// date-range picker writing to a block field). The component owns the accordion
// row mechanics; the caller owns the value and the expanded panel.
export interface ExtraFilter {
  key: string;
  heading: string;
  // Whether the filter currently has a value.
  isActive: boolean;
  // Value text rendered after the heading (omit for none).
  label?: React.ReactNode;
  // Create the filter (with a sensible default) when the row is expanded.
  onAdd: () => void;
  // Clear the filter (called from the row's Clear link).
  onRemove: () => void;
  // Panel rendered inside the expanded row (e.g. a date-range picker).
  renderPanel: () => React.ReactNode;
  // Panel width in px (defaults to full width).
  panelWidth?: number;
  // Retained for API compatibility; unused now that panels render inline.
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
  // Additional non-search-string filters (e.g. date ranges), appended as their
  // own accordion rows below the search-string categories.
  extraFilters?: ExtraFilter[];
  // Lock the experiment search string: the free-text box and search-string
  // categories become read-only (values are shown but can't be added or
  // removed). Used when a block follows the dashboard's experiment search
  // filter. Any `extraFilters` (e.g. phase date pickers) stay fully editable.
  searchDisabled?: boolean;
}

// Design order for the search-string category rows.
const CATEGORY_ORDER = [
  "project",
  "metric",
  "is",
  "owner",
  "status",
  "tag",
  "has",
];

/**
 * Experiment filter builder used by the dashboard's global Experiment Filters
 * card and the per-block "Filter Experiments" field. Renders an accordion of
 * filter categories (Metric, Result, Owner, …); expanding a category reveals a
 * combobox that adds the chosen values as chips. All selections are written into
 * the same raw search string (and therefore the same syntax filters) as
 * ExperimentSearchFilters, so backend parsing/filtering is unchanged.
 */
const SidebarExperimentFilters: FC<Props> = ({
  searchValue,
  setSearchValue,
  experiments,
  allowDrafts = true,
  showStatusFilter = true,
  showProjectFilter = true,
  extraFilters = [],
  searchDisabled = false,
}) => {
  const { searchTerm, syntaxFilters } = useMemo(
    () => transformQuery(searchValue, EXPERIMENT_FILTER_KEYS),
    [searchValue],
  );

  // This UI can only author plain filters (`field:value`). Negated (`!`) or
  // operator (`>`, `^`, ...) filters typed by hand elsewhere are kept separate:
  // they never satisfy a category's selected state (a `tag:!checkout` must not
  // render as a selected "checkout"), and they render as their own read-only
  // chips instead of being folded into a category.
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

  // Which category row is expanded ("" = none).
  const [expandedField, setExpandedField] = useState("");
  // Which expanded category's combobox dropdown is open (driven by input focus).
  const [optionsOpenField, setOptionsOpenField] = useState("");
  // Text typed into the expanded category's combobox search.
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
    const byKey = new Map<string, FilterCategory>();
    const add = (c: FilterCategory) => byKey.set(c.key, c);

    if (showProjectFilter && !project && projects.length > 0) {
      add({
        key: "project",
        heading: "Project",
        items: projects.map((p) => ({
          name: p.name,
          id: p.id,
          searchValue: p.name,
        })),
      });
    }
    add({ key: "metric", heading: "Metric", items: metricItems });
    add({ key: "is", heading: "Result", items: resultItems });
    add({
      key: "owner",
      heading: "Owner",
      items: owners.map((o) => ({ name: o, id: o, searchValue: o })),
    });
    if (showStatusFilter) {
      add({ key: "status", heading: "Status", items: statusItems });
    }
    add({
      key: "tag",
      heading: "Tag",
      items: availableTags.map((t) => ({
        name: <Tag tag={t} key={t} skipMargin={true} variant="dot" />,
        id: t,
        searchValue: t,
      })),
    });
    add({ key: "has", heading: "Type", items: typeItems });

    return CATEGORY_ORDER.map((key) => byKey.get(key)).filter(
      (c): c is FilterCategory => !!c,
    );
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

  // Selected values (raw searchValues) for a category.
  const selectedValuesFor = (key: string): string[] =>
    plainFilters.find((f) => f.field === key)?.values ?? [];

  // Display node for a value (the item's name, which may carry an icon/tag).
  const labelNodeFor = (key: string, value: string): React.ReactNode => {
    const item = categoryByKey
      .get(key)
      ?.items.find((i) => i.searchValue.toLowerCase() === value.toLowerCase());
    return item ? item.name : value;
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

  // Add one value to a category. If a hand-typed negated filter already excludes
  // this exact value, lift the exclusion instead of appending a contradictory
  // `tag:!x tag:x` (which yields zero results).
  const addValue = (key: string, value: string) => {
    const negatedMatch = advancedFilters.find(
      (f) =>
        f.field === key &&
        f.negated &&
        f.values.some((v) => v.toLowerCase() === value.toLowerCase()),
    );
    if (negatedMatch) {
      const remaining = negatedMatch.values.filter(
        (v) => v.toLowerCase() !== value.toLowerCase(),
      );
      const tokens = syntaxFilters
        .filter((f) => f !== negatedMatch)
        .map(filterToString);
      if (remaining.length > 0) {
        tokens.push(filterToString({ ...negatedMatch, values: remaining }));
      }
      const joined = tokens.join(" ");
      setSearchValue(
        joined ? (searchTerm ? `${joined} ${searchTerm}` : joined) : searchTerm,
      );
      return;
    }
    updateQuery({ field: key, values: [value], operator: "", negated: false });
  };

  // Toggle one value off a category (updateQuery removes an existing value).
  const removeValue = (key: string, value: string) =>
    updateQuery({ field: key, values: [value], operator: "", negated: false });

  // Clear all selected values in a single category.
  const clearCategory = (key: string) => {
    const filter = plainFilters.find((f) => f.field === key);
    if (filter) removeFilter(filter);
  };

  const extraByKey = useMemo(() => {
    const m = new Map<string, ExtraFilter>();
    extraFilters.forEach((f) => m.set(f.key, f));
    return m;
  }, [extraFilters]);

  const hasAnyActive =
    syntaxFilters.length > 0 ||
    searchTerm.trim().length > 0 ||
    extraFilters.some((f) => f.isActive);

  // Clear everything: the whole search string and any active extra filters.
  const clearAll = () => {
    setSearchValue("");
    extraFilters.forEach((f) => {
      if (f.isActive) f.onRemove();
    });
    setExpandedField("");
    setOptionsOpenField("");
    setFilterSearch("");
  };

  // Expand/collapse an accordion row. Expanding an inactive extra filter seeds
  // its default value so its panel has something to edit.
  const toggleExpand = (key: string) => {
    setFilterSearch("");
    setOptionsOpenField("");
    if (expandedField === key) {
      setExpandedField("");
      return;
    }
    const extra = extraByKey.get(key);
    if (extra && !extra.isActive) extra.onAdd();
    setExpandedField(key);
  };

  // A small circular "+" affordance for empty rows.
  const plusCircle = (
    <Flex
      align="center"
      justify="center"
      style={{
        width: 15,
        height: 15,
        borderRadius: "50%",
        background: "var(--violet-9)",
        flexShrink: 0,
      }}
    >
      <PiPlus size={12} color="white" />
    </Flex>
  );

  // Right-side control for a row given its state.
  const rowControl = (expanded: boolean, count: number, locked: boolean) => {
    if (locked) return null;
    if (expanded) {
      return <PiCaretDown size={15} color="var(--violet-11)" aria-hidden />;
    }
    if (count > 0) {
      return <PiCaretRight size={15} color="var(--slate-11)" aria-hidden />;
    }
    return plusCircle;
  };

  const countBadge = (count: number) =>
    count > 0 ? (
      <Badge label={`${count}`} color="gray" variant="soft" radius="full" />
    ) : null;

  // A selected-value chip (gray pill with a remove ×), or read-only when locked.
  const valueChip = (
    label: React.ReactNode,
    onRemove: () => void,
    ariaLabel: string,
    readOnly: boolean,
  ) => (
    <Badge
      color="gray"
      variant="soft"
      radius="medium"
      style={{ maxWidth: "100%", whiteSpace: "normal" }}
      label={
        <Flex align="center" gap="1">
          <Text
            size="small"
            whiteSpace="normal"
            overflowWrap="anywhere"
            color="text-high"
          >
            {label}
          </Text>
          {!readOnly && (
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              radius="full"
              aria-label={ariaLabel}
              onClick={onRemove}
            >
              <PiX size={12} />
            </IconButton>
          )}
        </Flex>
      }
    />
  );

  // The combobox options for an expanded category (not-yet-selected values).
  // Rendered as popover content, so it overlays instead of pushing the accordion
  // open. The popover itself provides the border/background/shadow.
  const renderOptions = (category: FilterCategory) => {
    const selected = selectedValuesFor(category.key);
    const q = filterSearch.toLowerCase();
    const options = category.items.filter((item) => {
      const isSelected = selected.some(
        (v) => v.toLowerCase() === item.searchValue.toLowerCase(),
      );
      if (isSelected) return false;
      if (!q) return true;
      const haystack =
        typeof item.name === "string" ? item.name : item.searchValue;
      return haystack.toLowerCase().includes(q);
    });

    return (
      <Box style={{ maxHeight: 240, overflowY: "auto" }}>
        {options.length === 0 ? (
          <Box px="2" py="2">
            <Text size="small" color="text-low">
              No options
            </Text>
          </Box>
        ) : (
          <Box>
            {options.map((item) => (
              <Box
                key={item.id}
                px="2"
                py="1"
                role="button"
                tabIndex={item.disabled ? undefined : 0}
                aria-disabled={item.disabled}
                className={item.disabled ? undefined : "hover-highlight"}
                style={{
                  borderRadius: 6,
                  cursor: item.disabled ? "default" : "pointer",
                  opacity: item.disabled ? 0.5 : 1,
                }}
                // Keep the combobox input focused so the dropdown stays open
                // across multiple selections.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (item.disabled) return;
                  addValue(category.key, item.searchValue);
                }}
                onKeyDown={(e) =>
                  !item.disabled &&
                  activateOnKey(e, () =>
                    addValue(category.key, item.searchValue),
                  )
                }
              >
                <Text size="small">{item.name}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  };

  // Expanded panel for a search-string category: combobox + selected chips +
  // Clear.
  const renderCategoryPanel = (category: FilterCategory) => {
    const selected = selectedValuesFor(category.key);
    const optionsOpen = optionsOpenField === category.key;
    return (
      <Box pb="3">
        <Popover
          anchorOnly
          open={optionsOpen}
          onOpenChange={(o) => {
            if (!o) setOptionsOpenField("");
          }}
          side="bottom"
          align="start"
          showArrow={false}
          // Keep focus in the search input when the dropdown opens, and don't
          // let Radix's own outside-click dismiss fire — closing is driven by
          // the input's blur below so re-clicking the input never closes it.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          contentStyle={{
            padding: 4,
            width: "var(--radix-popover-trigger-width)",
          }}
          trigger={
            // Full-width block so the anchor (and thus the width-matched
            // popover) spans the panel. The Popover applies an "unstyled
            // trigger" class (all:unset; inline-flex) to this element via
            // asChild, so display/width are set inline to win over it.
            <div style={{ display: "block", width: "100%" }}>
              <Field
                type="text"
                placeholder={`Search by ${category.heading.toLowerCase()} name...`}
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                onFocus={() => setOptionsOpenField(category.key)}
                onBlur={() => setOptionsOpenField("")}
              />
            </div>
          }
          content={renderOptions(category)}
        />
        {selected.length > 0 && (
          <Flex wrap="wrap" gap="1" mt="2">
            {selected.map((value) => (
              <React.Fragment key={value}>
                {valueChip(
                  labelNodeFor(category.key, value),
                  () => removeValue(category.key, value),
                  `Remove ${category.heading} ${value}`,
                  false,
                )}
              </React.Fragment>
            ))}
          </Flex>
        )}
        {selected.length > 0 && (
          <Box mt="2">
            <Link
              size="1"
              color="red"
              onClick={() => clearCategory(category.key)}
            >
              Clear
            </Link>
          </Box>
        )}
      </Box>
    );
  };

  // A single search-string category accordion row.
  const renderCategoryRow = (category: FilterCategory) => {
    const count = selectedValuesFor(category.key).length;
    // When locked by the dashboard, hide categories that have no value — only
    // the applied filters are relevant in the read-only state.
    if (searchDisabled && count === 0) return null;
    const expanded = expandedField === category.key;
    const clickable = !searchDisabled;
    return (
      <Box
        key={category.key}
        style={{ borderBottom: "1px solid var(--gray-a5)" }}
      >
        <Flex
          align="center"
          justify="between"
          py="3"
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          className={clickable ? "cursor-pointer" : undefined}
          onClick={clickable ? () => toggleExpand(category.key) : undefined}
          onKeyDown={
            clickable
              ? (e) => activateOnKey(e, () => toggleExpand(category.key))
              : undefined
          }
        >
          <Flex align="center" gap="2">
            <Text weight="medium" size="medium">
              {category.heading}
            </Text>
            {countBadge(count)}
          </Flex>
          {rowControl(expanded, count, searchDisabled)}
        </Flex>

        {expanded && !searchDisabled ? renderCategoryPanel(category) : null}

        {/* Locked by the dashboard: show the selected values read-only. */}
        {searchDisabled && count > 0 ? (
          <Flex wrap="wrap" gap="1" pb="3">
            {selectedValuesFor(category.key).map((value) => (
              <React.Fragment key={value}>
                {valueChip(
                  labelNodeFor(category.key, value),
                  () => {},
                  `${category.heading} ${value}`,
                  true,
                )}
              </React.Fragment>
            ))}
          </Flex>
        ) : null}
      </Box>
    );
  };

  // An extra (non-search-string) filter row, e.g. a phase date range. These
  // stay editable even when the experiment search is locked.
  const renderExtraRow = (extra: ExtraFilter) => {
    const expanded = expandedField === extra.key;
    const count = extra.isActive ? 1 : 0;
    return (
      <Box key={extra.key} style={{ borderBottom: "1px solid var(--gray-a5)" }}>
        <Flex
          align="center"
          justify="between"
          py="3"
          role="button"
          tabIndex={0}
          className="cursor-pointer"
          onClick={() => toggleExpand(extra.key)}
          onKeyDown={(e) => activateOnKey(e, () => toggleExpand(extra.key))}
        >
          <Flex align="center" gap="2" style={{ minWidth: 0 }}>
            <Text weight="medium" size="medium">
              {extra.heading}
            </Text>
            {extra.isActive && extra.label ? (
              <Text size="small" color="text-low" truncate>
                {extra.label}
              </Text>
            ) : null}
          </Flex>
          {rowControl(expanded, count, false)}
        </Flex>

        {expanded ? (
          <Box pb="3" style={{ maxWidth: extra.panelWidth }}>
            {extra.renderPanel()}
            {extra.isActive ? (
              <Box mt="2">
                <Link
                  size="1"
                  color="red"
                  onClick={() => {
                    extra.onRemove();
                    setExpandedField("");
                  }}
                >
                  Clear
                </Link>
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Box>
    );
  };

  return (
    <Flex direction="column" gap="0">
      <Flex align="center" justify="between" mb="2">
        <Text size="small" color="text-low">
          Filter by...
        </Text>
        {hasAnyActive && !searchDisabled ? (
          <Link size="1" color="red" onClick={clearAll}>
            Clear all
          </Link>
        ) : null}
      </Flex>

      <Field
        placeholder="Search..."
        type="search"
        value={searchTerm}
        onChange={handleFreeTextChange}
        disabled={searchDisabled}
      />

      {advancedFilters.length > 0 ? (
        <Flex wrap="wrap" gap="1" mt="2">
          {advancedFilters.map((filter, i) => {
            const heading = categoryByKey.get(filter.field)?.heading;
            const label =
              filter.negated && !filter.operator && heading
                ? `Not ${heading}: ${filter.values.join(", ")}`
                : filterToString(filter);
            return (
              <React.Fragment key={`advanced-${filter.field}-${i}`}>
                {valueChip(
                  label,
                  () => removeFilter(filter),
                  `Remove ${label} filter`,
                  searchDisabled,
                )}
              </React.Fragment>
            );
          })}
        </Flex>
      ) : null}

      <Box mt="3">
        {categories.map(renderCategoryRow)}
        {extraFilters.map(renderExtraRow)}
      </Box>
    </Flex>
  );
};

export default SidebarExperimentFilters;
