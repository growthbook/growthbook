import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, IconButton, TextField } from "@radix-ui/themes";
import { PiX } from "react-icons/pi";
import Text from "@/ui/Text";
import { useEnvironments, useAttributeSchema } from "@/services/features";
import Tag from "@/components/Tags/Tag";
import Button from "@/ui/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import {
  BaseSearchFiltersProps,
  FilterHeading,
  FilterItem,
  FilterDropdown,
  SearchFiltersItem,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { Select, SelectItem } from "@/ui/Select";
import type { SyntaxFilter } from "@/services/search";

function setCompoundHasToken(
  searchStr: string,
  prefix: string,
  newValue: string | undefined,
  setSearchValue: (v: string) => void,
) {
  const tokens = searchStr.split(/\s+/).filter(Boolean);
  const filtered = tokens.filter((t) => {
    if (!t.startsWith("has:")) return true;
    return !t.slice(4).startsWith(prefix);
  });

  if (newValue !== undefined) {
    filtered.push(`has:${prefix}${encodeURIComponent(newValue)}`);
  }

  setSearchValue(filtered.join(" "));
}

function getCompoundHasValue(
  syntaxFilters: SyntaxFilter[],
  prefix: string,
): string | undefined {
  for (const filter of syntaxFilters) {
    if (filter.field !== "has") continue;
    for (const val of filter.values) {
      if (val.startsWith(prefix)) {
        return decodeURIComponent(val.slice(prefix.length));
      }
    }
  }
  return undefined;
}

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

const ContainsTextRow: FC<{
  label: string;
  hasPrefix: string;
  placeholder: string;
  syntaxFilters: SyntaxFilter[];
  searchValue: string;
  setSearchValue: (v: string) => void;
}> = ({
  label,
  hasPrefix,
  placeholder,
  syntaxFilters,
  searchValue,
  setSearchValue,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const currentValue = getCompoundHasValue(syntaxFilters, hasPrefix);
  const active = currentValue !== undefined;
  const [localValue, setLocalValue] = useState(currentValue ?? "");

  useEffect(() => {
    if (active) {
      setLocalValue(currentValue ?? "");
    }
  }, [active, currentValue]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [active]);

  const commit = useCallback(
    (val: string) => {
      setCompoundHasToken(searchValue, hasPrefix, val, setSearchValue);
    },
    [searchValue, hasPrefix, setSearchValue],
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
        <Box
          style={{ cursor: "pointer" }}
          onClick={() =>
            setCompoundHasToken(
              searchValue,
              hasPrefix,
              undefined,
              setSearchValue,
            )
          }
        >
          <FilterItem item={label} exists={true} />
        </Box>
        <TextField.Root
          ref={inputRef}
          size="1"
          variant="surface"
          placeholder={placeholder}
          value={localValue}
          onChange={(e) => {
            setLocalValue(e.target.value);
          }}
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
        setCompoundHasToken(searchValue, hasPrefix, "", setSearchValue);
      }}
    >
      <FilterItem item={label} exists={false} />
    </DropdownMenuItem>
  );
};

const ContainsSelectRow: FC<{
  label: string;
  hasPrefix: string;
  placeholder: string;
  options: { value: string; label: string }[];
  syntaxFilters: SyntaxFilter[];
  searchValue: string;
  setSearchValue: (v: string) => void;
}> = ({
  label,
  hasPrefix,
  placeholder,
  options,
  syntaxFilters,
  searchValue,
  setSearchValue,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentValue = getCompoundHasValue(syntaxFilters, hasPrefix);
  const active = currentValue !== undefined;

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        const trigger = wrapperRef.current?.querySelector("button");
        trigger?.focus();
      });
    }
  }, [active]);

  return (
    <DropdownMenuItem
      onClick={(e) => {
        e.preventDefault();
        if (active) {
          setCompoundHasToken(
            searchValue,
            hasPrefix,
            undefined,
            setSearchValue,
          );
        } else {
          setCompoundHasToken(searchValue, hasPrefix, "", setSearchValue);
        }
      }}
    >
      {active ? (
        <Flex
          align="center"
          justify="between"
          gap="4"
          style={{ width: "100%" }}
        >
          <FilterItem item={label} exists={true} />
          <Box onClick={(e) => e.stopPropagation()}>
            <Select
              size="1"
              variant="surface"
              placeholder={placeholder}
              value={currentValue ?? ""}
              setValue={(v) =>
                setCompoundHasToken(searchValue, hasPrefix, v, setSearchValue)
              }
              ref={wrapperRef}
              style={{ minWidth: 100, maxWidth: 160 }}
              triggerClassName="overflow-hidden text-ellipsis"
            >
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </Select>
          </Box>
        </Flex>
      ) : (
        <FilterItem item={label} exists={false} />
      )}
    </DropdownMenuItem>
  );
};

const FeatureSearchFilters: FC<
  BaseSearchFiltersProps & {
    features: {
      tags?: string[];
      owner?: string;
      valueType: string;
      linkedExperiments?: string[];
    }[];
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
  const { getOwnerDisplay } = useUser();
  const { savedGroups } = useDefinitions();
  const attributeSchema = useAttributeSchema(false, project || undefined);

  const [expLookup, setExpLookup] = useState<
    Record<string, { name: string; type: string }>
  >({});
  const expLookupFetched = useRef(false);
  const { apiCall } = useAuth();

  const anyExpFilterActive =
    getCompoundHasValue(syntaxFilters, "experiment:") !== undefined ||
    getCompoundHasValue(syntaxFilters, "bandit:") !== undefined;
  useEffect(() => {
    if (!anyExpFilterActive || expLookupFetched.current) return;
    expLookupFetched.current = true;
    apiCall<{
      experiments: { id: string; name: string; type: string }[];
    }>("/experiments?project=&includeArchived=&type=")
      .then((res) => {
        const map: Record<string, { name: string; type: string }> = {};
        (res.experiments ?? []).forEach((e) => {
          map[e.id] = { name: e.name, type: e.type };
        });
        setExpLookup(map);
      })
      .catch(() => {
        expLookupFetched.current = false;
      });
  }, [anyExpFilterActive, apiCall]);

  const hasExpDefinitions = Object.keys(expLookup).length > 0;
  const { experimentOptions, banditOptions } = useMemo(() => {
    if (!hasExpDefinitions) return { experimentOptions: [], banditOptions: [] };
    const ids = new Set<string>();
    features.forEach((f) => f.linkedExperiments?.forEach((id) => ids.add(id)));
    const experiments: { value: string; label: string }[] = [];
    const bandits: { value: string; label: string }[] = [];
    for (const id of ids) {
      const info = expLookup[id];
      const label = info?.name || id;
      if (info?.type === "multi-armed-bandit") {
        bandits.push({ value: id, label });
      } else {
        experiments.push({ value: id, label });
      }
    }
    experiments.sort((a, b) => a.label.localeCompare(b.label));
    bandits.sort((a, b) => a.label.localeCompare(b.label));
    return { experimentOptions: experiments, banditOptions: bandits };
  }, [features, expLookup, hasExpDefinitions]);

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
      if (f.owner) set.add(getOwnerDisplay(f.owner));
    });
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [features, getOwnerDisplay]);

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

      {/* Contains: rule content searches */}
      <DropdownMenu
        trigger={FilterHeading({
          heading: "contains",
          open: dropdownFilterOpen === "contains",
        })}
        open={dropdownFilterOpen === "contains"}
        menuPlacement="end"
        variant="soft"
        onOpenChange={(o) => setDropdownFilterOpen(o ? "contains" : "")}
      >
        <DropdownMenuLabel>Has...</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "has",
              values: ["prerequisites"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Prerequisites"
            exists={doesFilterExist("has", "prerequisites", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "has",
              values: ["dependents"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Dependents"
            exists={doesFilterExist("has", "dependents", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "has",
              values: ["savedgroup"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Saved groups"
            exists={doesFilterExist("has", "savedgroup", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "has",
              values: ["experiments"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Experiments & bandits"
            exists={doesFilterExist("has", "experiments", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "has",
              values: ["temp-rollout"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Temp experiment rollouts"
            exists={doesFilterExist("has", "temp-rollout", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "has",
              values: ["ramp-schedule"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Active ramp-ups &amp; schedules"
            exists={doesFilterExist("has", "ramp-schedule", "")}
          />
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Contains specific...</DropdownMenuLabel>

        <ContainsTextRow
          label="Value"
          hasPrefix="value:"
          placeholder="Search values..."
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
        <ContainsSelectRow
          label="Attribute"
          hasPrefix="attribute:"
          placeholder="Select..."
          options={attributeSchema.map((a) => ({
            value: a.property,
            label: a.property,
          }))}
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
        <ContainsSelectRow
          label="Saved Group"
          hasPrefix="saved-group:"
          placeholder="Select..."
          options={savedGroups.map((sg) => ({
            value: sg.id,
            label: sg.groupName,
          }))}
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
        <ContainsSelectRow
          label="Experiment"
          hasPrefix="experiment:"
          placeholder="Select..."
          options={experimentOptions}
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
        <ContainsSelectRow
          label="Bandit"
          hasPrefix="bandit:"
          placeholder="Select..."
          options={banditOptions}
          syntaxFilters={syntaxFilters}
          searchValue={searchInputProps.value}
          setSearchValue={setSearchValue}
        />
      </DropdownMenu>

      {/* More: status/staleness filters */}
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
