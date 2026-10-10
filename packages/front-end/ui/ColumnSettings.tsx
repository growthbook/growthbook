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
import { Flex } from "@radix-ui/themes";
import { PiDotsSixVertical, PiDotsSixVerticalBold } from "react-icons/pi";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import styles from "./ColumnSettings.module.scss";

export interface ManagedColumn {
  id: string;
  label: string;
  visible: boolean;
  /** Can still be reordered, but its checkbox is checked and disabled. The
   * popover's helper copy is where that gets explained. */
  alwaysVisible?: boolean;
}

function SortableColumnRow({
  column,
  onToggle,
  plainRows,
}: {
  column: ManagedColumn;
  onToggle: (visible: boolean) => void;
  plainRows?: boolean;
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
      className={plainRows ? styles.plainRow : undefined}
      data-dragging={isDragging || undefined}
      // plainRows: a click anywhere on the row's background checks or
      // unchecks it too (set in review). Clicks on the checkbox and its label
      // already do, and the handle is for dragging, so those are left alone.
      onClick={
        plainRows && !column.alwaysVisible
          ? (e) => {
              const target = e.target as HTMLElement;
              if (target.closest("label, button, [data-drag-handle]")) return;
              onToggle(!column.visible);
            }
          : undefined
      }
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.9 : 1,
        border: plainRows ? undefined : "1px solid var(--gray-a5)",
        borderRadius: "var(--radius-3)",
        backgroundColor: "var(--color-panel-solid)",
        boxShadow: isDragging ? "var(--shadow-4)" : undefined,
      }}
    >
      <span
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${column.label}`}
        data-drag-handle
        style={{
          cursor: "grab",
          display: "flex",
          color: plainRows ? "var(--gray-10)" : "var(--gray-8)",
        }}
      >
        {plainRows ? <PiDotsSixVerticalBold /> : <PiDotsSixVertical />}
      </span>
      <Checkbox
        size="sm"
        labelSize="sm"
        weight="regular"
        label={column.label}
        value={column.visible}
        setValue={onToggle}
        disabled={column.alwaysVisible}
      />
    </Flex>
  );
}

export interface ColumnSettingsProps {
  columns: ManagedColumn[];
  onChange: (columns: { id: string; visible: boolean }[]) => void;
  onReset?: () => void;
  canReset?: boolean;
  /** Rows without outlines, shown by a fill on hover, and a darker, bold drag
   * handle (set in review; the experiments list). Off by default. */
  plainRows?: boolean;
}

export default function ColumnSettings({
  columns,
  onChange,
  onReset,
  canReset,
  plainRows = false,
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
          {/* Only the list scrolls, so the reset link stays reachable. pr is
              for the scrollbar, which would otherwise sit on the row borders;
              plainRows have no borders, so their hover fill keeps the same
              16px from both sides of the popover (set in review). */}
          <Flex
            direction="column"
            gap={plainRows ? "0" : "2"}
            pr={plainRows ? "0" : "1"}
            style={{ maxHeight: "min(50vh, 360px)", overflowY: "auto" }}
          >
            {columns.map((c) => (
              <SortableColumnRow
                key={c.id}
                column={c}
                onToggle={(v) => toggle(c.id, v)}
                plainRows={plainRows}
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
