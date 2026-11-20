import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { countries } from "country-codes-flags-phone-codes";
import TextField from "@/ui/TextField";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import {
  BaseSearchFiltersProps,
  FilterDropdown,
  FilterHeading,
  FilterItem,
  filterToString,
  filterTokenRegex,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import type { SearchTermFilterOperator, SyntaxFilter } from "@/services/search";
import { useFeaturesList } from "@/services/features";
import { useExperiments } from "@/hooks/useExperiments";

/**
 * device is UAParser's device.type, which the ingestor defaults to "desktop"
 * when the parser reports none. A closed set, so it is listed rather than
 * discovered.
 */
const DEVICE_TYPES = [
  "desktop",
  "mobile",
  "tablet",
  "console",
  "smarttv",
  "wearable",
  "embedded",
];

/**
 * Inline text input row for the "More" dropdown.
 * When clicked, it activates and shows a text field.
 * On Enter or blur it commits the value into the search bar.
 */
const TextInputRow: FC<{
  label: string;
  field: string;
  operator?: SearchTermFilterOperator;
  placeholder: string;
  inputType?: "text" | "number" | "date" | "search";
  syntaxFilters: SyntaxFilter[];
  searchValue: string;
  setSearchValue: (v: string) => void;
}> = ({
  label,
  field,
  operator = "",
  placeholder,
  inputType = "text",
  syntaxFilters,
  searchValue,
  setSearchValue,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [active, setActive] = useState(false);

  const existingFilter = syntaxFilters.find(
    (f) => f.field === field && f.operator === operator,
  );

  const [localValue, setLocalValue] = useState(existingFilter?.values[0] ?? "");

  useEffect(() => {
    if (existingFilter) {
      setLocalValue(existingFilter.values[0] ?? "");
    }
  }, [existingFilter]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [active]);

  const commit = useCallback(
    (val: string) => {
      if (!val.trim()) {
        if (existingFilter) {
          const newValue = searchValue.replace(
            filterTokenRegex(existingFilter),
            "",
          );
          setSearchValue(newValue.trim());
        }
        setActive(false);
        return;
      }
      const newFilter: SyntaxFilter = {
        field,
        operator,
        values: [val],
        negated: false,
      };
      const token = filterToString(newFilter);
      if (existingFilter) {
        const newValue = searchValue.replace(
          filterTokenRegex(existingFilter),
          token,
        );
        setSearchValue(newValue.trim());
      } else {
        setSearchValue(
          (searchValue.length > 0 ? searchValue + " " + token : token).trim(),
        );
      }
      setActive(false);
    },
    [field, operator, existingFilter, searchValue, setSearchValue],
  );

  if (active || existingFilter) {
    return (
      <Flex
        ref={rowRef}
        align="center"
        justify="between"
        gap="4"
        className="rt-reset rt-BaseMenuItem rt-DropdownMenuItem"
        onMouseEnter={() =>
          rowRef.current?.setAttribute("data-highlighted", "")
        }
        onMouseLeave={() => rowRef.current?.removeAttribute("data-highlighted")}
      >
        <Box>{label}</Box>
        <TextField
          ref={inputRef}
          size="sm"
          variant="surface"
          type={inputType}
          placeholder={placeholder}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onFocus={() => {
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
          }}
          onBlur={() => {
            blurTimerRef.current = setTimeout(() => commit(localValue), 300);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
              commit(localValue);
            }
          }}
          style={{ minWidth: 0 }}
        />
      </Flex>
    );
  }

  return (
    <DropdownMenuItem
      onClick={(e) => {
        e.preventDefault();
        setActive(true);
      }}
    >
      <FilterItem item={label} exists={!!existingFilter} />
    </DropdownMenuItem>
  );
};

const SessionReplaySearchFilters: FC<BaseSearchFiltersProps> = ({
  searchInputProps,
  syntaxFilters,
  setSearchValue,
}) => {
  const { dropdownFilterOpen, setDropdownFilterOpen, updateQuery } =
    useSearchFiltersBase({
      searchInputProps,
      syntaxFilters,
      setSearchValue,
    });

  const { features } = useFeaturesList({ includeArchived: true });
  const { experiments } = useExperiments(undefined, true);

  const featureKeys = useMemo(
    () => Array.from(new Set(features.map((f) => f.id))).sort(),
    [features],
  );

  const experimentKeys = useMemo(
    () =>
      Array.from(
        new Set(experiments.map((e) => e.trackingKey).filter(Boolean)),
      ).sort(),
    [experiments],
  );

  const countryItems = useMemo(
    () =>
      countries
        .map((c) => ({
          name: `${c.flag} ${c.name}`,
          id: `country-${c.code}`,
          searchValue: c.code,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  return (
    <Flex gap="3" align="center" wrap="wrap">
      <FilterDropdown
        filter="device"
        heading="Device"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={DEVICE_TYPES.map((d) => ({
          name: d,
          id: `device-${d}`,
          searchValue: d,
        }))}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="country"
        heading="Country"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={countryItems}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="flag"
        heading="Feature Flag"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={featureKeys.map((k) => ({
          name: k,
          id: `flag-${k}`,
          searchValue: k,
        }))}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="experiment"
        heading="Experiment"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={experimentKeys.map((k) => ({
          name: k,
          id: `exp-${k}`,
          searchValue: k,
        }))}
        updateQuery={updateQuery}
      />

      {/* "More" dropdown for typed-input filters */}
      <DropdownMenu
        trigger={FilterHeading({
          heading: "More",
          open: dropdownFilterOpen === "More",
        })}
        open={dropdownFilterOpen === "More"}
        menuPlacement="end"
        variant="soft"
        onOpenChange={(o) => {
          setDropdownFilterOpen(o ? "More" : "");
        }}
      >
        <DropdownMenuLabel>Filter by</DropdownMenuLabel>
        <TextInputRow
          label="User ID"
          field="user"
          placeholder="e.g. user-123"
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
        <TextInputRow
          label="Client Key"
          field="client"
          placeholder="e.g. sdk-abc"
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
        <TextInputRow
          label="URL contains"
          field="url"
          placeholder="e.g. /checkout"
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
        <TextInputRow
          label="Duration ≥ (sec)"
          field="duration"
          operator=">"
          placeholder="e.g. 30"
          inputType="number"
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
        <TextInputRow
          label="Duration ≤ (sec)"
          field="duration"
          operator="<"
          placeholder="e.g. 120"
          inputType="number"
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
        <TextInputRow
          label="Events ≥"
          field="events"
          operator=">"
          placeholder="e.g. 5"
          inputType="number"
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
        <TextInputRow
          label="Events ≤"
          field="events"
          operator="<"
          placeholder="e.g. 100"
          inputType="number"
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
        <TextInputRow
          label="Date on or after"
          field="date"
          operator=">"
          placeholder="YYYY-MM-DD"
          inputType="date"
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
        <TextInputRow
          label="Date on or before"
          field="date"
          operator="<"
          placeholder="YYYY-MM-DD"
          inputType="date"
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
      </DropdownMenu>
    </Flex>
  );
};

export default SessionReplaySearchFilters;
