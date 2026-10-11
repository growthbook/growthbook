import {
  ChangeEvent,
  FC,
  Fragment,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { FaAngleDown, FaAngleUp, FaCheck } from "react-icons/fa";
import { PiXBold } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import { SearchTermFilterOperator, SyntaxFilter } from "@/services/search";
import Field from "@/components/Forms/Field";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import Badge from "@/ui/Badge";
import Checkbox from "@/ui/Checkbox";

const USE_SEARCH_BOX = true;

// Serialize a parsed filter back into `field:[!][op]v1,v2` search-string syntax.
// Exported so other filter UIs (e.g. SidebarExperimentFilters) reuse the same
// round-trip format instead of re-implementing it.
export function filterToString(filter: SyntaxFilter): string {
  return (
    filter.field +
    ":" +
    (filter.negated ? "!" : "") +
    filter.operator +
    filter.values
      // Quote values containing spaces (token separators) or commas (value
      // separators) so they round-trip through the parser as a single value.
      .map((v) => (v.includes(" ") || v.includes(",") ? '"' + v + '"' : v))
      .join(",")
  );
}

// Regex matching one serialized filter token (`field:[!][op]values`) in the
// raw search string. The prefix is regex-escaped (operators like `^` are regex
// metacharacters), and a negative lookahead keeps a plain `field:` pattern
// from also swallowing `field:!...` / `field:>...` tokens for the same field.
function filterTokenRegex(filter: SyntaxFilter): RegExp {
  const prefix = (
    filter.field +
    ":" +
    (filter.negated ? "!" : "") +
    filter.operator
  ).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const guard = filter.operator
    ? ""
    : filter.negated
      ? "(?![><^~=])"
      : "(?![!><^~=])";
  return new RegExp(`${prefix}${guard}(?:"[^"]*"|[^\\s])*`, "g");
}

// Common interfaces
export interface SearchFiltersItem {
  id: string;
  name: string | JSX.Element;
  searchValue: string;
  operator?: SearchTermFilterOperator;
  negated?: boolean;
  filter?: string;
  hr?: boolean;
  disabled?: boolean;
}

export interface BaseSearchFiltersProps {
  searchInputProps: {
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  };
  syntaxFilters: SyntaxFilter[];
  setSearchValue: (value: string) => void;
}

export const FilterHeading: FC<{
  heading: string;
  open: boolean;
}> = ({ heading, open }) => {
  return (
    <IconButton
      variant="ghost"
      color="gray"
      radius="small"
      size="3"
      highContrast
    >
      <Flex gap="2" align="center">
        <Flex gap="0" align="center">
          {heading}
        </Flex>
        {open ? <FaAngleUp /> : <FaAngleDown />}
      </Flex>
    </IconButton>
  );
};

export const FilterItem: FC<{
  item: string | JSX.Element;
  exists: boolean;
  // A checkbox, as the column menu's (@/ui/Checkbox; set in review, the
  // experiments list's chip menus), in place of the check mark. Shown only:
  // the menu item takes the click, so it isn't toggled twice. Optional and
  // additive.
  checkbox?: boolean;
}> = ({ item, exists, checkbox = false }) => {
  if (checkbox) {
    return (
      // A flex box, centring it in the row: the checkbox's label is inline
      // text, whose line spacing would otherwise lift it off centre. The
      // box centred on its label too (align).
      <Box
        style={{
          pointerEvents: "none",
          minWidth: 0,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Checkbox
          align="center"
          size="sm"
          labelSize="sm"
          weight="regular"
          label={
            typeof item === "string" ? (
              <OverflowText>{item}</OverflowText>
            ) : (
              item
            )
          }
          value={exists}
          setValue={() => {}}
        />
      </Box>
    );
  }
  return (
    <Box className="position-relative">
      {exists ? (
        <Box
          className="position-absolute"
          style={{ left: "-2px", fontSize: "0.8rem" }}
        >
          <FaCheck />{" "}
        </Box>
      ) : (
        ""
      )}
      <Box pl="4">
        {typeof item === "string" ? <OverflowText>{item}</OverflowText> : item}
      </Box>
    </Box>
  );
};

// A filter chip's remove button (set in review; the experiments list): an
// 18px round button with a 12px ×, at the chip's right end, over the room
// the chip leaves for it. Its parent must be position: relative.
export const ChipRemoveButton: FC<{
  label: string;
  onClick: () => void;
}> = ({ label, onClick }) => (
  <button
    type="button"
    data-chip-remove
    aria-label={label}
    onClick={onClick}
    style={{
      position: "absolute",
      right: 3,
      top: "50%",
      transform: "translateY(-50%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 18,
      height: 18,
      padding: 0,
      border: "none",
      borderRadius: "var(--radius-full)",
      background: "none",
      color: "var(--gray-11)",
      cursor: "pointer",
    }}
  >
    <PiXBold size={12} aria-hidden />
  </button>
);

export const FilterDropdown: FC<{
  filter: string;
  items: SearchFiltersItem[];
  syntaxFilters: SyntaxFilter[];
  open: string;
  setOpen: (value: string) => void;
  updateQuery: (filter: SyntaxFilter) => void;
  operator?: string;
  heading?: string;
  menuPlacement?: "start" | "center" | "end";
  // The trigger as a chip (@/ui/Badge, set in review; the experiments
  // list) in place of the ghost heading: grey, with its name, and what's
  // applied while it's in use (see chipLabel). Optional
  // and additive.
  chip?: boolean;
  // With chip: a remove button at the chip's end (set in review), for the
  // filters that can come off the bar. Beside the menu's trigger, not in it
  // (a button can't hold another).
  onRemove?: () => void;
  // A class on the open menu, for hosts that restyle it. Optional and
  // additive.
  menuClassName?: string;
  // With chip: an icon before its name (set in review; e.g. Status and
  // Health on the experiments list). Optional and additive.
  chipIcon?: ReactNode;
  // With chip: only the chip's badge, with no menu (and its remove button
  // with onRemove), e.g. in the overflow chip's popover. Optional and
  // additive.
  labelOnly?: boolean;
}> = ({
  filter,
  items,
  open,
  setOpen,
  updateQuery,
  syntaxFilters,
  operator = "",
  heading,
  menuPlacement = "start",
  chip = false,
  onRemove,
  menuClassName,
  labelOnly = false,
  chipIcon,
}) => {
  const [filterSearch, setFilterSearch] = useState<string>("");
  const filterLabel = heading ?? filter;
  const showSearchFilter = useMemo(
    () => USE_SEARCH_BOX && items.length > 10,
    [items],
  );
  const filteredItems = useMemo(() => {
    if (!filterSearch) return items;
    const query = filterSearch.toLowerCase();
    return items.filter((i) => {
      const haystack = typeof i.name === "string" ? i.name : i.searchValue;
      return haystack.toLowerCase().includes(query);
    });
  }, [items, filterSearch]);

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open !== filter) {
      setFilterSearch("");
      return;
    }

    if (!showSearchFilter) return;

    const focusTimer = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(focusTimer);
  }, [filter, open, showSearchFilter]);

  // chip: the label names what's applied (set in review), e.g. "Health:
  // Unhealthy", or "Health: Unhealthy, +1" with more than one; just the
  // filter's name with none. An option's name is used when it's text, its
  // search value otherwise (e.g. a tag's chip). The chip's look doesn't
  // change.
  const applied = chip
    ? items.filter((i) =>
        doesFilterExistInSearch({
          syntaxFilters,
          field: i?.filter ?? filter,
          value: i.searchValue,
          operator: i?.operator ?? operator,
        }),
      )
    : [];
  // The name (and colon) in --slate-12, as Add Filter's text (set in
  // review); what's applied stays in the badge's grey. All at 400 (set in
  // review; the name was the badge's 500).
  // With chipIcon, the icon leads, 4px before the name, in --slate-12, as
  // Add Filter's icon (set in review; was --slate-11).
  const chipText = applied.length ? (
    <span style={{ fontWeight: 400 }}>
      <span style={{ color: "var(--slate-12)" }}>{filterLabel}:</span>{" "}
      <span>
        {typeof applied[0].name === "string"
          ? applied[0].name
          : applied[0].searchValue}
        {applied.length > 1 ? `, +${applied.length - 1}` : ""}
      </span>
    </span>
  ) : (
    <span style={{ color: "var(--slate-12)", fontWeight: 400 }}>
      {filterLabel}
    </span>
  );
  const chipLabel = chipIcon ? (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span
        aria-hidden
        style={{ display: "inline-flex", color: "var(--slate-12)" }}
      >
        {chipIcon}
      </span>
      {chipText}
    </span>
  ) : (
    chipText
  );

  const removable = chip && !!onRemove;

  if (chip && labelOnly) {
    // With onRemove, its remove button too (set in review; e.g. to take
    // filters off one by one in the overflow chip's popover).
    const badge = (
      <Badge
        variant="soft"
        color="gray"
        radius="full"
        size="md"
        label={chipLabel}
        // The pointer, as on the bar's chips (set in review).
        style={{
          cursor: "pointer",
          ...(removable ? { paddingRight: 26 } : {}),
        }}
      />
    );
    // Always in the chip wrapper, so it hovers as a chip on the bar does.
    return (
      <span
        data-chip-wrap
        style={{ position: "relative", display: "inline-flex" }}
      >
        {badge}
        {removable ? (
          <ChipRemoveButton
            label={`Remove ${filterLabel} filter`}
            onClick={onRemove}
          />
        ) : null}
      </span>
    );
  }

  const menu = (
    <DropdownMenu
      trigger={
        chip ? (
          // No caret (set in review). With a remove button, room for it at
          // the end. In a plain button: the menu's trigger takes on its
          // child, and a Badge alone can't be focused or styled on hover.
          <button
            type="button"
            data-filter-chip
            style={{
              display: "inline-flex",
              padding: 0,
              border: "none",
              borderRadius: "var(--radius-full)",
              background: "none",
              cursor: "pointer",
            }}
          >
            <Badge
              variant="soft"
              color="gray"
              radius="full"
              size="md"
              style={removable ? { paddingRight: 26 } : undefined}
              label={chipLabel}
            />
          </button>
        ) : (
          FilterHeading({
            heading: filterLabel,
            open: open === filter,
          })
        )
      }
      variant="soft"
      contentClassName={menuClassName}
      open={open === filter}
      menuPlacement={menuPlacement}
      onOpenChange={(o) => {
        setOpen(o ? filter : "");
      }}
    >
      {/* With chip, just the filter's name, e.g. "Status" (set in
        review). */}
      <DropdownMenuLabel>
        {chip ? filterLabel : `Filter by ${filterLabel}`}
      </DropdownMenuLabel>
      {showSearchFilter && (
        <Box px="2" pb="1" style={{ maxWidth: "250px" }}>
          <Field
            ref={inputRef}
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            type="search"
            placeholder={`Search ${filterLabel}`}
            aria-label={`Search ${filterLabel} filters`}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
                e.stopPropagation();
              }
            }}
          />
        </Box>
      )}
      {filteredItems.map((i) => (
        <Fragment key={i.id}>
          {i.hr && <Box my="2" style={{ borderBottom: "1px solid #ccc" }} />}
          <DropdownMenuItem
            key={i.id}
            disabled={i.disabled}
            style={{ maxWidth: "250px" }}
            onClick={(event) => {
              // With chip, the menu stays open after a pick, so several
              // values can be toggled in one go (set in review).
              if (chip) event.preventDefault();
              const f: SyntaxFilter = {
                field: i?.filter ?? filter,
                values: [i.searchValue],
                operator: i?.operator ?? "",
                negated: i?.negated ?? false,
              };
              updateQuery(f);
            }}
          >
            <FilterItem
              checkbox={chip}
              item={i.name}
              exists={doesFilterExistInSearch({
                syntaxFilters,
                field: i?.filter ?? filter,
                value: i.searchValue,
                operator: i?.operator ?? operator,
              })}
            />
          </DropdownMenuItem>
        </Fragment>
      ))}
    </DropdownMenu>
  );

  if (!chip) return menu;
  // A chip is always in this wrapper, with or without its remove button, so
  // the button appearing (e.g. on a default filter's first value) doesn't
  // remount the menu, which would close and reopen it.
  return (
    <span
      data-chip-wrap
      style={{ position: "relative", display: "inline-flex" }}
    >
      {menu}
      {removable ? (
        <ChipRemoveButton
          label={`Remove ${filterLabel} filter`}
          onClick={onRemove}
        />
      ) : null}
    </span>
  );
};

// Helper function for checking if a filter exists in the syntax filters
function doesFilterExistInSearch({
  syntaxFilters,
  field,
  value,
  operator,
  negated,
}: {
  syntaxFilters: SyntaxFilter[];
  field: string;
  value: string;
  operator?: string;
  negated?: boolean;
}): boolean {
  // Value matching is case-insensitive to mirror how filterSearchTerm actually
  // filters (it lowercases both sides), so hand-typed `status:Running` still
  // maps to the "running" option.
  const hasValue = (filter: SyntaxFilter) =>
    filter.values.some((v) => v.toLowerCase() === value.toLowerCase());

  if (negated !== undefined && operator !== undefined) {
    return syntaxFilters.some(
      (filter) =>
        filter.field === field &&
        filter.operator === operator &&
        hasValue(filter) &&
        filter.negated === negated,
    );
  }
  if (operator !== undefined) {
    return syntaxFilters.some(
      (filter) =>
        filter.field === field &&
        filter.operator === operator &&
        hasValue(filter),
    );
  } else {
    return syntaxFilters.some(
      (filter) => filter.field === field && hasValue(filter),
    );
  }
}

// Base hook
export const useSearchFiltersBase = ({
  searchInputProps,
  syntaxFilters,
  setSearchValue,
}: BaseSearchFiltersProps) => {
  const [dropdownFilterOpen, setDropdownFilterOpen] = useState("");
  const { projects, project } = useDefinitions();

  const addFilterToSearch = useCallback(
    (filter: SyntaxFilter) => {
      const term = filterToString(filter);
      setSearchValue(
        (searchInputProps.value.length > 0
          ? searchInputProps.value + " " + term
          : term
        ).trim(),
      );
    },
    [searchInputProps.value, setSearchValue],
  );

  const updateFilterToSearch = useCallback(
    (filter: SyntaxFilter) => {
      const term = filterToString(filter);
      const newValue = searchInputProps.value.replace(
        filterTokenRegex(filter),
        term,
      );
      setSearchValue(newValue.trim());
    },
    [searchInputProps, setSearchValue],
  );

  const removeFilterToSearch = useCallback(
    (filter: SyntaxFilter) => {
      const newValue = searchInputProps.value.replace(
        filterTokenRegex(filter),
        "",
      );
      setSearchValue(newValue.trim());
    },
    [searchInputProps.value, setSearchValue],
  );

  const updateQuery = useCallback(
    (filter: SyntaxFilter) => {
      const existingFilter = syntaxFilters.find(
        (f) =>
          f.field === filter.field &&
          f.operator === filter.operator &&
          f.negated === filter.negated,
      );

      if (existingFilter) {
        // Case-insensitive, matching how filterSearchTerm filters and how the
        // UI decides an option is checked — otherwise a hand-typed
        // `status:Running` renders checked but can never be unchecked.
        const newValue = (filter.values[0] ?? "").toLowerCase();
        const valueExists = existingFilter.values.some(
          (v) => v.toLowerCase() === newValue,
        );

        if (valueExists) {
          existingFilter.values = existingFilter.values.filter(
            (v) => v.toLowerCase() !== newValue,
          );

          if (existingFilter.values.length === 0) {
            removeFilterToSearch(existingFilter);
          } else {
            updateFilterToSearch(existingFilter);
          }
        } else {
          existingFilter.values = existingFilter.values.concat(filter.values);
          updateFilterToSearch(existingFilter);
        }
      } else {
        addFilterToSearch(filter);
      }
    },
    [
      syntaxFilters,
      addFilterToSearch,
      updateFilterToSearch,
      removeFilterToSearch,
    ],
  );

  // Takes every term for a field, or several fields, out of the search at
  // once (e.g. when a filter chip, or the overflow chip, is removed).
  const removeFieldFromSearch = useCallback(
    (field: string | string[]) => {
      const fields = Array.isArray(field) ? field : [field];
      const newValue = syntaxFilters
        .filter((f) => fields.includes(f.field))
        .reduce(
          (value, f) => value.replace(filterTokenRegex(f), ""),
          searchInputProps.value,
        );
      setSearchValue(newValue.replace(/\s+/g, " ").trim());
    },
    [syntaxFilters, searchInputProps.value, setSearchValue],
  );

  return {
    dropdownFilterOpen,
    setDropdownFilterOpen,
    project,
    projects,
    updateQuery,
    removeFieldFromSearch,
    doesFilterExist: useCallback(
      (field: string, value: string, operator?: string, negated?: boolean) =>
        doesFilterExistInSearch({
          syntaxFilters,
          field,
          value,
          operator,
          negated,
        }),
      [syntaxFilters],
    ),
  };
};
