import { useState } from "react";
import { Flex, IconButton } from "@radix-ui/themes";
import clsx from "clsx";
import { PiPlus } from "react-icons/pi";
import { ExperimentIdeaListItem } from "shared/validators";
import { ExperimentIdeaStage } from "shared/types/organization";
import Text from "@/ui/Text";
import IdeaCard from "./IdeaCard";
import styles from "./ExperimentIdeas.module.scss";

type Column = {
  id: string;
  label: string;
  color: string;
  description?: string;
  ideas: ExperimentIdeaListItem[];
  inFlight?: boolean;
};

export default function IdeaBoard({
  ideas,
  stages,
  visibleStageIds,
  canCreate,
  onAdd,
  onMove,
  onToggleUpvote,
}: {
  ideas: ExperimentIdeaListItem[];
  stages: ExperimentIdeaStage[];
  visibleStageIds: string[];
  canCreate: boolean;
  onAdd: (stageId: string) => void;
  onMove: (idea: ExperimentIdeaListItem, stageId: string) => void;
  onToggleUpvote: (idea: ExperimentIdeaListItem) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  // Converted ideas leave the working columns; their stage is superseded by
  // derived state.
  const isConverted = (i: ExperimentIdeaListItem) =>
    i.derivedStates.includes("converted");

  const columns: Column[] = stages
    .filter((s) => visibleStageIds.includes(s.id))
    .map((s) => ({
      id: s.id,
      label: s.label,
      color: s.color || "gray",
      description: s.description,
      ideas: ideas.filter((i) => i.stage === s.id && !isConverted(i)),
    }));

  const unknownStageIdeas = ideas.filter(
    (i) => !stageMap.has(i.stage) && !isConverted(i),
  );
  if (unknownStageIdeas.length) {
    columns.push({
      id: "__unknown",
      label: "Unknown stage",
      color: "gray",
      description: "Their stage was removed from settings.",
      ideas: unknownStageIdeas,
    });
  }

  const inFlight = ideas.filter(
    (i) => isConverted(i) && visibleStageIds.includes(i.stage),
  );
  if (inFlight.length) {
    columns.push({
      id: "__inflight",
      label: "Converted & in flight",
      color: "indigo",
      description:
        "Not a stage: these ideas have at least one linked experiment.",
      ideas: inFlight,
      inFlight: true,
    });
  }

  const dragged = ideas.find((i) => i.id === draggingId);
  const canDrop = (column: Column) =>
    !!dragged && !column.id.startsWith("__") && dragged.stage !== column.id;

  return (
    <div className={styles.board}>
      {columns.map((column) => (
        <div
          key={column.id}
          className={clsx(
            styles.column,
            column.inFlight && styles.columnInFlight,
            dragOverId === column.id && styles.columnDragOver,
          )}
          onDragOver={(e) => {
            if (!canDrop(column)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragOverId !== column.id) setDragOverId(column.id);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDragOverId(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverId(null);
            if (dragged && canDrop(column)) onMove(dragged, column.id);
            setDraggingId(null);
          }}
        >
          <div className={styles.columnHeader}>
            <Flex align="center" gap="2">
              <span
                className={styles.stageDot}
                style={{ background: `var(--${column.color}-9)` }}
              />
              <Text weight="semibold">{column.label}</Text>
              <Text size="sm" color="text-low">
                {column.ideas.length}
              </Text>
              {canCreate && !column.id.startsWith("__") && (
                <IconButton
                  variant="ghost"
                  color="gray"
                  size="1"
                  ml="auto"
                  aria-label={`New idea in ${column.label}`}
                  onClick={() => onAdd(column.id)}
                >
                  <PiPlus />
                </IconButton>
              )}
            </Flex>
            {column.description && (
              <Text as="div" size="sm" color="text-mid" mt="1">
                {column.description}
              </Text>
            )}
          </div>
          <div className={styles.columnBody}>
            {column.ideas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                stage={stageMap.get(idea.stage)}
                draggable={idea.canManage && !isConverted(idea)}
                dragging={draggingId === idea.id}
                onDragStart={() => setDraggingId(idea.id)}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDragOverId(null);
                }}
                onToggleUpvote={() => onToggleUpvote(idea)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
