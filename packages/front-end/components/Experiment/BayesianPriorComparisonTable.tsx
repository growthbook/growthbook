import { FC } from "react";
import { ExperimentMetricInterface } from "shared/experiments";
import { DifferenceType } from "shared/types/stats";
import { ExperimentTableRow } from "@/services/experiments";
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

interface BayesianPriorComparisonTableProps {
  row: ExperimentTableRow;
  metric: ExperimentMetricInterface;
  variationNames: string[];
  differenceType: DifferenceType;
  baselineRow?: number;
}

const BayesianPriorComparisonTable: FC<BayesianPriorComparisonTableProps> = ({
  row,
  metric,
  variationNames,
  differenceType,
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

  return (
    <div style={{ overflowX: "auto", maxWidth: "100%" }}>
      <Table>
        <TableHeader>
          <TableRow>
            {showVariationColumn && (
              <TableColumnHeader>Variation</TableColumnHeader>
            )}
            <TableColumnHeader>Prior Type</TableColumnHeader>
            <TableColumnHeader>Chance to Win</TableColumnHeader>
            <TableColumnHeader>Estimate (CI)</TableColumnHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {row.variations.map((variation, index) => {
            // Skip baseline
            if (index === baselineRow) return null;

            const variationName = variationNames[index] || `Variation ${index}`;

            // Main result (with proper prior)
            const mainResult = variation;
            const mainCi = mainResult.ciAdjusted ?? mainResult.ci;

            // Flat prior result
            const flatPrior = variation.supplementalResultsFlatPrior;
            const flatPriorCi = flatPrior?.ci;

            return (
              <>
                {/* Row 1: With proper prior */}
                <TableRow key={`${index}-proper`}>
                  {showVariationColumn && (
                    <TableRowHeaderCell>{variationName}</TableRowHeaderCell>
                  )}
                  <TableCell>Proper</TableCell>
                  <TableCell>
                    {mainResult.chanceToWin !== undefined
                      ? percentFormatter.format(mainResult.chanceToWin)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {formatEstimateWithCI(mainResult.expected, mainCi)}
                  </TableCell>
                </TableRow>

                {/* Row 2: With flat prior */}
                <TableRow key={`${index}-flat`}>
                  {showVariationColumn && (
                    <TableRowHeaderCell>{variationName}</TableRowHeaderCell>
                  )}
                  <TableCell>Flat (Improper)</TableCell>
                  <TableCell>
                    {flatPrior ? (
                      flatPrior.errorMessage ? (
                        <span style={{ color: "var(--red-9)" }}>
                          <em>{flatPrior.errorMessage}</em>
                        </span>
                      ) : flatPrior.chanceToWin !== undefined ? (
                        percentFormatter.format(flatPrior.chanceToWin)
                      ) : (
                        "—"
                      )
                    ) : (
                      <span style={{ color: "var(--gray-9)" }}>
                        <em>Not available</em>
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {flatPrior ? (
                      flatPrior.errorMessage ? (
                        "—"
                      ) : (
                        formatEstimateWithCI(flatPrior.expected, flatPriorCi)
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

export default BayesianPriorComparisonTable;
