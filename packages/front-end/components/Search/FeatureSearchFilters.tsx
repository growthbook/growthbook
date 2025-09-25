import React, { FC, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { FeatureInterface } from "back-end/types/feature";
import { useEnvironments } from "@/services/features";
import Tag from "@/components/Tags/Tag";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import {
  BaseSearchFiltersProps,
  FilterHeading,
  FilterItem,
  FilterDropdown,
  SearchFiltersItem,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";

const FeatureSearchFilters: FC<
  BaseSearchFiltersProps & {
    features: FeatureInterface[];
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
  // get the environments:
  const environments = useEnvironments();

  // Feature specific state
  const availableTags = useMemo(() => {
    const availableTags: string[] = [];
    features.forEach((item) => {
      if (item.tags) {
        item.tags.forEach((tag) => {
          if (!availableTags.includes(tag)) {
            availableTags.push(tag);
          }
        });
      }
    });
    return availableTags;
  }, [features]);

  const owners = useMemo(() => {
    const owners = new Set<string>();
    features.forEach((f) => {
      if (f.owner) {
        owners.add(f.owner);
      }
    });
    return Array.from(owners);
  }, [features]);

  const availableFeatureTypes = useMemo(() => {
    const featureTypes = new Set<string>();
    features.forEach((f) => {
      featureTypes.add(f.valueType);
    });
    return Array.from(featureTypes);
  }, [features]);
  const allFeatureTypes: SearchFiltersItem[] = [
    {
      name: "Boolean (true/false)",
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

  const onEnv = environments.map((e) => {
    return {
      searchValue: e.id,
      id: "on-env-" + e.id,
      name: "On - " + e.id,
    };
  });
  const offEnv = environments.map((e, i) => {
    return {
      filter: "off",
      searchValue: e.id,
      id: "off-env-" + e.id,
      name: "Off - " + e.id,
      hr: i === 0,
    };
  });
  // merge onEnv and offEnv:
  const allEnv = [...onEnv, ...offEnv];

  return (
    <Flex gap="5" align="center">
      {!project && (
        <FilterDropdown
          filter="project"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={projects.map((p) => {
            return { name: p.name, id: p.id, searchValue: p.name };
          })}
          updateQuery={updateQuery}
        />
      )}
      <FilterDropdown
        filter="owner"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={owners.map((o) => {
          return { name: o, id: o, searchValue: o };
        })}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="tag"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={availableTags.map((t) => {
          return {
            name: <Tag tag={t} key={t} skipMargin={true} variant="dot" />,
            id: t,
            searchValue: t,
          };
        })}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="type"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={allFeatureTypes}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="has"
        heading="rules"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={[
          {
            searchValue: "experiment",
            id: "hasExperiment",
            name: "has an experiment",
          },
          {
            searchValue: "rollout",
            id: "hasRollout",
            name: "has a rollout rule",
          },
          {
            searchValue: "force",
            id: "hasForce",
            name: "has an force rule",
          },
        ]}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="on"
        heading="environment"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={allEnv}
        updateQuery={updateQuery}
      />
      <DropdownMenu
        trigger={FilterHeading({
          heading: "more",
          open: dropdownFilterOpen === "more",
        })}
        open={dropdownFilterOpen === "more"}
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
            item="Has rule(s) in draft"
            exists={doesFilterExist("has", "draft", "")}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            updateQuery({
              field: "has",
              values: ["prereqs"],
              operator: "",
              negated: false,
            });
          }}
        >
          <FilterItem
            item="Has prerequisites"
            exists={doesFilterExist("has", "prereqs", "")}
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
      </DropdownMenu>
    </Flex>
  );
};

export default FeatureSearchFilters;
