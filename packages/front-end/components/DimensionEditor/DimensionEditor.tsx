import { DimensionMapping } from "back-end/types/dimension";
import { useState, useCallback } from "react";
import { Box, Flex, Text, Button, Card, Badge, ScrollArea } from "@radix-ui/themes";
import { PiPlus, PiTrash, PiArrowRight, PiX } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";

interface DimensionValue {
  value: string;
  count?: number;
}

interface DimensionEditorProps {
  availableValues: DimensionValue[];
  initialMapping: DimensionMapping;
  dimensionName: string;
  open: boolean;
  close: () => void;
  onSave: (mapping: DimensionMapping) => void;
}

function getDimensionMappingSQL({
  dimensionMapping,
}: {
  dimensionMapping: DimensionMapping;
}): string | null {
  if (!dimensionMapping.values || dimensionMapping.values.length === 0) {
    return null;
  }

  const caseClauses: string[] = [];
  
  dimensionMapping.values.forEach(mapping => {
    if (mapping.compositeValues && mapping.compositeValues.length > 0) {
      const valuesList = mapping.compositeValues
        .map(value => `'${value.replace(/'/g, "''")}'`)
        .join(", ");
      
      caseClauses.push(
        `  WHEN ${dimensionMapping.dimension} IN (${valuesList}) THEN '${mapping.value.replace(/'/g, "''")}'`
      );
    } else {
      caseClauses.push(
        `  WHEN ${dimensionMapping.dimension} = '${mapping.value.replace(/'/g, "''")}' THEN '${mapping.value.replace(/'/g, "''")}'`
      );
    }
  });

  return `CASE\n${caseClauses.join("\n")}\n  ELSE ${dimensionMapping.dimension}\nEND`;
}

export default function DimensionEditor({
  availableValues,
  initialMapping,
  dimensionName,
  close,
  onSave,
}: DimensionEditorProps) {
  const [dimensionMapping, setDimensionMapping] = useState<DimensionMapping>(initialMapping);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set());
  const [newCustomValue, setNewCustomValue] = useState("");
  const [customValues, setCustomValues] = useState<string[]>([]);

  const mappedValues = new Set<string>();
  dimensionMapping.values?.forEach(mapping => {
    if (mapping.compositeValues?.length) {
      mapping.compositeValues.forEach(val => mappedValues.add(val));
    } else {
      mappedValues.add(mapping.value);
    }
  });

  // Include custom values in available values
  const allAvailableValues = [
    ...availableValues,
    ...customValues.map(value => ({ value, count: undefined as number | undefined }))
  ];
  const unmappedValues = allAvailableValues.filter(val => !mappedValues.has(val.value));

  // Create a map of value to its group name for mapped values
  const valueToGroupMap = new Map<string, string>();
  dimensionMapping.values?.forEach(mapping => {
    if (mapping.compositeValues?.length) {
      mapping.compositeValues.forEach(val => valueToGroupMap.set(val, mapping.value));
    }
  });

  const handleAddCustomValue = useCallback(() => {
    if (!newCustomValue.trim() || customValues.includes(newCustomValue.trim())) return;
    setCustomValues([...customValues, newCustomValue.trim()]);
    setNewCustomValue("");
  }, [newCustomValue, customValues]);

  const handleCreateGroup = useCallback(() => {
    if (!newGroupName.trim() || selectedValues.size === 0) return;

    const updatedMapping: DimensionMapping = {
      ...dimensionMapping,
      values: [...(dimensionMapping.values || []), {
        value: newGroupName.trim(),
        compositeValues: Array.from(selectedValues),
      }],
    };

    setDimensionMapping(updatedMapping);
    setNewGroupName("");
    setSelectedValues(new Set());
  }, [newGroupName, selectedValues, dimensionMapping]);

  const handleRemove = useCallback((index: number) => {
    const updatedValues = [...(dimensionMapping.values || [])];
    updatedValues.splice(index, 1);
    setDimensionMapping({ ...dimensionMapping, values: updatedValues });
  }, [dimensionMapping]);


  const toggleValue = useCallback((value: string) => {
    const newSelected = new Set(selectedValues);
    newSelected.has(value) ? newSelected.delete(value) : newSelected.add(value);
    setSelectedValues(newSelected);
  }, [selectedValues]);

  const handleSave = useCallback(() => {
    onSave(dimensionMapping);
    close();
  }, [dimensionMapping, onSave, close]);

  const handleClose = useCallback(() => {
    // Reset to initial state when closing without saving
    setDimensionMapping(initialMapping);
    setNewGroupName("");
    setSelectedValues(new Set());
    setNewCustomValue("");
    close();
  }, [initialMapping, close]);

  return (
    <Modal
      header={`Dimension Editor: ${dimensionName}`}
      open={true}
      close={handleClose}
      submit={handleSave}
      size="lg"
      trackingEventModalType="dimension-editor"
      cta="Save"
    >
      <Box mb="3">
        <Text>Customize the mapping of dimension values into groups. This is useful to reduce dimension breakdowns with too many values.</Text>
      </Box>
      <Flex gap="3" style={{ height: "500px" }}>
        {/* Available Values */}
        <Box style={{ flex: 1 }}>
          <Flex justify="between" align="center" mb="2">
            <Text size="2" weight="bold">Dimension Values</Text>
          </Flex>

          <Flex direction="row">
            <Box style={{ flex: 0.5 }}>
              <ScrollArea style={{ height: "200px", border: "1px solid var(--gray-6)", borderRadius: "4px", marginBottom: "12px" }}>
                <Box p="2">
                  {/* Show unmapped values first */}
                  {unmappedValues.map((item) => (
                    <Flex
                      key={item.value}
                      justify="between"
                      align="center"
                      p="1"
                      style={{ 
                        cursor: "pointer",
                        backgroundColor: selectedValues.has(item.value) ? "var(--accent-3)" : "transparent",
                        borderRadius: "2px",
                        marginBottom: "2px"
                      }}
                      onClick={() => toggleValue(item.value)}
                    >
                      <Flex align="center" gap="1">
                        <Badge variant="soft" size="1">
                          {item.value}
                          {customValues.includes(item.value) && ' (manual)'}
                        </Badge>
                      </Flex>
                    </Flex>
                  ))}
                  
                  {/* Show grouped mappings */}
                  {dimensionMapping.values?.map((mapping, index) => (
                    <Flex
                      key={`mapping-${index}`}
                      justify="between"
                      align="center"
                      p="1"
                      style={{ 
                        backgroundColor: "var(--gray-2)",
                        borderRadius: "2px",
                        marginBottom: "2px",
                        opacity: 0.8
                      }}
                    >
                      <Flex align="center" gap="1" style={{ flex: 1 }}>
                        <Flex align="center" gap="1" wrap="wrap">
                          {mapping.compositeValues && mapping.compositeValues.length > 0 ? (
                            mapping.compositeValues.map((val, i) => {
                              const originalItem = allAvailableValues.find(item => item.value === val);
                              return (
                                <Badge key={i} variant="soft" size="1" color="gray">
                                  {val}
                                  {customValues.includes(val) && ' (manual)'}
                                </Badge>
                              );
                            })
                          ) : (
                            <Badge variant="soft" size="1" color="gray">
                              {mapping.value}
                              {customValues.includes(mapping.value) && ' (manual)'}
                            </Badge>
                          )}
                        </Flex>
                        
                        {mapping.compositeValues && mapping.compositeValues.length > 0 && (
                          <>
                            <PiArrowRight size={12} style={{ color: "var(--gray-9)", margin: "0 4px" }} />
                            <Badge variant="solid" size="1" style={{ fontSize: "10px" }}>
                              {mapping.value}
                              <PiX size={12} style={{ marginLeft: "4px", cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); handleRemove(index); }} />
                            </Badge>
                          </>
                        )}
                      </Flex>
                    </Flex>
                  ))}
                  
                  {allAvailableValues.length === 0 && (
                    <Text size="1" color="gray" style={{ textAlign: "center", padding: "20px" }}>
                      No dimension values available
                    </Text>
                  )}
                </Box>
              </ScrollArea>
            </Box>

            {/* Action Buttons */}
            <Flex direction="column" gap="2">
              {/* Add New Dimension */}
              <Box p="2" style={{ backgroundColor: "var(--gray-2)", borderRadius: "4px", border: "1px solid var(--gray-4)" }}>
                <Text size="1" weight="bold" mb="1">Add new value</Text>
                <Flex gap="1" align="center">
                  <Field
                    value={newCustomValue}
                    onChange={(e) => setNewCustomValue(e.target.value)}
                    placeholder="Enter new dimension value..."
                    style={{ fontSize: "12px" }}
                  />
                  <Button
                    size="1"
                    onClick={handleAddCustomValue}
                    disabled={!newCustomValue.trim()}
                  >
                    <PiPlus />
                  </Button>
                </Flex>
              </Box>

              {/* Combine into Group */}
              <Box p="2" style={{ backgroundColor: "var(--gray-2)", borderRadius: "4px", border: "1px solid var(--gray-4)" }}>
                <Text size="1" weight="bold" mb="1">Combine into one group ({selectedValues.size} selected)</Text>
                <Flex gap="1" align="center">
                  <Field
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="Group name..."
                    style={{ fontSize: "12px" }}
                    disabled={selectedValues.size <= 1}
                  />
                  <Button
                    size="1"
                    onClick={handleCreateGroup}
                    disabled={!newGroupName.trim() || selectedValues.size <= 1}
                  >
                    Combine
                  </Button>
                </Flex>
              </Box></Flex>
          </Flex>
        </Box>
      </Flex>

      {/* SQL Preview */}
      {dimensionMapping.values?.length > 0 && (
        <Box mt="3" p="2" style={{ backgroundColor: "var(--gray-2)", borderRadius: "4px" }}>
          <Text size="2" weight="bold" mb="1">Generated SQL</Text>
          <Text size="1" style={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
            {getDimensionMappingSQL({ dimensionMapping })}
          </Text>
        </Box>
      )}
    </Modal>
  );
}
