import React, { useState } from "react";
import { Flex, Box, Text, TextField, Separator } from "@radix-ui/themes";
import { PiX, PiPencilSimple } from "react-icons/pi";
import Button from "@/ui/Button";
import { z } from "zod";
import { rowFilterValidator } from "shared/validators";
import { useExplorerContext } from "../ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { FactTableInterface } from "shared/types/fact-table";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";

type RowFilter = z.infer<typeof rowFilterValidator>;

export default function ValueCard({
  index,
  name,
  onNameChange,
  onDelete,
  children,
  filters,
  onFiltersChange,
  columns = [],
}: {
  index: number;
  name?: string;
  onNameChange?: (name: string) => void;
  onDelete: () => void;
  children: React.ReactNode;
  filters: RowFilter[];
  onFiltersChange: (filters: RowFilter[]) => void;
  columns?: { label: string; value: string }[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name ?? "");

  const { draftExploreState } = useExplorerContext();
  const { getFactTableById, getFactMetricById } = useDefinitions();

  let factTable: FactTableInterface | null = null;
  if (draftExploreState.dataset?.type === "fact_table") {
    factTable = getFactTableById(draftExploreState.dataset.factTableId ?? "");
  } else if (draftExploreState.dataset?.type === "metric") {
    const factTableId = getFactMetricById(draftExploreState.dataset.values[index].metricId ?? "")?.numerator?.factTableId;
    if (factTableId) {
      factTable = getFactTableById(factTableId);
    }
  }

  const displayName = (name ?? "").trim();

  const handleStartEdit = () => {
    setEditValue(name ?? "");
    setIsEditing(true);
  };

  const handleCommitEdit = () => {
    onNameChange?.(editValue.trim());
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

  return (
    <Box
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-3)",
        padding: "var(--space-3)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Flex justify="between" align="center" mb="2">
        <Flex align="center" gap="2" style={{ minWidth: 0, flex: 1 }}>
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
            <Text size="2" weight="medium" truncate style={{ flex: 1 }}>
              {displayName}
            </Text>
          )}
        </Flex>
        <Flex align="center" gap="1" style={{ flexShrink: 0 }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleStartEdit}
            style={{ padding: "2px 6px" }}
            title="Edit name"
          >
            <PiPencilSimple size={14} />
          </Button>
          {<Button
            variant="ghost"
            disabled={draftExploreState.dataset.values.length === 1}
            size="sm"
            onClick={onDelete}
            style={{ padding: "2px 6px" }}
          >
            <PiX size={14} />
          </Button>}
        </Flex>
      </Flex>
      <Separator style={{ width: "100%" }} mb="2" />
      {children}
      {factTable && (
        <RowFilterInput factTable={factTable} value={filters} setValue={onFiltersChange} variant="compact"/>
      )}
    </Box>
  );
}