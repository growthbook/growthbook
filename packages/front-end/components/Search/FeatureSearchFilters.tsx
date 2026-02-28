import { FC, useCallback, useMemo } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiX } from "react-icons/pi";
import Text from "@/ui/Text";
import { useEnvironments } from "@/services/features";
import Tag from "@/components/Tags/Tag";
import Button from "@/ui/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import {
  BaseSearchFiltersProps,
  FilterHeading,
  FilterItem,
  FilterDropdown,
  SearchFiltersItem,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";

// Remove a single env value from a field token in the raw search string.
// e.g. removeEnvValue("on:prod,staging off:dev", "on", "staging") → "on:prod off:dev"
function removeEnvValue(
  searchStr: string,
  field: string,
  value: string,
): string {
  const prefix = `${field}:`;
  return searchStr
    .split(/\s+/)
    .map((token) => {
      if (!token.startsWith(prefix)) return token;
      const values = token
        .slice(prefix.length)
        .split(",")
        .filter((v) => v !== value);
      return values.length > 0 ? `${prefix}${values.join(",")}` : "";
    })
    .filter(Boolean)
    .join(" ");
}

// Toggle a single env value within a field token in the raw search string.
// Adds the token if the field is absent; removes the value if already present.
function toggleEnvValue(
  searchStr: string,
  field: string,
  value: string,
): string {
  const prefix = `${field}:`;
  const tokens = searchStr.split(/\s+/).filter(Boolean);
  const idx = tokens.findIndex((t) => t.startsWith(prefix));
  if (idx === -1) {
    return [...tokens, `${prefix}${value}`].join(" ");
  }
  const values = tokens[idx].slice(prefix.length).split(",");
  const next = values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
  const updated = [...tokens];
  if (next.length > 0) {
    updated[idx] = `${prefix}${next.join(",")}`;
  } else {
    updated.splice(idx, 1);
  }
  return updated.join(" ");
}

const FeatureSearchFilters: FC<
  BaseSearchFiltersProps & {
    features: { tags?: string[]; owner?: string; valueType: string }[];
    hasArchived: boolean;
  }
> = ({
  searchInputProps,
  syntaxFilters,
  features,
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
  const environments = useEnvironments();

  const availableTags = useMemo(() => {
    const tags: string[] = [];
    features.forEach((item) => {
      item.tags?.forEach((tag) => {
        if (!tags.includes(tag)) tags.push(tag);
      });
    });
    return tags;
  }, [features]);

  const owners = useMemo(() => {
    const set = new Set<string>();
    features.forEach((f) => {
      if (f.owner) set.add(f.owner);
    });
    return Array.from(set);
  }, [features]);

  const availableFeatureTypes = useMemo(() => {
    const set = new Set<string>();
    features.forEach((f) => set.add(f.valueType));
    return Array.from(set);
  }, [features]);

  const allFeatureTypes: SearchFiltersItem[] = [
    {
      name: "Boolean",
      id: "feature-type-boolean",
      searchValue: "boolean",
      disabled: !availableFeatureTypes.includes("boolean"),
    },
    {
      name: "Number",
      id: "feature-type-number",
      searchValue: "number",
      disabled: !availableFeatureTypes.includes("number"),
    },
    {
      name: "String",
      id: "feature-type-string",
      searchValue: "string",
      disabled: !availableFeatureTypes.includes("string"),
    },
    {
      name: "JSON",
      id: "feature-type-json",
      searchValue: "json",
      disabled: !availableFeatureTypes.includes("json"),
    },
  ];

  // Atomically swap on:/off: for the same env so contradictory states can't persist.
  // updateQuery can't be called twice (stale closure), so we mutate the raw string directly.
  const updateEnvQuery = useCallback(
    (field: "on" | "off", envId: string) => {
      const oppositeField = field === "on" ? "off" : "on";
      let value = removeEnvValue(searchInputProps.value, oppositeField, envId);
      value = toggleEnvValue(value, field, envId);
      setSearchValue(value);
    },
    [searchInputProps.value, setSearchValue],
  );

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
          menuPlacement="end"
        />
      )}
      <FilterDropdown
        filter="owner"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={owners.map((o) => ({ name: o, id: o, searchValue: o }))}
        updateQuery={updateQuery}
        menuPlacement="end"
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
        menuPlacement="end"
      />
      <FilterDropdown
        filter="type"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={allFeatureTypes}
        updateQuery={updateQuery}
        menuPlacement="end"
      />

      {/* Environment filter: per-env row with on/off toggles */}
      <DropdownMenu
        trigger={FilterHeading({
          heading: "environment",
          open: dropdownFilterOpen === "on",
        })}
        variant="soft"
        open={dropdownFilterOpen === "on"}
        menuPlacement="end"
        onOpenChange={(o) => setDropdownFilterOpen(o ? "on" : "")}
      >
        <DropdownMenuLabel>Filter by environment</DropdownMenuLabel>
        {environments.map((e) => {
          const isOn = doesFilterExist("on", e.id, "");
          const isOff = doesFilterExist("off", e.id, "");
          return (
            <div key={e.id} style={{ minWidth: "220px", padding: "4px 8px" }}>
              <Flex align="center" gap="2">
                <Box style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <Text truncate>{e.id}</Text>
                </Box>
                <Flex align="center" gap="2">
                  <Button
                    size="sm"
                    variant={isOn ? "soft" : "ghost"}
                    color="violet"
                    onClick={() => updateEnvQuery("on", e.id)}
                  >
                    <Text color="text-mid" weight="semibold">
                      On
                    </Text>
                  </Button>
                  <Button
                    size="sm"
                    variant={isOff ? "soft" : "ghost"}
                    color="violet"
                    onClick={() => updateEnvQuery("off", e.id)}
                  >
                    <Text color="text-mid" weight="semibold">
                      Off
                    </Text>
                  </Button>
                  <IconButton
                    size="2"
                    variant="ghost"
                    color="gray"
                    style={{
                      visibility: isOn || isOff ? "visible" : "hidden",
                      marginLeft: 0,
                    }}
                    onClick={() => {
                      let value = removeEnvValue(
                        searchInputProps.value,
                        "on",
                        e.id,
                      );
                      value = removeEnvValue(value, "off", e.id);
                      setSearchValue(value);
                    }}
                  >
                    <PiX />
                  </IconButton>
                </Flex>
              </Flex>
            </div>
          );
        })}
      </DropdownMenu>

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
            item="Archived features"
            exists={doesFilterExist("is", "archived", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "has",
              values: ["draft"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Has active draft"
            exists={doesFilterExist("has", "draft", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "is",
              values: ["stale"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Is stale"
            exists={doesFilterExist("is", "stale", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "has",
              values: ["stale-env"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Has stale environments"
            exists={doesFilterExist("has", "stale-env", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "is",
              values: ["stale-disabled"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Stale detection disabled"
            exists={doesFilterExist("is", "stale-disabled", "")}
          />
        </DropdownMenuItem>
      </DropdownMenu>
    </Flex>
  );
};

export default FeatureSearchFilters;
