import React, { useState } from "react";
import { Flex, Box, Text, TextField, Separator } from "@radix-ui/themes";
import { PiPlus, PiX, PiPencilSimple } from "react-icons/pi";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import { z } from "zod";
import { rowFilterOperators, rowFilterValidator } from "shared/validators";
import MultiSelectField from "@/components/Forms/MultiSelectField";

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

  const handleAddFilter = () => {
    onFiltersChange([
      ...filters,
      {
        column: "",
        operator: "=",
        values: [],
      },
    ]);
  };

  const handleUpdateFilter = (
    filterIndex: number,
    updatedFilter: RowFilter,
  ) => {
    const newFilters = [...filters];
    newFilters[filterIndex] = updatedFilter;
    onFiltersChange(newFilters);
  };

  const handleDeleteFilter = (filterIndex: number) => {
    const newFilters = [...filters];
    newFilters.splice(filterIndex, 1);
    onFiltersChange(newFilters);
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
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            style={{ padding: "2px 6px" }}
          >
            <PiX size={14} />
          </Button>
        </Flex>
      </Flex>
      <Separator style={{ width: "100%" }} mb="2" />
      {children}
      <Flex align="start" gap="2" direction="column" mt="2">
        <Text size="2" weight="medium">
          Filters
        </Text>
        <Flex direction="column" gap="2" width="100%">
          <Separator
            style={{
              width: "100%",
              display: filters.length ? "block" : "none",
            }}
          />
          {filters.map((filter, i) => (
            <Flex key={i} direction="column" gap="2">
              <Flex justify="between" align="center" width="100%">
                <Text size="1">Filter {i + 1}</Text>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => handleDeleteFilter(i)}
                >
                  <PiX size={14} />
                </Button>
              </Flex>
              <SelectField
                value={filter.column ?? ""}
                onChange={(val) =>
                  handleUpdateFilter(i, { ...filter, column: val })
                }
                options={columns}
                placeholder="Select column..."
              />
              <SelectField
                value={filter.operator}
                onChange={(val) =>
                  handleUpdateFilter(i, {
                    ...filter,
                    operator: val as RowFilter["operator"],
                  })
                }
                options={rowFilterOperators.map((o) => ({
                  label: o,
                  value: o,
                }))}
                placeholder="Select operator..."
              />
              <MultiSelectField
                value={filter.values ?? []}
                creatable={true}
                onChange={(vals) =>
                  handleUpdateFilter(i, { ...filter, values: vals })
                }
                options={(filter.values ?? []).map((v) => ({
                  label: v,
                  value: v,
                }))}
                placeholder="Select value..."
              />
              <Separator style={{ width: "100%" }} />
            </Flex>
          ))}
        </Flex>
        <Button size="xs" variant="ghost" onClick={handleAddFilter}>
          <Flex align="center" gap="2">
            <PiPlus size={14} />
            Add Filter
          </Flex>
        </Button>
      </Flex>
    </Box>
  );
}
