import { ExperimentReportVariation } from "shared/types/report";
import {
  CovariateImbalanceResult,
  MetricVariationCovariateImbalanceResult,
} from "shared/health";
import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { pValueFormatter } from "@/services/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";

export interface Props {
  covariateImbalanceResult: CovariateImbalanceResult | null;
  variations: ExperimentReportVariation[];
  goalMetricIds: string[];
  secondaryMetricIds: string[];
  guardrailMetricIds: string[];
  srm?: number;
}

type CovariateImbalanceDisplayRow =
  | MetricVariationCovariateImbalanceResult
  | {
      metricId: string;
      noData: true;
    };

const meanFormatter = Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const standardErrorFormatter = Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

const percentageFormatter = Intl.NumberFormat(undefined, {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const INITIAL_VISIBLE_ROW_COUNT = 5;
const SHOW_MORE_CHUNK_SIZE = 10;

const covariateImbalanceColumnWidths = {
  metric: "20%",
  variation: "15%",
  pValue: "10%",
  baselineMean: "20%",
  variationMean: "20%",
  pctChange: "10%",
} as const;

function sortCovariateRowsImbalancedFirst(
  rows: MetricVariationCovariateImbalanceResult[],
): MetricVariationCovariateImbalanceResult[] {
  return [...rows].sort((a, b) => {
    const aImbalanced = a.isImbalanced ?? true;
    const bImbalanced = b.isImbalanced ?? true;
    if (aImbalanced !== bImbalanced) {
      return aImbalanced ? -1 : 1;
    }
    return a.pValue - b.pValue;
  });
}

function buildRowsForMetricIds(
  allRows: MetricVariationCovariateImbalanceResult[],
  metricIds: string[],
): CovariateImbalanceDisplayRow[] {
  const metricIdSet = new Set(metricIds);
  const matchingRows = sortCovariateRowsImbalancedFirst(
    allRows.filter((row) => metricIdSet.has(row.metricId)),
  );
  const renderedMetricIds = new Set(matchingRows.map((row) => row.metricId));
  const missingRows = metricIds
    .filter((metricId) => !renderedMetricIds.has(metricId))
    .map((metricId) => ({
      metricId,
      noData: true as const,
    }));

  return [...matchingRows, ...missingRows];
}

function splitRowsByMetricType(
  covariateImbalanceResult: CovariateImbalanceResult | null,
  goalMetricIds: string[],
  secondaryMetricIds: string[],
  guardrailMetricIds: string[],
) {
  const rows =
    covariateImbalanceResult?.metricVariationCovariateImbalanceResults ?? [];
  const goalRows = buildRowsForMetricIds(rows, goalMetricIds);
  const secondaryRows = buildRowsForMetricIds(rows, secondaryMetricIds);
  const guardrailRows = buildRowsForMetricIds(rows, guardrailMetricIds);

  return { goalRows, guardrailRows, secondaryRows };
}

interface CovariateImbalanceTableProps {
  type: "Goal" | "Secondary" | "Guardrail";
  rows: CovariateImbalanceDisplayRow[];
  variations: ExperimentReportVariation[];
}

function CovariateImbalanceTableSection({
  type,
  rows,
  variations,
}: CovariateImbalanceTableProps) {
  const [visibleRowCount, setVisibleRowCount] = useState(
    INITIAL_VISIBLE_ROW_COUNT,
  );
  const { getExperimentMetricById } = useDefinitions();

  const visibleRows = rows.slice(0, visibleRowCount);

  if (!rows.length) return null;
  return (
    <Box mb="4">
      <Table size="1" layout="fixed" mx="2" mt="0" mb="2">
        <TableHeader>
          <TableRow>
            <TableColumnHeader width={covariateImbalanceColumnWidths.metric}>
              {type} Metrics <Text weight="regular">({rows.length})</Text>
            </TableColumnHeader>
            <TableColumnHeader width={covariateImbalanceColumnWidths.variation}>
              Variation
            </TableColumnHeader>
            <TableColumnHeader
              width={covariateImbalanceColumnWidths.pValue}
              justify="end"
            >
              p-value
            </TableColumnHeader>
            <TableColumnHeader
              width={covariateImbalanceColumnWidths.baselineMean}
              justify="end"
            >
              Baseline mean (std)
            </TableColumnHeader>
            <TableColumnHeader
              width={covariateImbalanceColumnWidths.variationMean}
              justify="end"
            >
              Variation mean (std)
            </TableColumnHeader>
            <TableColumnHeader
              width={covariateImbalanceColumnWidths.pctChange}
              justify="end"
            >
              % Change
            </TableColumnHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((row) => {
            const hasData = !("noData" in row);
            const variation = hasData ? variations[row.variation] : undefined;
            const metric = getExperimentMetricById(row.metricId);

            return (
              <TableRow
                key={
                  hasData ? `${row.metricId}-${row.variation}` : row.metricId
                }
              >
                <TableCell width={covariateImbalanceColumnWidths.metric}>
                  <b>{metric?.name ?? row.metricId}</b>
                </TableCell>
                <TableCell
                  width={covariateImbalanceColumnWidths.variation}
                  className={
                    hasData
                      ? `variation with-variation-label variation${row.variation}`
                      : undefined
                  }
                >
                  {hasData ? (
                    <Flex align="center" gap="2">
                      <Box
                        as="span"
                        className="label"
                        style={{
                          width: 20,
                          height: 20,
                        }}
                      >
                        {row.variation}
                      </Box>{" "}
                      {variation?.name ?? ""}
                    </Flex>
                  ) : (
                    <Text as="span" color="text-low">
                      <i>No data</i>
                    </Text>
                  )}
                </TableCell>
                <TableCell
                  width={covariateImbalanceColumnWidths.pValue}
                  justify="end"
                  style={{
                    backgroundColor:
                      hasData && row.isImbalanced ? "var(--red-a3)" : undefined,
                  }}
                >
                  {hasData ? (
                    pValueFormatter(row.pValue)
                  ) : (
                    <Text as="span" color="text-low">
                      <i>No data</i>
                    </Text>
                  )}
                </TableCell>
                <TableCell
                  width={covariateImbalanceColumnWidths.baselineMean}
                  justify="end"
                >
                  {hasData ? (
                    <>
                      <Text as="span" weight="semibold">
                        {meanFormatter.format(row.baselineMean)}
                      </Text>
                      {row.baselineStandardError !== undefined &&
                        ` (${standardErrorFormatter.format(
                          row.baselineStandardError,
                        )})`}
                    </>
                  ) : (
                    <Text as="span" color="text-low">
                      <i>No data</i>
                    </Text>
                  )}
                </TableCell>
                <TableCell
                  width={covariateImbalanceColumnWidths.variationMean}
                  justify="end"
                >
                  {hasData ? (
                    <>
                      <Text as="span" weight="semibold">
                        {meanFormatter.format(row.variationMean)}
                      </Text>
                      {row.variationStandardError !== undefined &&
                        ` (${standardErrorFormatter.format(
                          row.variationStandardError,
                        )})`}
                    </>
                  ) : (
                    <Text as="span" color="text-low">
                      <i>No data</i>
                    </Text>
                  )}
                </TableCell>
                <TableCell
                  width={covariateImbalanceColumnWidths.pctChange}
                  justify="end"
                >
                  {hasData ? (
                    row.baselineMean !== 0 ? (
                      percentageFormatter.format(
                        (row.variationMean - row.baselineMean) /
                          row.baselineMean,
                      )
                    ) : (
                      "-"
                    )
                  ) : (
                    <Text as="span" color="text-low">
                      <i>No data</i>
                    </Text>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {visibleRowCount < rows.length && (
        <Box mx="2">
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              setVisibleRowCount((count) =>
                Math.min(count + SHOW_MORE_CHUNK_SIZE, rows.length),
              )
            }
          >
            Show more...
          </Button>
        </Box>
      )}
    </Box>
  );
}

export default function CovariateImbalanceTable({
  covariateImbalanceResult,
  variations,
  goalMetricIds,
  secondaryMetricIds,
  guardrailMetricIds,
}: Props) {
  const { goalRows, guardrailRows, secondaryRows } = useMemo(
    () =>
      splitRowsByMetricType(
        covariateImbalanceResult,
        goalMetricIds,
        secondaryMetricIds,
        guardrailMetricIds,
      ),
    [
      covariateImbalanceResult,
      goalMetricIds,
      secondaryMetricIds,
      guardrailMetricIds,
    ],
  );
  return (
    <>
      <CovariateImbalanceTableSection
        type="Goal"
        rows={goalRows}
        variations={variations}
      />
      <CovariateImbalanceTableSection
        type="Secondary"
        rows={secondaryRows}
        variations={variations}
      />
      <CovariateImbalanceTableSection
        type="Guardrail"
        rows={guardrailRows}
        variations={variations}
      />
    </>
  );
}
