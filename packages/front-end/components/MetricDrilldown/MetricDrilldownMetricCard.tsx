import { ReactNode } from "react";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { FaExternalLinkAlt } from "react-icons/fa";
import {
  FactMetricInterface,
  FactTableInterface,
  RowFilter,
} from "shared/types/fact-table";
import {
  ExperimentMetricInterface,
  getAggregateFilters,
  isBinomialMetric,
  isFactMetric,
  isRatioMetric,
} from "shared/experiments";
import { getRowFilterSQL } from "shared/src/experiments";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getPercentileLabel } from "@/services/metrics";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";

interface MetricDrilldownMetricCardProps {
  metric: ExperimentMetricInterface;
  type: "numerator" | "denominator";
}

function FactTableLink({ id }: { id?: string }) {
  const { getFactTableById } = useDefinitions();
  const factTable = getFactTableById(id || "");

  if (!factTable) return <em className="text-muted">Unknown Fact Table</em>;

  return (
    <Link href={`/fact-tables/${factTable.id}`} target="_blank">
      {factTable.name} <FaExternalLinkAlt />
    </Link>
  );
}

function RowFilterDisplay({
  rowFilters,
  factTable,
}: {
  rowFilters: RowFilter[];
  factTable?: FactTableInterface | null;
}) {
  if (!rowFilters.length) return null;

  const text = `WHERE ${
    factTable
      ? rowFilters
          .map((rf) =>
            getRowFilterSQL({
              rowFilter: rf,
              factTable,
              escapeStringLiteral: (s) => s.replace(/'/g, "''"),
              evalBoolean: (col, value) =>
                `${col} IS ${value ? "TRUE" : "FALSE"}`,
              jsonExtract: (col, path) => `${col}.${path}`,
              showSourceComment: true,
            }),
          )
          .join("\nAND ")
      : rowFilters
          .map((rf) => `${rf.column} ${rf.operator} ${rf.values?.join(", ")}`)
          .join("\nAND ")
  }`;

  return <InlineCode language="sql" code={text} />;
}

function getColumnDisplayValue(column: string): string {
  if (column === "$$count") return "Count of Rows";
  if (column === "$$distinctUsers") return "Unique Users";
  if (column === "$$distinctDates") return "Distinct Dates";
  return column;
}

interface DataItem {
  label: string;
  value: ReactNode;
}

function buildNumeratorData(
  factMetric: FactMetricInterface,
  factTable: FactTableInterface | null,
): DataItem[] {
  const userFilters = getAggregateFilters({
    columnRef: factMetric.numerator,
    column:
      factMetric.numerator.aggregateFilterColumn === "$$count"
        ? `COUNT(*)`
        : `SUM(${factMetric.numerator.aggregateFilterColumn})`,
    ignoreInvalid: true,
  });

  const data: DataItem[] = [
    {
      label: "Fact Table",
      value: <FactTableLink id={factMetric.numerator.factTableId} />,
    },
  ];

  // Row Filter
  if (factMetric.numerator.rowFilters?.length) {
    data.push({
      label: "Row Filter",
      value: (
        <RowFilterDisplay
          rowFilters={factMetric.numerator.rowFilters}
          factTable={factTable}
        />
      ),
    });
  }

  // Value (for non-binomial metrics)
  if (!isBinomialMetric(factMetric)) {
    data.push({
      label: "Value",
      value: getColumnDisplayValue(factMetric.numerator.column),
    });
  }

  // Per-User Aggregation or User Filter
  if (
    !factMetric.numerator.column.startsWith("$$") &&
    (factMetric.metricType !== "quantile" ||
      factMetric.quantileSettings?.type === "unit")
  ) {
    data.push({
      label: "Per-User Aggregation",
      value: (factMetric.numerator.aggregation || "SUM").toUpperCase(),
    });
  } else if (userFilters.length > 0) {
    data.push({
      label: "User Filter",
      value: userFilters.join(" AND "),
    });
  }

  // Quantile settings
  if (factMetric.metricType === "quantile") {
    data.push({
      label: "Quantile Scope",
      value: factMetric.quantileSettings?.type || "",
    });
    data.push({
      label: "Ignore Zeros",
      value: factMetric.quantileSettings?.ignoreZeros ? "Yes" : "No",
    });
    data.push({
      label: "Quantile",
      value: getPercentileLabel(factMetric.quantileSettings?.quantile ?? 0.5),
    });
  }

  return data;
}

function buildDenominatorData(
  factMetric: FactMetricInterface,
  denominatorFactTable: FactTableInterface | null,
): DataItem[] {
  if (
    factMetric.metricType !== "ratio" ||
    !factMetric.denominator ||
    !denominatorFactTable
  ) {
    return [];
  }

  const data: DataItem[] = [
    {
      label: "Fact Table",
      value: <FactTableLink id={factMetric.denominator.factTableId} />,
    },
  ];

  // Row Filter
  if (factMetric.denominator.rowFilters?.length) {
    data.push({
      label: "Row Filter",
      value: (
        <RowFilterDisplay
          rowFilters={factMetric.denominator.rowFilters}
          factTable={denominatorFactTable}
        />
      ),
    });
  }

  // Value
  data.push({
    label: "Value",
    value: getColumnDisplayValue(factMetric.denominator.column),
  });

  // Per-User Aggregation
  if (!factMetric.denominator.column.startsWith("$$")) {
    data.push({
      label: "Per-User Aggregation",
      value: (factMetric.denominator.aggregation || "SUM").toUpperCase(),
    });
  }

  return data;
}

export default function MetricDrilldownMetricCard({
  metric,
  type,
}: MetricDrilldownMetricCardProps) {
  const { getFactTableById } = useDefinitions();

  // Only support FactMetrics for now
  if (!isFactMetric(metric)) {
    return null;
  }

  const factMetric = metric;
  const isRatio = isRatioMetric(factMetric);

  // Get fact tables
  const factTable = getFactTableById(factMetric.numerator.factTableId);
  const denominatorFactTable = getFactTableById(
    factMetric.denominator?.factTableId || "",
  );

  // Build data based on type
  const data =
    type === "numerator"
      ? buildNumeratorData(factMetric, factTable)
      : buildDenominatorData(factMetric, denominatorFactTable);

  // Don't render if no data (e.g., denominator for non-ratio metric)
  if (data.length === 0) {
    return null;
  }

  // Header: "Numerator" for ratio metrics, "Metric Details" for non-ratio
  const header =
    type === "numerator" ? (isRatio ? "Numerator" : null) : "Denominator";

  return (
    <Box
      p="4"
      style={{
        flexBasis: "50%",
        flexGrow: 0,
        flexShrink: 0,
        borderRadius: "var(--radius-2)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      {header ? (
        <Heading size="3" weight="medium" mb="3">
          {header}
        </Heading>
      ) : null}
      <Flex direction="column" gap="1">
        {data.map((item, index) => (
          <Metadata key={index} label={item.label} value={item.value} />
        ))}
      </Flex>
    </Box>
  );
}
