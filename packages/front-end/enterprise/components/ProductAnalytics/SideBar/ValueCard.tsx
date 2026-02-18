import React, { useState } from "react";
import { Flex, Box, TextField } from "@radix-ui/themes";
import {
  PiX,
  PiPencilSimple,
  PiPlus,
  PiCaretDown,
  PiCaretUp,
} from "react-icons/pi";
import Collapsible from "react-collapsible";
import { z } from "zod";
import { rowFilterValidator } from "shared/validators";
import { FactTableInterface } from "shared/types/fact-table";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import { DataSourceRowFilterInput } from "./DataSourceRowFilterInput";
import styles from "./ValueCard.module.scss";

type RowFilter = z.infer<typeof rowFilterValidator>;

export default function ValueCard({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  const { draftExploreState, updateValueInDataset, deleteValueFromDataset } =
    useExplorerContext();
  const { getFactTableById, getFactMetricById } = useDefinitions();

  const name = draftExploreState.dataset.values[index].name;
  const filters = draftExploreState.dataset.values[index].rowFilters;

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name ?? "");
  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  let factTable: FactTableInterface | null = null;
  if (draftExploreState.dataset?.type === "fact_table") {
    factTable = getFactTableById(draftExploreState.dataset.factTableId ?? "");
  } else if (draftExploreState.dataset?.type === "metric") {
    const factTableId = getFactMetricById(
      draftExploreState.dataset.values[index].metricId ?? "",
    )?.numerator?.factTableId;
    if (factTableId) {
      factTable = getFactTableById(factTableId);
    }
  }

  let dataSourceId = "";
  if (draftExploreState.dataset?.type === "data_source") {
    dataSourceId = draftExploreState.dataset.datasource;
  }

  const displayName = (name ?? "").trim();

  const handleStartEdit = () => {
    setEditValue(name ?? "");
    setIsEditing(true);
  };

  const handleCommitEdit = () => {
    updateValueInDataset(index, {
      ...draftExploreState.dataset.values[index],
      name: editValue.trim(),
    });
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleCommitEdit();
    }
    if (e.key === "Escape") {
      setEditValue(name ?? "");
      setIsEditing(false);
    }
  };

  const handleFiltersChange = (filters: RowFilter[]) => {
    updateValueInDataset(index, {
      ...draftExploreState.dataset.values[index],
      rowFilters: filters,
    });
  };

  let supportsUnitSelection = false;

  if (
    draftExploreState.dataset.type === "fact_table" ||
    draftExploreState.dataset.type === "data_source"
  ) {
    supportsUnitSelection =
      draftExploreState.dataset.values[index].valueType === "unit_count";
  }

  let canAddFilter = false;
  if (
    draftExploreState.dataset.type === "fact_table" ||
    draftExploreState.dataset.type === "metric"
  ) {
    canAddFilter = !!factTable;
  } else if (draftExploreState.dataset.type === "data_source" && dataSourceId) {
    canAddFilter =
      !!dataSourceId &&
      Object.keys(draftExploreState.dataset.columnTypes || {}).length > 0;
  }

  return (
    <Box
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-3)",
        padding: "var(--space-3)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Flex justify="between" align="center">
        <Flex
          align="center"
          gap="2"
          className={styles.titleGroup}
          style={{ minWidth: 0, flex: 1 }}
        >
          {isEditing ? (
            <TextField.Root
              size="1"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleCommitEdit}
              onKeyDown={handleKeyDown}
              placeholder={`Value ${index + 1}`}
              autoFocus
              style={{ flex: 1, minWidth: 0 }}
            />
          ) : (
            <>
              <Box style={{ flex: 1 }}>
                <Text weight="medium" truncate>
                  {displayName}
                </Text>
              </Box>
              <Button
                className={styles.editBtn}
                variant="ghost"
                size="xs"
                onClick={handleStartEdit}
                title="Edit name"
              >
                <PiPencilSimple size={14} />
              </Button>
            </>
          )}
        </Flex>
        <Flex align="center" style={{ flexShrink: 0 }}>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setIsCollapsed((prev) => !prev)}
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <PiCaretDown size={14} /> : <PiCaretUp size={14} />}
          </Button>
          {
            <Button
              variant="ghost"
              disabled={draftExploreState.dataset.values.length === 1}
              size="xs"
              onClick={() => deleteValueFromDataset(index)}
            >
              <PiX size={14} />
            </Button>
          }
        </Flex>
      </Flex>
      <Collapsible
        open={!isCollapsed}
        trigger=""
        triggerDisabled
        transitionTime={100}
      >
        <Box mt="2">
          {children}
          {factTable && (
            <Box mt="2">
              <RowFilterInput
                factTable={factTable}
                value={filters}
                setValue={handleFiltersChange}
                variant="compact"
                hideAddButton
              />
            </Box>
          )}
          {draftExploreState.dataset.type === "data_source" &&
            Object.keys(draftExploreState.dataset.columnTypes || {}).length >
              0 && (
              <Box mt="2">
                <DataSourceRowFilterInput
                  columnTypes={draftExploreState.dataset.columnTypes ?? {}}
                  value={filters}
                  setValue={handleFiltersChange}
                  variant="compact"
                  hideAddButton
                />
              </Box>
            )}
        </Box>
        <Flex justify="between" align="center" mt="2">
          <Button
            size="xs"
            variant="ghost"
            style={{ maxWidth: "fit-content" }}
            onClick={() => {
              handleFiltersChange([
                ...filters,
                { column: "", operator: "=", values: [] },
              ]);
            }}
            disabled={!canAddFilter}
          >
            <Flex align="center" gap="2">
              <PiPlus size={14} />
              Add Filter
            </Flex>
          </Button>

          {factTable && supportsUnitSelection && (
            <DropdownMenu
              open={unitDropdownOpen}
              onOpenChange={setUnitDropdownOpen}
              trigger={
                <Button size="xs" variant="ghost">
                  <Flex align="center" gap="2">
                    {draftExploreState.dataset.values[index].unit ?? ""}
                  </Flex>
                </Button>
              }
            >
              {factTable?.userIdTypes.map((t) => (
                <DropdownMenuItem
                  key={t}
                  onClick={() => {
                    updateValueInDataset(index, {
                      ...draftExploreState.dataset.values[index],
                      unit: t || null,
                    });
                    setUnitDropdownOpen(false);
                  }}
                >
                  <Text>{t}</Text>
                </DropdownMenuItem>
              ))}
            </DropdownMenu>
          )}
        </Flex>
      </Collapsible>
    </Box>
  );
}
