import React, { useState } from "react";
import { PiPencilSimpleFill, PiStackBold, PiX } from "react-icons/pi";
import { Text, IconButton } from "@radix-ui/themes";
import { FactMetricInterface } from "back-end/types/fact-table";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import track from "@/services/track";

interface FactTableAutoSliceSelectorProps {
  factMetric: FactMetricInterface;
  factTableId: string;
  canEdit: boolean;
  onUpdate: (metricAutoDimensions: string[]) => Promise<void>;
  compactButtons?: boolean;
}

export default function FactTableAutoSliceSelector({
  factMetric,
  factTableId,
  canEdit,
  onUpdate,
  compactButtons = true,
}: FactTableAutoSliceSelectorProps) {
  const { hasCommercialFeature } = useUser();
  const { factTables } = useDefinitions();

  // State for editing
  const [isEditing, setIsEditing] = useState(false);
  const [selectedDimensions, setSelectedDimensions] = useState<string[]>(
    factMetric.metricAutoDimensions || [],
  );

  const factTable = factTables.find((ft) => ft.id === factTableId);
  const availableDimensions =
    factTable?.columns
      ?.filter((col) => col.isDimension && !col.deleted)
      ?.map((col) => ({
        label: col.name || col.column,
        value: col.column,
      })) || [];

  const metricAutoDimensionsWithLevels =
    factMetric.metricAutoDimensions?.filter((dimension) => {
      const column = factTable?.columns?.find(
        (col) => col.column === dimension,
      );
      return !!column?.dimensionLevels?.length;
    }) || [];

  const hasPermission = hasCommercialFeature("metric-dimensions");

  const startEditing = () => {
    setSelectedDimensions(factMetric.metricAutoDimensions || []);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setSelectedDimensions(factMetric.metricAutoDimensions || []);
    setIsEditing(false);
  };

  const saveEditing = async () => {
    const previousDimensions = factMetric.metricAutoDimensions || [];

    // Track the change with specific slices and length
    track("metric-auto-slices-updated", {
      metricId: factMetric.id,
      previousSlices: previousDimensions,
      newSlices: selectedDimensions,
      previousCount: previousDimensions.length,
      newCount: selectedDimensions.length,
      addedSlices: selectedDimensions.filter(
        (slice) => !previousDimensions.includes(slice),
      ),
      removedSlices: previousDimensions.filter(
        (slice) => !selectedDimensions.includes(slice),
      ),
    });

    await onUpdate(selectedDimensions);
    setIsEditing(false);
  };

  if (!hasPermission) {
    return null;
  }

  // Show message when no dimensions are available, regardless of edit state
  if (availableDimensions.length === 0) {
    return (
      <div className="d-flex align-items-center" style={{ gap: "0.5rem" }}>
        <div className="flex-grow-1">
          <Text
            as="span"
            style={{ color: "var(--color-text-low)", fontStyle: "italic" }}
            size="1"
          >
            No slices available. Configure your fact table to enable auto
            slices.
          </Text>
        </div>
        {isEditing && (
          <Button size="xs" onClick={cancelEditing} mr="1">
            Cancel
          </Button>
        )}
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="d-flex align-items-center" style={{ gap: "0.5rem" }}>
        <div className="flex-grow-1">
          <MultiSelectField
            value={selectedDimensions}
            onChange={setSelectedDimensions}
            options={availableDimensions}
            placeholder="Auto slice columns..."
            className="mb-0"
            containerStyle={{ width: 275 }}
          />
        </div>
        <Button
          size={compactButtons ? "xs" : "sm"}
          onClick={saveEditing}
          mr={compactButtons ? "1" : "2"}
        >
          Save
        </Button>
        <IconButton
          variant="ghost"
          size={compactButtons ? "2" : "3"}
          onClick={cancelEditing}
        >
          <PiX />
        </IconButton>
      </div>
    );
  }

  return (
    <div className="d-flex align-items-center" style={{ gap: "0.5rem" }}>
      <div className="flex-grow-1">
        {metricAutoDimensionsWithLevels.length ? (
          <div className="d-flex flex-wrap" style={{ gap: "0.25rem" }}>
            {metricAutoDimensionsWithLevels.map((dimension) => {
              const column = factTable?.columns?.find(
                (col) => col.column === dimension,
              );
              const levels = column?.dimensionLevels;
              return (
                <Tooltip key={dimension} body={levels?.join(", ") || ""}>
                  <Badge
                    label={
                      <>
                        <PiStackBold />
                        {column?.name || dimension}
                      </>
                    }
                    color="violet"
                  />
                </Tooltip>
              );
            })}
          </div>
        ) : (
          <Text
            as="span"
            style={{ color: "var(--color-text-low)", fontStyle: "italic" }}
            size="1"
          >
            No auto slices
          </Text>
        )}
      </div>
      {canEdit && compactButtons ? (
        <IconButton variant="ghost" size="1" onClick={startEditing}>
          <PiPencilSimpleFill />
        </IconButton>
      ) : (
        <Button onClick={startEditing} variant="ghost">
          Edit
        </Button>
      )}
    </div>
  );
}
