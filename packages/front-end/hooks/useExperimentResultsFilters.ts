import { useMemo } from "react";
import {
  isMetricGroupId,
  expandMetricGroups,
  createAutoSliceDataForMetric,
  isFactMetric,
  SliceDataForMetric,
  generateSliceString,
  parseSliceQueryString,
} from "shared/experiments";
import {
  FactMetricInterface,
  FactTableInterface,
  FactTableColumnType,
} from "shared/types/fact-table";
import { useDefinitions } from "@/services/DefinitionsContext";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useLocalStorage } from "@/hooks/useLocalStorage";

export interface UseExperimentResultsFiltersParams {
  experimentId?: string;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  customMetricSlices?: Array<{
    slices: Array<{
      column: string;
      levels: string[];
    }>;
  }>;
  ssrPolyfills?: SSRPolyfills;
}

export interface UseExperimentResultsFiltersReturn {
  availableMetricTags: string[];
  availableMetricGroups: Array<{ id: string; name: string }>;
  availableSliceTags: Array<{
    id: string;
    datatypes: Record<string, FactTableColumnType>;
    isSelectAll?: boolean;
  }>;
  // Filter state
  metricTagFilter: string[];
  setMetricTagFilter: (tags: string[]) => void;
  metricGroupsFilter: string[];
  setMetricGroupsFilter: (groups: string[]) => void;
  sliceTagsFilter: string[];
  setSliceTagsFilter: (tags: string[]) => void;
  // Sort state
  sortBy: "significance" | "change" | null;
  setSortBy: (s: "significance" | "change" | null) => void;
  sortDirection: "asc" | "desc" | null;
  setSortDirection: (d: "asc" | "desc" | null) => void;
}

export function useExperimentResultsFilters({
  experimentId = "",
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  customMetricSlices,
  ssrPolyfills,
}: UseExperimentResultsFiltersParams): UseExperimentResultsFiltersReturn {
  // Filter state (only used when experimentId is provided)
  const [metricTagFilter, setMetricTagFilter] = useLocalStorage<string[]>(
    experimentId
      ? `experiment-page__${experimentId}__metric_tag_filter`
      : `experiment-page__temp__metric_tag_filter`,
    [],
  );
  const [metricGroupsFilter, setMetricGroupsFilter] = useLocalStorage<string[]>(
    experimentId
      ? `experiment-page__${experimentId}__metric_groups_filter`
      : `experiment-page__temp__metric_groups_filter`,
    [],
  );
  const [sliceTagsFilter, setSliceTagsFilter] = useLocalStorage<string[]>(
    experimentId
      ? `experiment-page__${experimentId}__slice_tags_filter`
      : `experiment-page__temp__slice_tags_filter`,
    [],
  );

  // Sort state (only used when experimentId is provided)
  const [sortBy, setSortBy] = useLocalStorage<"significance" | "change" | null>(
    experimentId
      ? `experiment-page__${experimentId}__sort_by`
      : `experiment-page__temp__sort_by`,
    null,
  );
  const [sortDirection, setSortDirection] = useLocalStorage<
    "asc" | "desc" | null
  >(
    experimentId
      ? `experiment-page__${experimentId}__sort_direction`
      : `experiment-page__temp__sort_direction`,
    null,
  );
  const {
    getExperimentMetricById: _getExperimentMetricById,
    getFactTableById: _getFactTableById,
    metricGroups: _metricGroups,
    factTables: _factTables,
  } = useDefinitions();

  const getExperimentMetricById =
    ssrPolyfills?.getExperimentMetricById || _getExperimentMetricById;
  const getFactTableById = ssrPolyfills?.getFactTableById || _getFactTableById;
  const metricGroups = ssrPolyfills?.metricGroups || _metricGroups;
  const factTables = _factTables;

  // Extract metric group IDs from experiment metrics (dedupe using Map)
  const availableMetricGroups = useMemo(() => {
    const groupIdsMap = new Map<string, boolean>();
    [...goalMetrics, ...secondaryMetrics, ...guardrailMetrics].forEach((id) => {
      if (isMetricGroupId(id)) {
        groupIdsMap.set(id, true);
      }
    });
    const groupIds = Array.from(groupIdsMap.keys());
    return groupIds
      .map((id) => {
        const group = metricGroups.find((g) => g.id === id);
        return group ? { id: group.id, name: group.name } : null;
      })
      .filter((g) => g !== null) as Array<{ id: string; name: string }>;
  }, [goalMetrics, secondaryMetrics, guardrailMetrics, metricGroups]);

  // Extract all metric tags from expanded metrics
  const availableMetricTags = useMemo(() => {
    const expandedGoals = expandMetricGroups(goalMetrics, metricGroups);
    const expandedSecondaries = expandMetricGroups(
      secondaryMetrics,
      metricGroups,
    );
    const expandedGuardrails = expandMetricGroups(
      guardrailMetrics,
      metricGroups,
    );

    const allMetricTagsSet: Set<string> = new Set();
    [...expandedGoals, ...expandedSecondaries, ...expandedGuardrails].forEach(
      (metricId) => {
        const metric = getExperimentMetricById(metricId);
        metric?.tags?.forEach((tag) => {
          allMetricTagsSet.add(tag);
        });
      },
    );
    return Array.from(allMetricTagsSet);
  }, [
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    metricGroups,
    getExperimentMetricById,
  ]);

  // Extract all slice tags from expanded metrics
  const availableSliceTags = useMemo(() => {
    const sliceTagsMap = new Map<
      string,
      { datatypes: Record<string, FactTableColumnType>; isSelectAll?: boolean }
    >();

    // Build factTableMap for parseSliceQueryString
    const factTableMap: Record<string, FactTableInterface> = {};
    factTables.forEach((table) => {
      factTableMap[table.id] = table;
    });

    // Expand all metrics
    const expandedGoals = expandMetricGroups(goalMetrics, metricGroups);
    const expandedSecondaries = expandMetricGroups(
      secondaryMetrics,
      metricGroups,
    );
    const expandedGuardrails = expandMetricGroups(
      guardrailMetrics,
      metricGroups,
    );

    // Track all columns that appear in slices for "select all" generation
    const columnSet = new Set<string>();
    const columnDatatypeMap = new Map<string, FactTableColumnType>();

    // Extract from customMetricSlices
    // For custom slices, only generate the exact combinations defined (no permutations)
    if (customMetricSlices && customMetricSlices.length > 0) {
      customMetricSlices.forEach((group) => {
        // Build the exact slice combination for this group
        const slices: Record<string, string> = {};

        group.slices.forEach((slice) => {
          // Use the first level for each column (custom slices define one combination)
          const level = slice.levels[0] || "";
          slices[slice.column] = level;
        });

        // Generate a single tag for this exact combination
        const tag = generateSliceString(slices);
        // Parse the tag to get datatypes using parseSliceQueryString
        const sliceLevels = parseSliceQueryString(tag, factTableMap);
        const datatypes: Record<string, FactTableColumnType> = {};
        sliceLevels.forEach((sl) => {
          datatypes[sl.column] = sl.datatype;
          // Track column for "select all" generation
          columnSet.add(sl.column);
          if (sl.datatype) {
            columnDatatypeMap.set(sl.column, sl.datatype);
          }
        });
        sliceTagsMap.set(tag, { datatypes });
      });
    }

    // Extract from auto slice data for all fact metrics
    const allMetricIds = [
      ...expandedGoals,
      ...expandedSecondaries,
      ...expandedGuardrails,
    ];

    allMetricIds.forEach((metricId) => {
      const metric = getExperimentMetricById(metricId);

      if (metric && isFactMetric(metric)) {
        const factMetric = metric as FactMetricInterface;
        const factTableId = factMetric.numerator?.factTableId;

        if (factTableId) {
          const factTable = getFactTableById(factTableId);

          if (factTable) {
            const autoSliceData = createAutoSliceDataForMetric({
              parentMetric: metric,
              factTable,
              includeOther: true,
            });

            // Extract tags from slice data
            autoSliceData.forEach((slice: SliceDataForMetric) => {
              // Generate single dimension tags
              slice.sliceLevels.forEach((sliceLevel) => {
                const value = sliceLevel.levels[0] || "";
                const tag = generateSliceString({ [sliceLevel.column]: value });
                const datatypes = sliceLevel.datatype
                  ? { [sliceLevel.column]: sliceLevel.datatype }
                  : {};
                sliceTagsMap.set(tag, { datatypes });
                // Track column for "select all" generation
                columnSet.add(sliceLevel.column);
                if (sliceLevel.datatype) {
                  columnDatatypeMap.set(sliceLevel.column, sliceLevel.datatype);
                }
              });

              // Generate combined tag for multi-dimensional slices
              if (slice.sliceLevels.length > 1) {
                const slices: Record<string, string> = {};
                slice.sliceLevels.forEach((sl) => {
                  slices[sl.column] = sl.levels[0] || "";
                });
                const comboTag = generateSliceString(slices);
                // Parse the tag to get datatypes using parseSliceQueryString
                const sliceLevels = parseSliceQueryString(
                  comboTag,
                  factTableMap,
                );
                const datatypes: Record<string, FactTableColumnType> = {};
                sliceLevels.forEach((sl) => {
                  datatypes[sl.column] = sl.datatype;
                  // Track column for "select all" generation
                  columnSet.add(sl.column);
                  if (sl.datatype) {
                    columnDatatypeMap.set(sl.column, sl.datatype);
                  }
                });
                sliceTagsMap.set(comboTag, { datatypes });
              }
            });
          }
        }
      }
    });

    // Generate "select all" tags for each column (format: dim:column, no equals sign)
    columnSet.forEach((column) => {
      const datatype = columnDatatypeMap.get(column) || "string";
      const selectAllTag = `dim:${encodeURIComponent(column)}`;
      sliceTagsMap.set(selectAllTag, {
        datatypes: { [column]: datatype },
        isSelectAll: true,
      });
    });

    const sliceTags = Array.from(sliceTagsMap.entries()).map(
      ([id, { datatypes, isSelectAll }]) => ({ id, datatypes, isSelectAll }),
    );

    // Sort slices: group by column(s), put "select all" first, then regular values, then empty values
    return sliceTags.sort((a, b) => {
      // Extract column name from tag
      const getColumnFromTag = (tag: string): string => {
        if (!tag.startsWith("dim:")) return "";
        const withoutDim = tag.substring(4);
        const equalsIndex = withoutDim.indexOf("=");
        return decodeURIComponent(
          withoutDim.slice(0, equalsIndex >= 0 ? equalsIndex : undefined),
        );
      };

      const aColumn = getColumnFromTag(a.id);
      const bColumn = getColumnFromTag(b.id);
      const columnCompare = aColumn.localeCompare(bColumn);
      if (columnCompare !== 0) return columnCompare;

      // Same column: "select all" comes first
      if (a.isSelectAll && !b.isSelectAll) return -1;
      if (!a.isSelectAll && b.isSelectAll) return 1;

      // Both are regular slices, parse normally
      const aLevels = a.isSelectAll
        ? []
        : parseSliceQueryString(a.id, factTableMap);
      const bLevels = b.isSelectAll
        ? []
        : parseSliceQueryString(b.id, factTableMap);

      // For same first column, check if it's a multi-column slice
      if (aLevels.length !== bLevels.length) {
        // Single column slices come before multi-column
        return aLevels.length - bLevels.length;
      }

      // Compare each column level
      for (let i = 0; i < Math.min(aLevels.length, bLevels.length); i++) {
        const aValue = aLevels[i]?.levels[0] || "";
        const bValue = bLevels[i]?.levels[0] || "";
        const aDatatype = aLevels[i]?.datatype;
        const bDatatype = bLevels[i]?.datatype;

        // Empty values go to the end
        if (aValue === "" && bValue !== "") return 1;
        if (aValue !== "" && bValue === "") return -1;

        // Both non-empty or both empty: compare normally
        if (aValue !== bValue) {
          // Special handling for boolean: true comes before false
          if (aDatatype === "boolean" && bDatatype === "boolean") {
            if (aValue === "true" && bValue === "false") return -1;
            if (aValue === "false" && bValue === "true") return 1;
          }
          return aValue.localeCompare(bValue);
        }
      }

      // Fallback to ID comparison
      return a.id.localeCompare(b.id);
    });
  }, [
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    customMetricSlices,
    metricGroups,
    getExperimentMetricById,
    getFactTableById,
    factTables,
  ]);

  return {
    availableMetricTags,
    availableMetricGroups,
    availableSliceTags,
    // Filter state
    metricTagFilter,
    setMetricTagFilter,
    metricGroupsFilter,
    setMetricGroupsFilter,
    sliceTagsFilter,
    setSliceTagsFilter,
    // Sort state
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
  };
}
