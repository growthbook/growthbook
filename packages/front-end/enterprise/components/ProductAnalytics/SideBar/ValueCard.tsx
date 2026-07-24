import React, { useMemo, useState } from "react";
import { Flex, Box, TextField } from "@radix-ui/themes";
import {
  PiX,
  PiPencilSimple,
  PiPlus,
  PiCaretDown,
  PiCaretUp,
  PiUserFill,
} from "react-icons/pi";
import Collapsible from "react-collapsible";
import { z } from "zod";
import { rowFilterValidator } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import useFullFactTable from "@/hooks/useFullFactTable";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import {
  factTableToColumnSource,
  columnTypesToColumnSource,
} from "./ExplorerFilterRow";
import styles from "./ValueCard.module.scss";
import { ExplorerRowFilterInput } from "./ExplorerRowFilterInput";

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
  const { getFactMetricById } = useDefinitions();

  // ValueCard is only mounted from metric/fact_table/data_source tabs —
  // funnels manage their own step UI. The hooks below must run unconditionally,
  // so we narrow defensively but defer the early return until after them.
  const isFunnel = draftExploreState.dataset.type === "funnel";
  const dataset = isFunnel
    ? null
    : (draftExploreState.dataset as Exclude<
        typeof draftExploreState.dataset,
        { type: "funnel" }
      >);
  const value = dataset?.values[index];
  const name = value?.name ?? "";
  const filters = value?.rowFilters ?? [];

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Column filters need full columns (jsonFields), which the slimmed
  // definitions omit, so fetch the full fact table by id
  const factTableId =
    draftExploreState.dataset?.type === "fact_table"
      ? (draftExploreState.dataset.factTableId ?? "")
      : draftExploreState.dataset?.type === "metric"
        ? (getFactMetricById(
            draftExploreState.dataset.values[index].metricId ?? "",
          )?.numerator?.factTableId ?? "")
        : "";
  const { factTable } = useFullFactTable(factTableId);

  const columnSource = useMemo(() => {
    if (factTable) {
      return factTableToColumnSource(factTable);
    }
    if (
      dataset?.type === "data_source" &&
      dataset.columnTypes &&
      Object.keys(dataset.columnTypes).length > 0
    ) {
      return columnTypesToColumnSource(dataset.columnTypes);
    }
    return null;
  }, [factTable, dataset]);

  // Funnels manage their own step UI; ValueCard isn't mounted from
  // FunnelTabContent. Returning null here keeps the hook order stable in
  // case a parent ever renders it for a funnel dataset.
  if (!dataset || !value) return null;

  const displayName = name.trim();

  const handleStartEdit = () => {
    setEditValue(name);
    setIsEditing(true);
  };

  const handleCommitEdit = () => {
    updateValueInDataset(index, {
      ...value,
      name: editValue.trim(),
    });
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleCommitEdit();
    }
    if (e.key === "Escape") {
      setEditValue(name);
      setIsEditing(false);
    }
  };

  const handleFiltersChange = (filters: RowFilter[]) => {
    updateValueInDataset(index, {
      ...value,
      rowFilters: filters,
    });
  };

  let supportsUnitSelection = false;

  if (dataset.type === "fact_table" || dataset.type === "data_source") {
    supportsUnitSelection = dataset.values[index].valueType === "unit_count";
  } else if (dataset.type === "metric") {
    const factMetric = getFactMetricById(dataset.values[index].metricId ?? "");
    if (
      factMetric?.metricType === "mean" ||
      factMetric?.metricType === "proportion" ||
      factMetric?.metricType === "retention" ||
      factMetric?.metricType === "dailyParticipation"
    ) {
      supportsUnitSelection = true;
    } else if (factMetric?.metricType === "ratio") {
      if (factMetric.numerator.column === "$$distinctUsers") {
        supportsUnitSelection = true;
      }
      // TODO: handle separate denominator unit selector
    }
  }

  const canAddFilter = !!columnSource;

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
              <Box style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                <Text
                  weight="medium"
                  truncate
                  as="div"
                  whiteSpace="nowrap"
                  title={displayName}
                >
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
              disabled={dataset.values.length === 1}
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
          {columnSource && (
            <Box mt="2">
              <ExplorerRowFilterInput
                columnSource={columnSource}
                value={filters}
                setValue={handleFiltersChange}
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
                    <PiUserFill />{" "}
                    {dataset.values[index].unit ?? "Select Unit..."}
                  </Flex>
                </Button>
              }
            >
              {factTable?.userIdTypes.map((t) => (
                <DropdownMenuItem
                  key={t}
                  onClick={() => {
                    updateValueInDataset(index, {
                      ...dataset.values[index],
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
