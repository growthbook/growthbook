import { FC } from "react";
import { ExperimentMetricInterface } from "shared/experiments";
import { DifferenceType, StatsEngine } from "shared/types/stats";
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
  TableRowHeaderCell,
} from "@/ui/Table";

interface CappingComparisonTableProps {
  row: ExperimentTableRow;
  metric: ExperimentMetricInterface;
  variationNames: string[];
  differenceType: DifferenceType;
  statsEngine: StatsEngine;
  baselineRow?: number;
}

const CappingComparisonTable: FC<CappingComparisonTableProps> = ({
  row,
  metric,
  variationNames,
  differenceType,
  statsEngine,
  baselineRow = 0,
}) => {
  const { getFactTableById } = useDefinitions();
  const displayCurrency = useCurrency();

  // Determine if we should show the variation column
  const nonBaselineVariations = row.variations.filter(
    (_, index) => index !== baselineRow,
  );
  const showVariationColumn = nonBaselineVariations.length > 1;

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

  const formatEstimateWithCI = (
    expected: number | undefined,
    ci: [number | null, number | null] | undefined,
  ) => {
    if (expected === undefined || !ci || ci[0] === null || ci[1] === null)
      return "—";
    return `${formatter(expected, formatterOptions)} [${formatter(ci[0], formatterOptions)}, ${formatter(ci[1], formatterOptions)}]`;
  };

  const formatSignificance = (
    pValue: number | undefined,
    chanceToWin: number | undefined,
  ) => {
    if (statsEngine === "bayesian") {
      return chanceToWin !== undefined
        ? percentFormatter.format(chanceToWin)
        : "—";
    }
    return pValue !== undefined ? pValueFormatter(pValue) : "—";
  };

  return (
    <div style={{ overflowX: "auto", maxWidth: "100%" }}>
      <Table>
        <TableHeader>
          <TableRow>
            {showVariationColumn && (
              <TableColumnHeader>Variation</TableColumnHeader>
            )}
            <TableColumnHeader>Capping</TableColumnHeader>
            <TableColumnHeader>
              {statsEngine === "bayesian" ? "Chance to Win" : "P-value"}
            </TableColumnHeader>
            <TableColumnHeader>Estimate (CI)</TableColumnHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {row.variations.map((variation, index) => {
            // Skip baseline
            if (index === baselineRow) return null;

            const variationName = variationNames[index] || `Variation ${index}`;

            // Main result (with capping)
            const mainResult = variation;
            const mainCi = mainResult.ciAdjusted ?? mainResult.ci;
            const mainPValue = mainResult.pValueAdjusted ?? mainResult.pValue;

            // Uncapped result
            const uncapped = variation.supplementalResultsUncapped;
            const uncappedCi = uncapped?.ci;
            const uncappedPValue = uncapped?.pValue;

            return (
              <>
                {/* Row 1: With capping */}
                <TableRow key={`${index}-capped`}>
                  {showVariationColumn && (
                    <TableRowHeaderCell>{variationName}</TableRowHeaderCell>
                  )}
                  <TableCell>Capped</TableCell>
                  <TableCell>
                    {formatSignificance(mainPValue, mainResult.chanceToWin)}
                  </TableCell>
                  <TableCell>
                    {formatEstimateWithCI(mainResult.expected, mainCi)}
                  </TableCell>
                </TableRow>

                {/* Row 2: Without capping */}
                <TableRow key={`${index}-uncapped`}>
                  {showVariationColumn && (
                    <TableRowHeaderCell>{variationName}</TableRowHeaderCell>
                  )}
                  <TableCell>Uncapped</TableCell>
                  <TableCell>
                    {uncapped ? (
                      uncapped.errorMessage ? (
                        <span style={{ color: "var(--red-9)" }}>
                          <em>{uncapped.errorMessage}</em>
                        </span>
                      ) : (
                        formatSignificance(uncappedPValue, uncapped.chanceToWin)
                      )
                    ) : (
                      <span style={{ color: "var(--gray-9)" }}>
                        <em>Not available</em>
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {uncapped ? (
                      uncapped.errorMessage ? (
                        "—"
                      ) : (
                        formatEstimateWithCI(uncapped.expected, uncappedCi)
                      )
                    ) : (
                      <span style={{ color: "var(--gray-9)" }}>
                        <em>Not available</em>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              </>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default CappingComparisonTable;
