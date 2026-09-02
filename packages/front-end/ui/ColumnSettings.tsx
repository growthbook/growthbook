import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiDotsSixVertical, PiEye, PiEyeSlash, PiLock } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";
import Link from "@/ui/Link";

export interface ManagedColumn {
  id: string;
  label: string;
  visible: boolean;
  /** Can still be reordered, but shows a lock instead of a visibility toggle. */
  alwaysVisible?: boolean;
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
        aria-label={`Drag to reorder ${column.label}`}
        style={{ cursor: "grab", display: "flex", color: "var(--gray-8)" }}
      >
        <PiDotsSixVertical />
      </span>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text
          as="div"
          size="sm"
          color={column.visible ? "text-high" : "text-low"}
          truncate
        >
          {column.label}
        </Text>
      </Box>
      {column.alwaysVisible ? (
        <Tooltip content="This column is always shown">
          {/* Not a button: a ghost IconButton shows hover/press states for something inert. 16px is the toggle's layout box. */}
          <span
            role="img"
            aria-label={`${column.label} column is always shown`}
            style={{
              display: "inline-flex",
              width: 16,
              height: 16,
              color: "var(--gray-a11)",
            }}
          >
            <PiLock size={16} />
          </span>
        </Tooltip>
      ) : (
        <Tooltip content={column.visible ? "Hide column" : "Show column"}>
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
      )}
    </Flex>
  );
}

export interface ColumnSettingsProps {
  columns: ManagedColumn[];
  onChange: (columns: { id: string; visible: boolean }[]) => void;
  onReset?: () => void;
  canReset?: boolean;
}

export default function ColumnSettings({
  columns,
  onChange,
  onReset,
  canReset,
}: ColumnSettingsProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
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
    <>
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
      {onReset && canReset && (
        <Flex justify="end" mt="3">
          <Link onClick={onReset}>
            <Text size="sm">Reset to default</Text>
          </Link>
        </Flex>
      )}
    </>
  );
}
