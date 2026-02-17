import React, {
  ChangeEvent,
  FC,
  Fragment,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Flex, Heading, IconButton } from "@radix-ui/themes";
import { FaAngleDown, FaAngleUp, FaCheck } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { SearchTermFilterOperator, SyntaxFilter } from "@/services/search";
import Field from "@/components/Forms/Field";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";

const USE_SEARCH_BOX = false;

// Common interfaces
export interface SearchFiltersItem {
  id: string;
  name: string | React.ReactNode;
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

export const FilterHeading = ({
  heading,
  open,
}: {
  heading: string;
  open: boolean;
}): React.ReactNode => {
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
  item: string | React.ReactNode;
  exists: boolean;
}> = ({ item, exists }) => {
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

export const FilterDropdown: FC<{
  filter: string;
  items: SearchFiltersItem[];
  syntaxFilters: SyntaxFilter[];
  open: string;
  setOpen: (value: string) => void;
  updateQuery: (filter: SyntaxFilter) => void;
  operator?: string;
  heading?: string;
}> = ({
  filter,
  items,
  open,
  setOpen,
  updateQuery,
  syntaxFilters,
  operator = "",
  heading,
}) => {
  const [filterSearch, setFilterSearch] = useState<string>("");
  const showSearchFilter = useMemo(
    () => USE_SEARCH_BOX && items.length > 10,
    [items],
  );
  const filteredItems = useMemo(
    () =>
      filterSearch
        ? items.filter(
            (i) =>
              (typeof i.name === "string"
                ? i.name.toLowerCase()
                : i.searchValue.toLowerCase()
              ).startsWith(filterSearch.toLowerCase()) ||
              (typeof i.name === "string"
                ? i.name.toLowerCase()
                : i.searchValue.toLowerCase()
              ).includes(filterSearch.toLowerCase()),
          )
        : items,
    [items, filterSearch],
  );

  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <DropdownMenu
      trigger={FilterHeading({
        heading: heading ?? filter,
        open: open === filter,
      })}
      open={open === filter}
      onOpenChange={(o) => {
        setOpen(o ? filter : "");
      }}
    >
      <Box px="2" py="1" mb="1">
        <Heading as="h4" size="2" weight="bold" mb="0">
          Filter by {heading ?? filter}
        </Heading>
        {showSearchFilter && (
          <Field
            ref={inputRef}
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            type="search"
            className="mt-2"
            // Prevent events from propagating to parent which might close the dropdown
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
                e.stopPropagation();
              }
            }}
          />
        )}
      </Box>
      <Box overflow="auto" style={{ maxHeight: "300px", maxWidth: "250px" }}>
        {filteredItems.map((i) => (
          <Fragment key={i.id}>
            {i.hr && <Box my="2" style={{ borderBottom: "1px solid #ccc" }} />}
            <DropdownMenuItem
              key={i.id}
              disabled={i.disabled}
              onClick={() => {
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
      </Box>
    </DropdownMenu>
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
  if (negated !== undefined && operator !== undefined) {
    return syntaxFilters.some(
      (filter) =>
        filter.field === field &&
        filter.operator === operator &&
        filter.values.includes(value) &&
        filter.negated === negated,
    );
  }
  if (operator !== undefined) {
    return syntaxFilters.some(
      (filter) =>
        filter.field === field &&
        filter.operator === operator &&
        filter.values.includes(value),
    );
  } else {
    return syntaxFilters.some(
      (filter) => filter.field === field && filter.values.includes(value),
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

  const filterToString = useCallback((filter: SyntaxFilter) => {
    return (
      filter.field +
      ":" +
      (filter.negated ? "!" : "") +
      filter.operator +
      filter.values
        .map((v) => {
          return v.includes(" ") ? '"' + v + '"' : v;
        })
        .join(",")
    );
  }, []);

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
    [filterToString, searchInputProps.value, setSearchValue],
  );

  const updateFilterToSearch = useCallback(
    (filter: SyntaxFilter) => {
      const term = filterToString(filter);
      const startsWith =
        filter.field + ":" + (filter.negated ? "!" : "") + filter.operator;
      const newValue = searchInputProps.value.replace(
        new RegExp(`${startsWith}(?:"[^"]*"|[^\\s])*`, "g"),
        term,
      );
      setSearchValue(newValue.trim());
    },
    [filterToString, searchInputProps, setSearchValue],
  );

  const removeFilterToSearch = useCallback(
    (filter: SyntaxFilter) => {
      const startsWith =
        filter.field + ":" + (filter.negated ? "!" : "") + filter.operator;
      const newValue = searchInputProps.value.replace(
        new RegExp(`${startsWith}(?:"[^"]*"|[^\\s])*`, "g"),
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
        const valueExists = existingFilter.values.some(
          (v) => v === filter.values[0],
        );

        if (valueExists) {
          existingFilter.values = existingFilter.values.filter(
            (v) => v !== filter.values[0],
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

  return {
    dropdownFilterOpen,
    setDropdownFilterOpen,
    project,
    projects,
    updateQuery,
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
