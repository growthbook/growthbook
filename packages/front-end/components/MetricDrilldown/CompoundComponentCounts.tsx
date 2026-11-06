import { Flex } from "@radix-ui/themes";
import {
  ExperimentMetricDefinition,
  isFactCompoundMetric,
} from "shared/experiments";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "shared/types/report";
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
    <Table variant="list">
      <TableHeader>
        <TableRow>
          <TableColumnHeader>Component</TableColumnHeader>
          {variations.map((v) => (
            <TableColumnHeader key={v.index} justify="end">
              <VariationLabel number={v.index} name={v.name} size="md" />
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
              {variations.map((v) => {
                const result = results?.variations[v.index]?.metrics[metric.id];
                const units = result?.componentUnits?.[k];
                return (
                  <TableCell key={v.index} justify="end">
                    {units === undefined ? (
                      "-"
                    ) : (
                      <Flex direction="column" align="end">
                        <Text>{formatNumber(units)}</Text>
                        {!!result?.users && (
                          <Text size="sm" color="text-mid">
                            {formatPercent(units / result.users)}
                          </Text>
                        )}
                      </Flex>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
