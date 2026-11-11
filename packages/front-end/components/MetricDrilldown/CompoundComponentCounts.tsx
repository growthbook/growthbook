import { Flex } from "@radix-ui/themes";
import {
  ExperimentMetricDefinition,
  isFactCompoundMetric,
} from "shared/experiments";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "shared/types/report";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { useDefinitions } from "@/services/DefinitionsContext";
import { formatNumber, formatPercent } from "@/services/metrics";
import { getRowFilterDescription } from "@/components/FactTables/rowFilterUtils";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

// Units per compound component, descriptive only. The stats pipeline attaches
// them to the overall result (see sumCompoundComponentUnits).
export function hasCompoundComponentUnits(
  metric: ExperimentMetricDefinition,
  results?: ExperimentReportResultDimension,
): boolean {
  return !!results?.variations.some(
    (v) => v.metrics[metric.id]?.componentUnits?.length,
  );
}

function UnitsCell({
  result,
  units,
  weight,
}: {
  result?: SnapshotMetric;
  units: (result: SnapshotMetric) => number | undefined;
  weight?: "semibold";
}) {
  const count = result ? units(result) : undefined;
  return (
    <TableCell justify="end">
      {count === undefined ? (
        "-"
      ) : (
        <Flex direction="column" align="end">
          <Text weight={weight}>{formatNumber(count)}</Text>
          {!!result?.users && (
            <Text size="sm" color="text-mid" weight={weight}>
              {formatPercent(count / result.users)}
            </Text>
          )}
        </Flex>
      )}
    </TableCell>
  );
}

export default function CompoundComponentCounts({
  metric,
  results,
  variations,
}: {
  metric: ExperimentMetricDefinition;
  results?: ExperimentReportResultDimension;
  variations: ExperimentReportVariation[];
}) {
  const { getFactTableById } = useDefinitions();
  if (!isFactCompoundMetric(metric)) return null;

  return (
    // The list header sticks at a viewport offset meant for page tables; in
    // the drilldown modal it slides over the first row.
    <Table variant="list" stickyHeader={false}>
      <TableHeader>
        <TableRow>
          <TableColumnHeader>Component</TableColumnHeader>
          {variations.map((v) => (
            <TableColumnHeader key={v.index} justify="end">
              {/* The label fills its container, so pin it to the right and
                  cap it; a long name truncates with a tooltip. */}
              <Flex justify="end">
                <VariationLabel
                  number={v.index}
                  name={v.name}
                  size="md"
                  maxWidth="160px"
                />
              </Flex>
            </TableColumnHeader>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {metric.compoundSettings.components.map((component, k) => {
          const factTable = getFactTableById(component.factTableId);
          return (
            <TableRow key={k}>
              <TableCell>
                <Flex direction="column" gap="1" align="start">
                  <Text weight="semibold">
                    {factTable?.name ?? component.factTableId}
                  </Text>
                  {component.rowFilters.length > 0 && (
                    <Flex gap="1" wrap="wrap">
                      {component.rowFilters.map((rf, i) => (
                        <Badge
                          key={i}
                          color="violet"
                          radius="small"
                          label={getRowFilterDescription(rf, factTable)}
                        />
                      ))}
                    </Flex>
                  )}
                </Flex>
              </TableCell>
              {variations.map((v) => (
                <UnitsCell
                  key={v.index}
                  result={results?.variations[v.index]?.metrics[metric.id]}
                  units={(result) => result.componentUnits?.[k]}
                />
              ))}
            </TableRow>
          );
        })}
        {/* The metric itself: units that matched every component. */}
        <TableRow data-no-hover>
          <TableCell>
            <Text weight="semibold">All components</Text>
          </TableCell>
          {variations.map((v) => (
            <UnitsCell
              key={v.index}
              result={results?.variations[v.index]?.metrics[metric.id]}
              units={(result) => result.value}
              weight="semibold"
            />
          ))}
        </TableRow>
      </TableBody>
    </Table>
  );
}
