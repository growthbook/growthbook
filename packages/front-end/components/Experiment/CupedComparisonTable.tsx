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

interface CupedComparisonTableProps {
  row: ExperimentTableRow;
  metric: ExperimentMetricInterface;
  variationNames: string[];
  differenceType: DifferenceType;
  statsEngine: StatsEngine;
  baselineRow?: number;
}

const CupedComparisonTable: FC<CupedComparisonTableProps> = ({
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
            <TableColumnHeader>CUPED Adjusted</TableColumnHeader>
            <TableColumnHeader>Post-strat</TableColumnHeader>
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

            // Main result (full CUPED + post-strat)
            const mainResult = variation;
            const mainCi = mainResult.ciAdjusted ?? mainResult.ci;
            const mainPValue = mainResult.pValueAdjusted ?? mainResult.pValue;

            // No CUPED (unadjusted)
            const cupedUnadjusted =
              variation.supplementalResultsCupedUnadjusted;
            const cupedUnadjustedCi = cupedUnadjusted?.ci;
            const cupedUnadjustedPValue = cupedUnadjusted?.pValue;

            // CUPED without post-strat
            const unstratified = variation.supplementalResultsUnstratified;
            const unstratifiedCi = unstratified?.ci;
            const unstratifiedPValue = unstratified?.pValue;

            return (
              <>
                {/* Row 1: Full CUPED + post-strat */}
                <TableRow key={`${index}-full`}>
                  {showVariationColumn && (
                    <TableRowHeaderCell>{variationName}</TableRowHeaderCell>
                  )}
                  <TableCell>Yes</TableCell>
                  <TableCell>On</TableCell>
                  <TableCell>
                    {formatSignificance(mainPValue, mainResult.chanceToWin)}
                  </TableCell>
                  <TableCell>
                    {formatEstimateWithCI(mainResult.expected, mainCi)}
                  </TableCell>
                </TableRow>

                {/* Row 2: No CUPED (unadjusted) */}
                {cupedUnadjusted && (
                  <TableRow key={`${index}-unadjusted`}>
                    {showVariationColumn && (
                      <TableRowHeaderCell>{variationName}</TableRowHeaderCell>
                    )}
                    <TableCell>Unadjusted</TableCell>
                    <TableCell>On</TableCell>
                    <TableCell>
                      {cupedUnadjusted.errorMessage ? (
                        <span style={{ color: "var(--red-9)" }}>
                          <em>{cupedUnadjusted.errorMessage}</em>
                        </span>
                      ) : (
                        formatSignificance(
                          cupedUnadjustedPValue,
                          cupedUnadjusted.chanceToWin,
                        )
                      )}
                    </TableCell>
                    <TableCell>
                      {cupedUnadjusted.errorMessage
                        ? "—"
                        : formatEstimateWithCI(
                            cupedUnadjusted.expected,
                            cupedUnadjustedCi,
                          )}
                    </TableCell>
                  </TableRow>
                )}

                {/* Row 3: CUPED without post-strat */}
                {unstratified && (
                  <TableRow key={`${index}-unstratified`}>
                    {showVariationColumn && (
                      <TableRowHeaderCell>{variationName}</TableRowHeaderCell>
                    )}
                    <TableCell>Yes</TableCell>
                    <TableCell>Off</TableCell>
                    <TableCell>
                      {unstratified.errorMessage ? (
                        <span style={{ color: "var(--red-9)" }}>
                          <em>{unstratified.errorMessage}</em>
                        </span>
                      ) : (
                        formatSignificance(
                          unstratifiedPValue,
                          unstratified.chanceToWin,
                        )
                      )}
                    </TableCell>
                    <TableCell>
                      {unstratified.errorMessage
                        ? "—"
                        : formatEstimateWithCI(
                            unstratified.expected,
                            unstratifiedCi,
                          )}
                    </TableCell>
                  </TableRow>
                )}
              </>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default CupedComparisonTable;
