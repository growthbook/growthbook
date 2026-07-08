import { FC, useCallback, useMemo, useRef, useState } from "react";
import { Box, Flex, TextField } from "@radix-ui/themes";
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
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import type { SyntaxFilter } from "@/services/search";

interface SessionForFilters {
  featureKeys: string[];
  experimentKeys: string[];
  country: string;
  device: string;
}

/**
 * Inline text input row for the "More" dropdown.
 * When clicked, it activates and shows a text field.
 * On Enter or blur it commits the value into the search bar.
 */
const TextInputRow: FC<{
  label: string;
  field: string;
  operator?: string;
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
  const [active, setActive] = useState(false);
  const [localValue, setLocalValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const existingFilter = syntaxFilters.find(
    (f) => f.field === field && f.operator === operator,
  );

  const commit = useCallback(
    (val: string) => {
      if (!val.trim()) {
        setActive(false);
        return;
      }
      const escaped = val.includes(" ") ? `"${val}"` : val;
      const token = `${field}:${operator}${escaped}`;
      if (existingFilter) {
        // Replace existing filter for this field+operator
        const prefix = `${field}:${operator}`;
        const newValue = searchValue.replace(
          new RegExp(`${prefix}(?:"[^"]*"|[^\\s])*`, "g"),
          token,
        );
        setSearchValue(newValue.trim());
      } else {
        setSearchValue(
          (searchValue.length > 0 ? searchValue + " " + token : token).trim(),
        );
      }
      setActive(false);
      setLocalValue("");
    },
    [field, operator, existingFilter, searchValue, setSearchValue],
  );

  if (active) {
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
        <TextField.Root
          ref={inputRef}
          size="1"
          variant="surface"
          type={inputType}
          placeholder={placeholder}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={() => commit(localValue)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit(localValue);
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
        requestAnimationFrame(() => inputRef.current?.focus());
      }}
    >
      <FilterItem item={label} exists={!!existingFilter} />
    </DropdownMenuItem>
  );
};

const SessionReplaySearchFilters: FC<
  BaseSearchFiltersProps & {
    sessions: SessionForFilters[];
  }
> = ({ searchInputProps, syntaxFilters, setSearchValue, sessions }) => {
  const { dropdownFilterOpen, setDropdownFilterOpen, updateQuery } =
    useSearchFiltersBase({
      searchInputProps,
      syntaxFilters,
      setSearchValue,
    });

  const countries = useMemo(() => {
    const set = new Set<string>();
    sessions.forEach((s) => {
      if (s.country) set.add(s.country);
    });
    return Array.from(set).sort();
  }, [sessions]);

  const devices = useMemo(() => {
    const set = new Set<string>();
    sessions.forEach((s) => {
      if (s.device) set.add(s.device);
    });
    return Array.from(set).sort();
  }, [sessions]);

  const featureKeys = useMemo(() => {
    const set = new Set<string>();
    sessions.forEach((s) => {
      s.featureKeys?.forEach((k) => set.add(k));
    });
    return Array.from(set).sort();
  }, [sessions]);

  const experimentKeys = useMemo(() => {
    const set = new Set<string>();
    sessions.forEach((s) => {
      s.experimentKeys?.forEach((k) => set.add(k));
    });
    return Array.from(set).sort();
  }, [sessions]);

  return (
    <Flex gap="3" align="center" wrap="wrap">
      {devices.length > 0 && (
        <FilterDropdown
          filter="device"
          heading="Device"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={devices.map((d) => ({
            name: d,
            id: `device-${d}`,
            searchValue: d,
          }))}
          updateQuery={updateQuery}
        />
      )}
      {countries.length > 0 && (
        <FilterDropdown
          filter="country"
          heading="Country"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={countries.map((c) => ({
            name: c,
            id: `country-${c}`,
            searchValue: c,
          }))}
          updateQuery={updateQuery}
        />
      )}
      {featureKeys.length > 0 && (
        <FilterDropdown
          filter="flag"
          heading="Flag"
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
      )}
      {experimentKeys.length > 0 && (
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
      )}

      {/* "More" dropdown for typed-input filters */}
      <DropdownMenu
        trigger={FilterHeading({
          heading: "more",
          open: dropdownFilterOpen === "more",
        })}
        open={dropdownFilterOpen === "more"}
        menuPlacement="end"
        variant="soft"
        onOpenChange={(o) => {
          setDropdownFilterOpen(o ? "more" : "");
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
          label="Date after"
          field="date"
          operator=">"
          placeholder="YYYY-MM-DD"
          inputType="date"
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
        <TextInputRow
          label="Date before"
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
