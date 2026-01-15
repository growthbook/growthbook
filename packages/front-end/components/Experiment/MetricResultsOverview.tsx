import { FC } from "react";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentTableRow, pValueFormatter } from "@/services/experiments";
import {
  formatPercent,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCurrency } from "@/hooks/useCurrency";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

interface MetricResultsOverviewProps {
  row?: ExperimentTableRow;
  metric: ExperimentMetricInterface;
  variationNames: string[];
  differenceType: DifferenceType;
  statsEngine: StatsEngine;
  baselineRow?: number;
}

const MetricResultsOverview: FC<MetricResultsOverviewProps> = ({
  row,
  metric,
  variationNames,
  differenceType,
  statsEngine,
  baselineRow = 0,
}) => {
  const { getFactTableById } = useDefinitions();
  const displayCurrency = useCurrency();

  if (!row) return null;

  const formatter =
    differenceType === "relative"
      ? formatPercent
      : getExperimentMetricFormatter(
          metric,
          getFactTableById,
          differenceType === "absolute" ? "percentagePoints" : "number",
        );

  const formatterOptions: Intl.NumberFormatOptions = {
    currency: displayCurrency,
    ...(differenceType === "relative" ? { maximumFractionDigits: 1 } : {}),
  };

  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  });

  const formatValue = (value: number | undefined) => {
    if (value === undefined) return "—";
    return formatter(value, formatterOptions);
  };

  const formatCI = (ci: [number, number] | undefined) => {
    if (!ci || ci[0] === null || ci[1] === null) return "";
    return `[${formatter(ci[0], formatterOptions)}, ${formatter(ci[1], formatterOptions)}]`;
  };

  // For experiments with 2 variations (baseline + 1 treatment), show single row
  // For experiments with 3+ variations, this shows just the first variation's stats
  // Note: This matches the "compact results" view from ResultsTable
  const firstVariation = row.variations.find((_, i) => i !== baselineRow);

  return (
    <div style={{ overflowX: "auto", maxWidth: "100%" }}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Control</TableColumnHeader>
            {variationNames.map((name, i) => {
              if (i === baselineRow) return null;
              return <TableColumnHeader key={i}>{name}</TableColumnHeader>;
            })}
            <TableColumnHeader>
              {statsEngine === "bayesian" ? "Chance to Win" : "P-value"}
            </TableColumnHeader>
            <TableColumnHeader>
              {differenceType === "relative" ? "% Change" : "Change"}
            </TableColumnHeader>
            <TableColumnHeader>CI</TableColumnHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>
              {formatter(row.variations[baselineRow]?.value, formatterOptions)}
            </TableCell>
            {row.variations.map((variation, i) => {
              if (i === baselineRow) return null;
              return (
                <TableCell key={i}>
                  {formatter(variation?.value, formatterOptions)}
                </TableCell>
              );
            })}
            <TableCell>
              {!firstVariation
                ? "—"
                : statsEngine === "bayesian"
                  ? firstVariation.chanceToWin !== undefined
                    ? percentFormatter.format(firstVariation.chanceToWin)
                    : "—"
                  : firstVariation.pValueAdjusted !== undefined ||
                      firstVariation.pValue !== undefined
                    ? pValueFormatter(
                        (firstVariation.pValueAdjusted ??
                          firstVariation.pValue)!,
                      )
                    : "—"}
            </TableCell>
            <TableCell>
              {firstVariation ? formatValue(firstVariation.expected) : "—"}
            </TableCell>
            <TableCell>
              {!firstVariation
                ? "—"
                : formatCI(firstVariation.ciAdjusted ?? firstVariation.ci)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
};

export default MetricResultsOverview;
