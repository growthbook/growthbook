import React, {  } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import type {
  MetricValue,
} from "shared/validators";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import { useExplorerContext } from "../ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { SERIES_COLORS, getSeriesTag } from "../util";
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
        <Flex justify="between" align="center">
          <Text size="2" weight="medium">
            Values
          </Text>
          <Button size="xs" variant="ghost" onClick={() => addValueToDataset("metric")}>
            <Flex align="center" gap="2">
              <PiPlus size={14} />
              Add value
            </Flex>
          </Button>
        </Flex>
        <Flex direction="column" gap="2">
          
          {!values.length && (
            <Text size="1" color="gray">
              Add at least one value to chart
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
                tag={v.tag ?? getSeriesTag(idx)}
                color={v.color ?? SERIES_COLORS[idx % SERIES_COLORS.length]}
                name={v.name}
                onNameChange={(name) =>
                  updateValueInDataset(idx, { ...v, name } as MetricValue)
                }
                onDelete={() => deleteValueFromDataset(idx)}
                filters={v.rowFilters ?? []}
                onFiltersChange={(filters) =>
                  updateValueInDataset(idx, { ...v, rowFilters: filters } as MetricValue)
                }
                columns={columns}
              >
                <Flex direction="column">
                  <SelectField
                    label="Metric"
                    value={v.metricId}
                    onChange={(val) =>
                      updateValueInDataset(idx, {
                        ...v,
                        metricId: val,
                      } as MetricValue)
                    }
                    options={factMetrics.map((m) => ({
                      label: m.name,
                      value: m.id,
                    }))}
                    placeholder="Select metric..."
                    forceUndefinedValueToNull
                  />
                  <SelectField
                    label="Unit"
                    value={v.unit ?? ""}
                    onChange={(val) =>
                      updateValueInDataset(idx, {
                        ...v,
                        unit: val || null,
                      } as MetricValue)
                    }
                    options={[{ label: "TBD", value: "TBD" }]}
                    placeholder="Select..."
                  />
                </Flex>
              </ValueCard>
            );
          })}
        </Flex>
      </Flex>
    );
  }