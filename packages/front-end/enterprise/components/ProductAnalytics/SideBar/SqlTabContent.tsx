import React, { useMemo, useState } from "react";
import { Flex, Box, Separator, Text, TextField } from "@radix-ui/themes";
import { PiTable, PiPlus, PiPencilSimple } from "react-icons/pi";
import type { SqlValue } from "shared/validators";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import { generateUniqueValueName, getValueTypeLabel } from "../util";
import { useExplorerContext } from "../ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import Code from "@/components/SyntaxHighlighting/Code";
import ProductAnalyticsSqlModal from "front-end/enterprise/components/ProductAnalytics/ProductAnalyticsSqlModal";
import ValueCard from "./ValueCard";

type DatasetType = "metric" | "fact_table" | "sql";

const VALUE_TYPE_OPTIONS: {
  value: "unit_count" | "count" | "sum";
  label: string;
}[] = [
  { value: "count", label: "Count" },
  { value: "unit_count", label: "Unit count" },
  { value: "sum", label: "Sum" },
];

export default function SqlTabContent() {
  const [sqlOpen, setSqlOpen] = useState(false);
  const { datasources } = useDefinitions();
  const {
    draftExploreState,
    addValueToDataset,
    updateValueInDataset,
    deleteValueFromDataset,
    updateSqlDataset,
    updateTimestampColumn,
  } = useExplorerContext();

  const dataset =
    draftExploreState.dataset?.type === "sql"
      ? draftExploreState.dataset
      : null;
  const datasource = dataset?.datasource || null;
  const values: SqlValue[] = dataset?.values || [];

  const datasourceUserIdTypes = useMemo(() => {
    const datasourceObject = datasource
      ? datasources.find((d) => d.id === datasource)
      : null;
    return datasourceObject?.settings?.userIdTypes ?? [];
  }, [datasource, datasources]);

  if (!dataset) return null;

  if (!datasource)
    return (
      <Flex
        justify="center"
        align="center"
        height="100%"
        direction="column"
        gap="2"
        px="4"
      >
        <PiTable size={18} />
        <Text size="2" weight="medium" align="center">
          You must select a Data Source to begin configuring your SQL query
        </Text>
      </Flex>
    );

  return (
    <>
      {sqlOpen && (
        <ProductAnalyticsSqlModal
          close={() => {
            setSqlOpen(false);
          }}
          datasourceId={datasource}
          initialSql={dataset.sql || undefined}
          onSave={(data) => {
            updateSqlDataset(data.sql, data.columnTypes);
          }}
        />
      )}
      <Flex direction="column" gap="3">
        {/* SQL section */}
        <Box
          style={{
            padding: "var(--space-3)",
            borderRadius: "var(--radius-2)",
            backgroundColor: "var(--gray-a2)",
          }}
        >
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              SQL Query
            </Text>
            {dataset.sql && (
              <Code language="sql" code={dataset.sql} expandable={true} />
            )}
            <Button size="sm" onClick={() => setSqlOpen(true)}>
              <Flex align="center" gap="2">
                <PiPencilSimple size={14} />
                {dataset.sql ? "Edit" : "Add"} SQL Query
              </Flex>
            </Button>
            {dataset.timestampColumn && (
              <>
                <Separator size="4" my="2" />
                <Flex direction="column" gap="2">
                  <Text size="2" weight="medium">
                    Timestamp Column (Optional)
                  </Text>
                  <Text size="2" color="gray">
                    Select the column that contains the timestamp data for the
                    query.
                  </Text>
                  <SelectField
                    value={dataset.timestampColumn ?? ""}
                    onChange={(val) => updateTimestampColumn(val)}
                    options={
                      dataset.columnTypes
                        ? Object.entries(dataset.columnTypes).map(([name]) => ({
                            label: name,
                            value: name,
                          }))
                        : []
                    }
                  />
                </Flex>
              </>
            )}
          </Flex>
        </Box>
        {dataset.sql && (
          <Box>
            <Flex justify="between" align="center">
              <Text size="2" weight="medium">
                Values
              </Text>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => addValueToDataset("sql")}
              >
                <Flex align="center" gap="2">
                  <PiPlus size={14} />
                  Add value
                </Flex>
              </Button>
            </Flex>
            <Flex direction="column" gap="2">
              {values.map((v, idx) => (
                <ValueCard
                  key={idx}
                  index={idx}
                  name={v.name}
                  onNameChange={(name) =>
                    updateValueInDataset(idx, { ...v, name } as SqlValue)
                  }
                  onDelete={() => deleteValueFromDataset(idx)}
                  filters={v.rowFilters ?? []}
                  onFiltersChange={(filters) =>
                    updateValueInDataset(idx, {
                      ...v,
                      rowFilters: filters,
                    } as SqlValue)
                  }
                  columns={[]}
                >
                  <Flex direction="column" gap="2">
                    <SelectField
                      label="Value type"
                      value={v.valueType}
                      onChange={(val) =>
                        updateValueInDataset(idx, {
                          ...v,
                          valueType: val as "count" | "unit_count" | "sum",
                          name: generateUniqueValueName(
                            getValueTypeLabel(
                              val as "count" | "unit_count" | "sum",
                            ),
                            draftExploreState.dataset.values,
                          ),
                        } as SqlValue)
                      }
                      options={VALUE_TYPE_OPTIONS.map((o) => ({
                        label: o.label,
                        value: o.value,
                      }))}
                      placeholder="Select..."
                    />
                    <SelectField
                      label="Value column"
                      value={v.valueColumn ?? ""}
                      onChange={(val) =>
                        updateValueInDataset(idx, {
                          ...v,
                          valueColumn: val,
                        } as SqlValue)
                      }
                      options={Object.entries(dataset.columnTypes ?? {}).map(
                        ([name]) => ({
                          label: name,
                          value: name,
                        }),
                      )}
                      placeholder="Select..."
                    />
                    <SelectField
                      label="Unit"
                      value={v.unit ?? ""}
                      onChange={(val) =>
                        updateValueInDataset(idx, {
                          ...v,
                          unit: val,
                        } as SqlValue)
                      }
                      options={datasourceUserIdTypes.map((ut) => ({
                        label: ut.userIdType,
                        value: ut.userIdType,
                      }))}
                      placeholder="Select..."
                    />
                  </Flex>
                </ValueCard>
              ))}
            </Flex>
          </Box>
        )}
      </Flex>
    </>
  );
}
