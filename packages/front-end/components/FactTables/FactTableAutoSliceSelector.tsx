import React, { useState } from "react";
import { PiPencilSimpleFill, PiStackBold, PiX } from "react-icons/pi";
import { Text, IconButton } from "@radix-ui/themes";
import { FactMetricInterface } from "shared/types/fact-table";
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
  onUpdate: (metricAutoSlices: string[]) => Promise<void>;
  compactButtons?: boolean;
  containerWidth?: number | "auto";
}

export default function FactTableAutoSliceSelector({
  factMetric,
  factTableId,
  canEdit,
  onUpdate,
  compactButtons = true,
  containerWidth = "auto",
}: FactTableAutoSliceSelectorProps) {
  const { hasCommercialFeature } = useUser();
  const { factTables } = useDefinitions();

  // State for editing
  const [isEditing, setIsEditing] = useState(false);
  const [selectedSlices, setSelectedSlices] = useState<string[]>(
    factMetric.metricAutoSlices || [],
  );

  const factTable = factTables.find((ft) => ft.id === factTableId);
  const availableSlices =
    factTable?.columns
      ?.filter((col) => col.isAutoSliceColumn && !col.deleted)
      ?.map((col) => ({
        label: col.name || col.column,
        value: col.column,
      })) || [];

  const metricAutoSlices = factMetric.metricAutoSlices || [];

  const hasPermission = hasCommercialFeature("metric-slices");

  const startEditing = () => {
    setSelectedSlices(factMetric.metricAutoSlices || []);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setSelectedSlices(factMetric.metricAutoSlices || []);
    setIsEditing(false);
  };

  const saveEditing = async () => {
    const previousSlices = factMetric.metricAutoSlices || [];

    // Track the change with specific slices and length
    track("metric-auto-slices-updated", {
      metricId: factMetric.id,
      previousSlices: previousSlices,
      newSlices: selectedSlices,
      sliceCount: selectedSlices.length,
    });

    await onUpdate(selectedSlices);
    setIsEditing(false);
  };

  if (!hasPermission) {
    return null;
  }

  // Show message when no slices are available, regardless of edit state
  if (availableSlices.length === 0) {
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
            value={selectedSlices}
            onChange={setSelectedSlices}
            options={availableSlices}
            placeholder="Auto slice columns..."
            className="mb-0"
            containerStyle={{ width: containerWidth }}
            containerClassName="mr-2"
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
        {metricAutoSlices.filter((slice) => {
          const column = factTable?.columns?.find((c) => c.column === slice);
          return column && !column.deleted;
        }).length ? (
          <div className="d-flex flex-wrap" style={{ gap: "0.25rem" }}>
            {metricAutoSlices.map((slice) => {
              const column = factTable?.columns?.find(
                (col) => col.column === slice,
              );
              if (!column || column.deleted) return null;

              const levels =
                column?.datatype === "boolean"
                  ? ["true", "false"]
                  : column?.autoSlices;
              const hasNoLevels =
                !levels?.length && column?.datatype !== "boolean";
              return (
                <Tooltip
                  key={slice}
                  body={
                    hasNoLevels
                      ? "No slice levels configured"
                      : levels?.join(", ") || "No levels"
                  }
                >
                  <Badge
                    label={
                      <>
                        <PiStackBold />
                        {column?.name || slice}
                      </>
                    }
                    color={hasNoLevels ? "red" : "violet"}
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
