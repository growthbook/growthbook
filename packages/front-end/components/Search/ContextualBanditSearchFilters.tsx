import React, { FC, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { ApiContextualBanditInterface } from "shared/validators";
import Tag from "@/components/Tags/Tag";
import {
  BaseSearchFiltersProps,
  FilterDropdown,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { useCombinedMetrics } from "@/components/Metrics/MetricsList";
import { useUser } from "@/services/UserContext";

const ContextualBanditSearchFilters: FC<
  BaseSearchFiltersProps & {
    contextualBandits: ApiContextualBanditInterface[];
  }
> = ({
  searchInputProps,
  syntaxFilters,
  contextualBandits,
  setSearchValue,
}) => {
  const { dropdownFilterOpen, setDropdownFilterOpen, updateQuery } =
    useSearchFiltersBase({
      searchInputProps,
      syntaxFilters,
      setSearchValue,
    });
  const { getOwnerDisplay } = useUser();
  const allMetrics = useCombinedMetrics({});

  const availableTags = useMemo(() => {
    const availableTags: string[] = [];
    contextualBandits.forEach((item) => {
      item.tags?.forEach((tag) => {
        if (!availableTags.includes(tag)) {
          availableTags.push(tag);
        }
      });
    });
    return availableTags;
  }, [contextualBandits]);

  const metricsMap = useMemo(() => {
    const map = new Map();
    allMetrics.forEach((m) => {
      map.set(m.id, {
        name: m.name,
        id: m.id,
        searchValue: m.name,
        disabled: true,
      });
    });

    contextualBandits.forEach((cb) => {
      const enableMetric = (m: string) => {
        if (m && map.has(m)) {
          map.set(m, {
            ...map.get(m),
            disabled: false,
          });
        }
      };

      if (cb.decisionMetric) enableMetric(cb.decisionMetric);
    });

    return map;
  }, [allMetrics, contextualBandits]);

  const owners = useMemo(() => {
    const owners = new Set<string>();
    contextualBandits.forEach((cb) => {
      if (cb.owner) {
        owners.add(getOwnerDisplay(cb.owner));
      }
    });
    return Array.from(owners).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [contextualBandits, getOwnerDisplay]);

  return (
    <Flex gap="5" align="center">
      <FilterDropdown
        filter="metric"
        heading="Metric"
        syntaxFilters={syntaxFilters}
        open={dropdownFilterOpen}
        setOpen={setDropdownFilterOpen}
        items={Array.from(metricsMap.values())}
        updateQuery={updateQuery}
      />
      <FilterDropdown
        filter="owner"
        heading="Owner"
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
        heading="Tag"
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
    </Flex>
  );
};

export default ContextualBanditSearchFilters;
