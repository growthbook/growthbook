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

  // TODO: Merge with RowFilterCodeDisplay -- the difference is that this uses InlineCode
  return <InlineCode language="sql" code={text} />;
}

// TODO: Merge with getColumnDisplayValue in MetricTooltipBody.tsx
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

  if (!isBinomialMetric(factMetric)) {
    data.push({
      label: "Value",
      value: getColumnDisplayValue(factMetric.numerator.column),
    });
  }

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

  data.push({
    label: "Value",
    value: getColumnDisplayValue(factMetric.denominator.column),
  });

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
  if (!isFactMetric(metric)) {
    return null;
  }

  const factMetric = metric;
  const isRatio = isRatioMetric(factMetric);

  const factTable = getFactTableById(factMetric.numerator.factTableId);
  const denominatorFactTable = getFactTableById(
    factMetric.denominator?.factTableId || "",
  );

  const data =
    type === "numerator"
      ? buildNumeratorData(factMetric, factTable)
      : buildDenominatorData(factMetric, denominatorFactTable);

  if (data.length === 0) {
    return null;
  }

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
        backgroundColor: "var(--gray-a2)",
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
