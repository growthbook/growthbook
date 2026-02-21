import { Flex, Text } from "@radix-ui/themes";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import {
  ExperimentMetricInterface,
  quantileMetricType,
  isFactMetric,
} from "shared/experiments";
import Table, {
  TableHeader,
  TableRow,
  TableColumnHeader,
  TableBody,
  TableCell,
} from "@/ui/Table";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { getVariationColor } from "@/services/features";
import {
  formatNumber,
  getColumnRefFormatter,
  getMetricFormatter,
  getPercentileLabel,
} from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import MetricValueColumn from "@/components/Experiment/MetricValueColumn";

const numberFormatter = Intl.NumberFormat();

export interface VariationStatRow {
  variationIndex: number;
  variationName: string;
  stats: SnapshotMetric;
  isBaseline: boolean;
}

interface VariationStatsTableProps {
  metric: ExperimentMetricInterface;
  rows: VariationStatRow[];
  isBandit?: boolean;
  ssrPolyfills?: SSRPolyfills;
}

export default function VariationStatsTable({
  metric,
  rows,
  isBandit,
  ssrPolyfills,
}: VariationStatsTableProps) {
  const _currency = useCurrency();
  const displayCurrency = ssrPolyfills?.useCurrency?.() || _currency;

  const { getExperimentMetricById, getFactTableById: _getFactTableById } =
    useDefinitions();
  const getFactTableById = ssrPolyfills?.getFactTableById || _getFactTableById;

  // Determine column visibility based on metric type
  const quantileMetric = quantileMetricType(metric);
  const quantileIgnoreZeros =
    isFactMetric(metric) && metric.quantileSettings?.ignoreZeros;
  const quantileValue = isFactMetric(metric)
    ? metric.quantileSettings?.quantile
    : undefined;

  const hasCustomDenominator =
    ((isFactMetric(metric) && metric.metricType === "ratio") ||
      !!metric.denominator) &&
    !quantileMetric;

  let denomFormatter = formatNumber;
  if (hasCustomDenominator && isFactMetric(metric) && !!metric.denominator) {
    denomFormatter = getColumnRefFormatter(
      metric.denominator,
      getFactTableById,
    );
  }

  return (
    <Table size="1">
      <TableHeader>
        <TableRow style={{ color: "var(--color-text-mid)", fontSize: "12px" }}>
          <TableColumnHeader pl="0">Variation</TableColumnHeader>
          <TableColumnHeader justify="end">
            {quantileMetric && quantileIgnoreZeros ? "Non-zero " : ""}
            {quantileMetric === "event" ? "Events" : "Units"}
          </TableColumnHeader>
          {!quantileMetric ? (
            <TableColumnHeader justify="end">
              Numerator
              {isBandit && (
                <>
                  <br />
                  <div className="small" style={{ marginTop: -2 }}>
                    (adjusted)
                  </div>
                </>
              )}
            </TableColumnHeader>
          ) : null}
          {hasCustomDenominator ? (
            <TableColumnHeader justify="end">Denom.</TableColumnHeader>
          ) : null}
          {quantileMetric && quantileValue ? (
            <TableColumnHeader justify="end">
              {getPercentileLabel(quantileValue)}
            </TableColumnHeader>
          ) : (
            <TableColumnHeader justify="end">Value</TableColumnHeader>
          )}
        </TableRow>
      </TableHeader>

      <TableBody>
        {rows.map((row) => {
          const variationColor = getVariationColor(row.variationIndex, true);
          return (
            <TableRow
              key={`variation_stats_row_${row.variationIndex}`}
              style={{
                color: "var(--color-text-high)",
                fontWeight: 500,
                fontSize: "12px",
              }}
            >
              <TableCell pl="0">
                <Flex align="start" gap="2">
                  <span
                    style={{
                      color: variationColor,
                      borderColor: variationColor,
                      fontSize: "12px",
                      width: 16,
                      height: 16,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderStyle: "solid",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    {row.variationIndex}
                  </span>
                  <Flex direction="column">
                    <Text
                      weight="bold"
                      className="text-ellipsis"
                      style={{ maxWidth: 90 }}
                    >
                      {row.variationName}
                    </Text>
                    {row.isBaseline ? (
                      <Text
                        size="1"
                        style={{ color: "var(--color-text-mid)" }}
                        weight="regular"
                      >
                        BASELINE
                      </Text>
                    ) : null}
                  </Flex>
                </Flex>
              </TableCell>

              <TableCell justify="end">
                {quantileMetric && row.stats.stats
                  ? numberFormatter.format(row.stats.stats.count)
                  : numberFormatter.format(row.stats.users)}
              </TableCell>

              {!quantileMetric ? (
                <TableCell justify="end">
                  {isFactMetric(metric)
                    ? getColumnRefFormatter(metric.numerator, getFactTableById)(
                        row.stats.value,
                        { currency: displayCurrency },
                      )
                    : getMetricFormatter(
                        metric.type === "binomial" ? "count" : metric.type,
                      )(row.stats.value, { currency: displayCurrency })}
                </TableCell>
              ) : null}

              {hasCustomDenominator ? (
                <TableCell justify="end">
                  {denomFormatter(row.stats.denominator || row.stats.users, {
                    currency: displayCurrency,
                  })}
                </TableCell>
              ) : null}

              <TableCell justify="end">
                <MetricValueColumn
                  metric={metric}
                  stats={row.stats}
                  users={row.stats?.users || 0}
                  showRatio={false}
                  displayCurrency={displayCurrency}
                  getExperimentMetricById={
                    ssrPolyfills?.getExperimentMetricById ||
                    getExperimentMetricById
                  }
                  getFactTableById={getFactTableById}
                  asTd={false}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
