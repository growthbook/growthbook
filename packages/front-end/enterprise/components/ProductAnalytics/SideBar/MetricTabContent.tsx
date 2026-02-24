import React, { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import type { MetricValue } from "shared/validators";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import MetricName from "@/components/Metrics/MetricName";
import Button from "@/ui/Button";
import { useDefinitions } from "@/services/DefinitionsContext";
import { generateUniqueValueName } from "@/enterprise/components/ProductAnalytics/util";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import ValueCard from "./ValueCard";
import styles from "./ValueCard.module.scss";

export default function MetricTabContent() {
  const { draftExploreState, addValueToDataset, updateValueInDataset } =
    useExplorerContext();
  const { factMetrics, getFactTableById } = useDefinitions();

  const values: MetricValue[] =
    draftExploreState.dataset?.type === "metric"
      ? draftExploreState.dataset.values
      : [];

  const metricOptions = useMemo(() => {
    const groupedOptions: GroupedValue[] = [];
    const managedMetrics: SingleValue[] = [];
    const unManagedMetrics: SingleValue[] = [];
    factMetrics.forEach((m) => {
      if (m.datasource !== draftExploreState.datasource) return;
      if (m.managedBy) {
        managedMetrics.push({ label: m.name, value: m.id });
      } else {
        unManagedMetrics.push({ label: m.name, value: m.id });
      }
    });
    if (managedMetrics.length > 0) {
      groupedOptions.push({
        label: "Official Metrics",
        options: managedMetrics,
      });
    }
    if (unManagedMetrics.length > 0) {
      groupedOptions.push({ label: "", options: unManagedMetrics });
    }
    return groupedOptions.length > 1
      ? groupedOptions
      : groupedOptions.length === 1
        ? groupedOptions[0].options
        : [];
  }, [factMetrics, draftExploreState.datasource]);

  return (
    <Flex direction="column" gap="4">
      {!values.length && (
        <Text size="small" color="text-low">
          Add at least one metric to chart
        </Text>
      )}

      {values.map((v, idx) => {
        return (
          <ValueCard key={idx} index={idx}>
            <Flex direction="column">
              <SelectField
                className={styles.metricSelect}
                value={v.metricId}
                onChange={(val) => {
                  const newMetric = factMetrics.find((m) => m.id === val);
                  const newFactTable = newMetric
                    ? getFactTableById(newMetric.numerator.factTableId)
                    : null;

                  let unit = v.unit;
                  if (!unit || !newFactTable?.userIdTypes.includes(unit)) {
                    unit = newFactTable?.userIdTypes[0] ?? null;
                  }

                  const updates = {
                    ...v,
                    metricId: val,
                    unit: newMetric?.metricType === "mean" ? null : unit,
                    name: newMetric?.name
                      ? generateUniqueValueName(
                          newMetric.name,
                          draftExploreState.dataset.values,
                        )
                      : v.name,
                  } as MetricValue;

                  updateValueInDataset(idx, updates as MetricValue);
                }}
                options={metricOptions}
                formatOptionLabel={({ value }) => {
                  const metric = factMetrics.find((m) => m.id === value);
                  return metric ? <MetricName metric={metric} /> : value;
                }}
                formatGroupLabel={({ label }) => {
                  return label;
                }}
                sort={false}
                placeholder="Select metric..."
                forceUndefinedValueToNull
              />
            </Flex>
          </ValueCard>
        );
      })}
      <Button
        size="sm"
        variant="outline"
        onClick={() => addValueToDataset("metric")}
      >
        <Flex align="center" gap="2">
          <PiPlus size={14} />
          Add metric
        </Flex>
      </Button>
    </Flex>
  );
}
