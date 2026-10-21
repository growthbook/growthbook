import { useState } from "react";
import { RiDraggable } from "react-icons/ri";
import { Box, Flex } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import Text from "@/ui/Text";
import { SortableVariation } from "@/components/Features/SortableFeatureVariationRow";
import SortableVariationsList from "@/components/Features/SortableVariationsList";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import VariationNumber from "@/ui/VariationNumber";
import useSortableItem from "@/hooks/useSortableItem";

type Row = SortableVariation & Pick<Variation, "description" | "screenshots">;

function SortableRow({ row, i }: { row: Row; i: number }) {
  const { setNodeRef, style, isDragging, handle } = useSortableItem(row.id);
  return (
    <Flex
      ref={setNodeRef}
      align="center"
      gap="3"
      px="3"
      py="2"
      style={{
        ...style,
        boxShadow: isDragging ? "0 3px 6px -3px var(--black-a4)" : undefined,
        border: "1px solid var(--gray-a5)",
        borderRadius: "var(--radius-3)",
        background: "var(--color-panel-solid)",
      }}
    >
      <Flex
        {...handle}
        title="Drag and drop to re-order variations"
        align="center"
        style={{ cursor: "grab", color: "var(--color-text-low)" }}
      >
        <RiDraggable size={16} />
      </Flex>
      <VariationNumber number={i} />
      <Box flexGrow="1" minWidth="0">
        <Text truncate>{row.name}</Text>
      </Box>
      <Text color="text-low">{Math.round(row.weight * 1000) / 10}%</Text>
    </Flex>
  );
}

/** Reorders the variations, carrying each one's split and values with it. */
export default function ReorderVariationsModal({
  experiment,
  weights,
  close,
  stage,
}: {
  experiment: ExperimentInterfaceStringDates;
  weights: number[];
  close: () => void;
  stage: (variations: Variation[], weights: number[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    getLatestPhaseVariations(experiment).map(
      ({ id, key, name, description, screenshots }, i) => ({
        id,
        value: key,
        name,
        description,
        screenshots,
        weight: weights[i] ?? 0,
      }),
    ),
  );
  // Default keys follow their position; bespoke ones travel with their variation.
  const keysMatchIndexes = rows.every((r, i) => r.value === i + "");

  return (
    <ModalStandard
      trackingEventModalType="reorder-variations"
      header="Reorder variations"
      open={true}
      close={close}
      cta="Apply"
      submit={() =>
        stage(
          rows.map(({ id, value, name, description, screenshots }) => ({
            id,
            key: value,
            name: name ?? "",
            description: description ?? "",
            screenshots: screenshots ?? [],
          })),
          rows.map((r) => r.weight),
        )
      }
    >
      <SortableVariationsList
        variations={rows}
        valuesAsIds={keysMatchIndexes}
        setVariations={(next) => setRows(next as Row[])}
      >
        {/* Room for a dragged row to travel past the ends before the body clips it. */}
        <Flex direction="column" gap="2" py="5" px="2">
          {rows.map((row, i) => (
            <SortableRow key={row.id} row={row} i={i} />
          ))}
        </Flex>
      </SortableVariationsList>
    </ModalStandard>
  );
}
