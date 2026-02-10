import React, { useMemo, useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import type { MetricValue } from "shared/validators";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import { generateUniqueValueName } from "../util";
import { useExplorerContext } from "../ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ValueCard from "./ValueCard";

export default function MetricTabContent() {
  const {
    draftExploreState,
    addValueToDataset,
    updateValueInDataset,
    deleteValueFromDataset,
  } = useExplorerContext();
  const { factMetrics, getFactTableById } = useDefinitions();

  const values: MetricValue[] =
    draftExploreState.dataset?.type === "metric"
      ? draftExploreState.dataset.values
      : [];

  return (
    <Flex direction="column" gap="3">
      <Flex direction="column" gap="2">
        {!values.length && (
          <Text size="1" color="gray">
            Add at least one metric to chart
          </Text>
        )}

        {values.map((v, idx) => {
          const metric = factMetrics.find((m) => m.id === v.metricId);
          const factTable = metric
            ? getFactTableById(metric.numerator.factTableId)
            : null;
          const columns =
            factTable?.columns.map((c) => ({
              label: c.column,
              value: c.column,
            })) ?? [];

          return (
            <ValueCard
              key={idx}
              index={idx}
            >
              <Flex direction="column">
                <SelectField
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
                      unit,
                      name: newMetric?.name
                        ? generateUniqueValueName(
                          newMetric.name,
                          draftExploreState.dataset.values,
                        )
                        : v.name,
                    } as MetricValue;

                    updateValueInDataset(idx, updates as MetricValue);
                  }}
                  options={factMetrics.map((m) => ({
                    label: m.name,
                    value: m.id,
                  }))}
                  placeholder="Select metric..."
                  forceUndefinedValueToNull
                />
              </Flex>
            </ValueCard>
          );
        })}
        <Button size="sm" variant="outline" onClick={() => addValueToDataset("metric")}>
          <Flex align="center" gap="2">
            <PiPlus size={14} />
            Add metric
          </Flex>
        </Button>
      </Flex>
    </Flex>
  );
}
