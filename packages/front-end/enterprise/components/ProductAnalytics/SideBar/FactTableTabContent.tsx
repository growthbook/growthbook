import React, {  } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { PiTable, PiPlus } from "react-icons/pi";
import type {
    FactTableValue,
} from "shared/validators";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import { useExplorerContext } from "../ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { SERIES_COLORS, getSeriesTag } from "../util";
import ValueCard from "./ValueCard";

const VALUE_TYPE_OPTIONS: {
    value: "unit_count" | "count" | "sum";
    label: string;
}[] = [
        { value: "count", label: "Count" },
        { value: "unit_count", label: "Unit count" },
        { value: "sum", label: "Sum" },
    ];

export default function FactTableTabContent() {
    const {
        draftExploreState,
        setDraftExploreState,
        addValueToDataset,
        updateValueInDataset,
        deleteValueFromDataset,
    } = useExplorerContext();
    const { factTables, getFactTableById } = useDefinitions();

    const dataset =
        draftExploreState.dataset?.type === "fact_table"
            ? draftExploreState.dataset
            : null;
    const factTable = dataset
        ? getFactTableById(dataset.factTableId ?? "")
        : null;

    const numericColumns =
        factTable?.columns?.filter((c) => c.datatype === "number") ?? [];
    const allColumns =
        factTable?.columns?.map((c) => ({ label: c.column, value: c.column })) ??
        [];
    const values: FactTableValue[] =
        draftExploreState.dataset?.type === "fact_table"
            ? draftExploreState.dataset.values
            : [];

    if (!dataset) return null;

    if (!dataset.factTableId) return (
        <Flex justify="center" align="center" height="100%" direction="column" gap="2" px="4">
            <PiTable size={18} />
            <Text size="2" weight="medium" align="center">
                Select a fact table to begin configuring values and filters
            </Text>
        </Flex>
    )

    return (
        <Flex direction="column" gap="3">
            <Flex justify="between" align="center">
                <Text size="2" weight="medium">
                    Values
                </Text>
                <Button size="xs" variant="ghost" onClick={() => addValueToDataset("fact_table")}>
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
            </Flex>
            <Flex direction="column" gap="2">
                {dataset.values.map((v, idx) => (
                    <ValueCard
                        key={idx}
                        index={idx}
                        tag={v.tag ?? getSeriesTag(idx)}
                        color={v.color ?? SERIES_COLORS[idx % SERIES_COLORS.length]}
                        name={v.name}
                        onNameChange={(name) =>
                            updateValueInDataset(idx, {
                                ...v,
                                name,
                            } as FactTableValue)
                        }
                        onDelete={() => deleteValueFromDataset(idx)}
                        filters={v.rowFilters ?? []}
                        onFiltersChange={(filters) =>
                            updateValueInDataset(idx, {
                                ...v,
                                rowFilters: filters,
                            } as FactTableValue)
                        }
                        columns={allColumns}
                    >
                        <Flex direction="column" gap="2">
                            <SelectField
                                label="Value type"
                                value={v.valueType}
                                onChange={(val) =>
                                    updateValueInDataset(idx, {
                                        ...v,
                                        valueType: val as "count" | "unit_count" | "sum",
                                    } as FactTableValue)
                                }
                                options={VALUE_TYPE_OPTIONS.map((o) => ({
                                    label: o.label,
                                    value: o.value,
                                }))}
                                placeholder="Select..."
                            />
                            {v.valueType === "sum" && (
                                <SelectField
                                    label="Value column"
                                    value={v.valueColumn ?? ""}
                                    onChange={(val) =>
                                        updateValueInDataset(idx, {
                                            ...v,
                                            valueColumn: val || null,
                                        } as FactTableValue)
                                    }
                                    options={numericColumns.map((c) => ({
                                        label: c.column,
                                        value: c.column,
                                    }))}
                                    placeholder="Select column..."
                                    forceUndefinedValueToNull
                                />
                            )}
                        </Flex>
                    </ValueCard>
                ))}
            </Flex>
        </Flex>
    );
}