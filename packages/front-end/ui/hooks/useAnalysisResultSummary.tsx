import { useState, useEffect, useRef } from "react";
import { ExperimentReportVariationWithIndex } from "back-end/types/report";
import {
  StatsEngine,
  PValueCorrection,
  DifferenceType,
} from "back-end/types/stats";
import { ExperimentTableRow, RowResults } from "@/services/experiments";

export function useAnalysisResultSummary({
  orderedVariations,
  rows,
  rowsResults,
  dimension: _dimension,
  statsEngine,
  differenceType,
  pValueCorrection,
  noTooltip,
}: {
  orderedVariations: ExperimentReportVariationWithIndex[];
  rows: ExperimentTableRow[];
  rowsResults: (RowResults | "query error" | null)[][];
  dimension?: string;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  pValueCorrection?: PValueCorrection;
  noTooltip?: boolean;
}) {
  const [openTooltipRowIndex, setOpenTooltipRowIndex] = useState<number | null>(
    null,
  );
  const [openTooltipVariationIndex, setOpenTooltipVariationIndex] = useState<
    number | null
  >(null);

  const isRowTooltipOpen = (rowIndex: number, variationIndex: number) => {
    return (
      openTooltipRowIndex === rowIndex &&
      openTooltipVariationIndex === variationIndex
    );
  };

  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleRowTooltipMouseEnter = (
    rowIndex: number,
    variationIndex: number,
  ) => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    setOpenTooltipRowIndex(rowIndex);
    setOpenTooltipVariationIndex(variationIndex);
  };

  const handleRowTooltipMouseLeave = (
    _rowIndex: number,
    _variationIndex: number,
  ) => {
    leaveTimeoutRef.current = setTimeout(() => {
      setOpenTooltipRowIndex(null);
      setOpenTooltipVariationIndex(null);
    }, 80);
  };

  useEffect(() => {
    return () => {
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
      }
    };
  }, []);

  const getTooltipData = (metricRow: number, variationRow: number) => {
    if (noTooltip) return;

    const row = rows[metricRow];
    const baseline = row.variations[orderedVariations[0].index] || {
      value: 0,
      cr: 0,
      users: 0,
    };
    const stats = row.variations[orderedVariations[variationRow].index] || {
      value: 0,
      cr: 0,
      users: 0,
    };
    const metric = row.metric;
    const variation = orderedVariations[variationRow];
    const baselineVariation = orderedVariations[0];
    const rowResults = rowsResults[metricRow][variationRow];
    if (!rowResults) return;
    if (rowResults === "query error") return;
    if (!rowResults.hasScaledImpact && differenceType === "scaled") return;

    return {
      metricRow,
      metric,
      metricSnapshotSettings: row.metricSnapshotSettings,
      dimensionName: _dimension,
      dimensionValue: _dimension ? row.label : undefined,
      sliceLevels: row.sliceLevels,
      variation,
      stats,
      baseline,
      baselineVariation,
      rowResults,
      statsEngine,
      pValueCorrection,
      isGuardrail: row.resultGroup === "guardrail",
    };
  };

  return {
    getTooltipData,
    isRowTooltipOpen,
    setOpenTooltipRowIndex,
    handleRowTooltipMouseEnter,
    handleRowTooltipMouseLeave,
  };
}
