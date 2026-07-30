import {
  closestCenter,
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiDotsSixVertical, PiEye, PiEyeSlash } from "react-icons/pi";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";

export interface ManagedColumn {
  id: string;
  label: string;
  visible: boolean;
}

function SortableColumnRow({
  column,
  onToggle,
}: {
  column: ManagedColumn;
  onToggle: (visible: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  return (
    <Flex
      ref={setNodeRef}
      align="center"
      gap="2"
      py="2"
      px="2"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.9 : 1,
        border: "1px solid var(--gray-a5)",
        borderRadius: "var(--radius-3)",
        backgroundColor: "var(--color-panel-solid)",
        boxShadow: isDragging ? "var(--shadow-4)" : undefined,
      }}
    >
      <span
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        style={{ cursor: "grab", display: "flex", color: "var(--gray-8)" }}
      >
        <PiDotsSixVertical />
      </span>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text
          as="div"
          size="small"
          color={column.visible ? "text-high" : "text-low"}
          truncate
        >
          {column.label}
        </Text>
      </Box>
      <Tooltip body={column.visible ? "Hide column" : "Show column"}>
        <IconButton
          size="1"
          variant="ghost"
          color={column.visible ? "violet" : "gray"}
          aria-label={column.visible ? "Hide column" : "Show column"}
          onClick={() => onToggle(!column.visible)}
        >
          {column.visible ? <PiEye size={16} /> : <PiEyeSlash size={16} />}
        </IconButton>
      </Tooltip>
    </Flex>
  );
}

interface Props {
  columns: ManagedColumn[];
  onChange: (columns: { id: string; visible: boolean }[]) => void;
}

export default function MetricExperimentsColumnSettings({
  columns,
  onChange,
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor));
  const ids = columns.map((c) => c.id);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(columns, oldIndex, newIndex);
    onChange(reordered.map((c) => ({ id: c.id, visible: c.visible })));
  };

  const toggle = (id: string, visible: boolean) => {
    onChange(
      columns.map((c) => ({
        id: c.id,
        visible: c.id === id ? visible : c.visible,
      })),
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <Flex direction="column" gap="2">
          {columns.map((c) => (
            <SortableColumnRow
              key={c.id}
              column={c}
              onToggle={(v) => toggle(c.id, v)}
            />
          ))}
        </Flex>
      </SortableContext>
    </DndContext>
  );
}
