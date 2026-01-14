import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  blockHasFieldOfType,
} from "shared/enterprise";
import { DifferenceType } from "shared/types/stats";
import { isNumber, isStringArray } from "shared/util";
import { ExperimentReportVariation } from "shared/types/report";

export function useDashboardEditorHooks<
  B extends DashboardBlockInterfaceOrData<DashboardBlockInterface>,
>(
  block: B,
  setBlock: React.Dispatch<B> | undefined,
  variations?: ExperimentReportVariation[],
) {
  // Use a ref to always have the latest block value for setters
  const blockRef = useRef(block);
  useEffect(() => {
    blockRef.current = block;
  }, [block]);
  // Extract current values from block
  const sortBy = blockHasFieldOfType(
    block,
    "sortBy",
    (val) => val === null || typeof val === "string",
  )
    ? block.sortBy
    : null;

  const sortDirection = blockHasFieldOfType(
    block,
    "sortDirection",
    (val) => val === null || val === "asc" || val === "desc",
  )
    ? block.sortDirection
    : null;

  const baselineRow = blockHasFieldOfType(block, "baselineRow", isNumber)
    ? block.baselineRow
    : 0;

  // Normalize variationIds: if it contains all possible variation IDs, convert to empty array (select all)
  const variationIds = useMemo(() => {
    const rawVariationIds = blockHasFieldOfType(
      block,
      "variationIds",
      isStringArray,
    )
      ? block.variationIds || []
      : [];
    if (!variations || rawVariationIds.length === 0) return [];
    const allVariationIds = variations.map((v) => v.id);
    // If variationIds contains all variations, normalize to empty array (select all)
    if (
      rawVariationIds.length === allVariationIds.length &&
      rawVariationIds.every((id) => allVariationIds.includes(id))
    ) {
      return [];
    }
    return rawVariationIds;
  }, [block, variations]);

  const differenceType = blockHasFieldOfType(
    block,
    "differenceType",
    (val): val is DifferenceType =>
      val === "relative" || val === "absolute" || val === "scaled",
  )
    ? block.differenceType
    : "relative";

  // Convert variationIds to variationFilter (number[] for ResultsTable)
  // Empty array means "show all", so variationFilter should be undefined
  const variationFilter = useMemo(() => {
    if (!variations || variationIds.length === 0) return undefined;
    const indexedVariations = variations.map((v, i) => ({ ...v, index: i }));
    return indexedVariations
      .filter((v) => !variationIds.includes(v.id))
      .map((v) => v.index);
  }, [variations, variationIds]);

  // Setters
  const setSortBy = useCallback(
    (value: "metrics" | "metricTags" | "significance" | "change" | null) => {
      if (!setBlock) return;
      const currentBlock = blockRef.current;
      // Clear sortDirection when switching away from significance/change
      // ResultsTable will set sortDirection separately when needed
      if (
        blockHasFieldOfType(
          currentBlock,
          "sortBy",
          (val) => val === null || typeof val === "string",
        ) &&
        blockHasFieldOfType(
          currentBlock,
          "sortDirection",
          (val) => val === null || val === "asc" || val === "desc",
        )
      ) {
        const newBlock = {
          ...currentBlock,
          sortBy: value,
          sortDirection: (value === "significance" || value === "change"
            ? currentBlock.sortDirection
            : null) as (typeof currentBlock)["sortDirection"],
        } as B;
        blockRef.current = newBlock;
        setBlock(newBlock);
      }
    },
    [setBlock],
  );

  const setSortDirection = useCallback(
    (value: "asc" | "desc" | null) => {
      if (!setBlock) return;
      const currentBlock = blockRef.current;
      if (
        blockHasFieldOfType(
          currentBlock,
          "sortDirection",
          (val) => val === null || val === "asc" || val === "desc",
        )
      ) {
        const newBlock = {
          ...currentBlock,
          sortDirection: value,
        } as B;
        blockRef.current = newBlock;
        setBlock(newBlock);
      }
    },
    [setBlock],
  );

  const setBaselineRow = useCallback(
    (value: number) => {
      if (!setBlock) return;
      const currentBlock = blockRef.current;
      const newBlock = {
        ...currentBlock,
        baselineRow: value,
      } as B;
      blockRef.current = newBlock;
      setBlock(newBlock);
    },
    [setBlock],
  );

  const setVariationIds = useCallback(
    (value: string[]) => {
      if (!setBlock) return;
      const currentBlock = blockRef.current;
      // Normalize: if all variations are selected, store empty array (select all)
      const allVariationIds = variations?.map((v) => v.id) || [];
      const normalizedValue =
        value.length === allVariationIds.length ? [] : value;
      const newBlock = {
        ...currentBlock,
        variationIds: normalizedValue,
      } as B;
      blockRef.current = newBlock;
      setBlock(newBlock);
    },
    [setBlock, variations],
  );

  // Setter for variationFilter (number[]) - converts back to variationIds
  // If all variations are selected (empty filter), store empty array (select all)
  const setVariationFilter = useCallback(
    (filter: number[]) => {
      if (!setBlock || !variations) return;
      const currentBlock = blockRef.current;
      const indexedVariations = variations.map((v, i) => ({ ...v, index: i }));
      const filteredVariationIds = indexedVariations
        .filter((v) => !filter.includes(v.index))
        .map((v) => v.id);

      // If all variations are selected (filter is empty or contains all indices),
      // store empty array to represent "select all"
      const allVariationIds = indexedVariations.map((v) => v.id);
      const normalizedVariationIds =
        filteredVariationIds.length === allVariationIds.length
          ? []
          : filteredVariationIds;

      const newBlock = {
        ...currentBlock,
        variationIds: normalizedVariationIds,
      } as B;
      blockRef.current = newBlock;
      setBlock(newBlock);
    },
    [setBlock, variations],
  );

  const setDifferenceType = useCallback(
    (value: DifferenceType) => {
      if (!setBlock) return;
      const currentBlock = blockRef.current;
      const newBlock = {
        ...currentBlock,
        differenceType: value,
      } as B;
      blockRef.current = newBlock;
      setBlock(newBlock);
    },
    [setBlock],
  );

  // Expanded metrics state (for metric expansion/collapse)
  const [expandedMetrics, setExpandedMetrics] = useState<
    Record<string, boolean>
  >({});

  const toggleExpandedMetric = useCallback(
    (metricId: string, resultGroup: "goal" | "secondary" | "guardrail") => {
      const key = `${metricId}:${resultGroup}`;
      setExpandedMetrics((prev) => ({
        ...prev,
        [key]: !prev[key],
      }));
    },
    [],
  );

  return {
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    baselineRow,
    setBaselineRow,
    variationIds,
    setVariationIds,
    variationFilter,
    setVariationFilter,
    differenceType,
    setDifferenceType,
    expandedMetrics,
    toggleExpandedMetric,
  };
}
