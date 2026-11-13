import { ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ExperimentQaOverrideWithStatus } from "shared/types/experiment-qa-override";
import { QaOverrideGroup, QaOverrideNameLookups } from "@/services/qaOverrides";
import useSortableItem from "@/hooks/useSortableItem";
import FunnelStepDragHandle from "@/components/FactTables/FunnelStepDragHandle";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import {
  DropdownMenu,
  DropdownMenuItem,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
  TableRowHeaderCell,
} from "@/ui/Table";
import QaOverrideAudience from "./QaOverrideAudience";
import QaOverrideStatusBadge from "./QaOverrideStatusBadge";
import styles from "./QaOverridesTable.module.scss";

export type QaOverrideRow = {
  override: ExperimentQaOverrideWithStatus;
  // Set on the SDK Connection page, where rows span experiments.
  experiment?: { id: string; name: string };
  variations: { id: string; name: string }[];
};

export type QaOverridesTableProps = {
  groups: QaOverrideGroup<QaOverrideRow>[];
  /** First column of the flat layout: the environment, or the experiment. */
  leading: "environment" | "experiment";
  /** Environment header rows with priority numbers, for when order matters. */
  grouped?: boolean;
  /** Drag handles inside each environment group. Needs `grouped`. */
  reorderable?: boolean;
  lookups: QaOverrideNameLookups;
  canEdit: (row: QaOverrideRow) => boolean;
  onEdit: (row: QaOverrideRow) => void;
  /** Throws to keep the confirmation open with the error shown inline. */
  onRemove: (row: QaOverrideRow) => Promise<void>;
  removeConfirmation: (row: QaOverrideRow) => string;
  /** The group's overrides in their new order. Rejections are the caller's. */
  onReorder?: (environment: string, orderedIds: string[]) => Promise<void>;
};

function VariationCell({ row }: { row: QaOverrideRow }) {
  const { assignment } = row.override;
  if (assignment.type === "random") {
    return (
      <Text size="inherit" color="text-mid">
        Set by experiment
      </Text>
    );
  }
  const index = row.variations.findIndex(
    (v) => v.id === assignment.variationId,
  );
  if (index < 0)
    return (
      <Text size="inherit" color="text-low">
        Unknown variation
      </Text>
    );
  return (
    <VariationLabel
      number={index}
      name={row.variations[index].name}
      size="sm"
    />
  );
}

function RowCells({
  row,
  priority,
  leading,
  grouped,
  handle,
  showActions,
  lookups,
  canEdit,
  onEdit,
  onRemove,
  removeConfirmation,
}: {
  row: QaOverrideRow;
  priority: number;
  handle: ReactNode;
  showActions: boolean;
} & Pick<
  QaOverridesTableProps,
  | "leading"
  | "grouped"
  | "lookups"
  | "canEdit"
  | "onEdit"
  | "onRemove"
  | "removeConfirmation"
>) {
  const editable = canEdit(row);
  return (
    <>
      {handle !== null && <TableCell>{handle}</TableCell>}
      {grouped ? (
        <TableCell>
          <Text size="sm" weight="semibold" color="text-mid">
            {priority}
          </Text>
        </TableCell>
      ) : leading === "experiment" ? (
        <TableCell>
          {row.experiment ? (
            <Link href={`/experiment/${row.experiment.id}`}>
              {row.experiment.name}
            </Link>
          ) : (
            row.override.experiment
          )}
        </TableCell>
      ) : (
        <TableCell>
          <Text size="inherit" weight="medium">
            {row.override.environment}
          </Text>
        </TableCell>
      )}
      <TableCell>
        <QaOverrideAudience
          variant="inline"
          filters={row.override.filters}
          environment={row.override.environment}
          usesExperimentTargeting={row.override.assignment.type === "random"}
          lookups={lookups}
        />
      </TableCell>
      <TableCell>
        <VariationCell row={row} />
      </TableCell>
      <TableCell>
        <QaOverrideStatusBadge override={row.override} />
      </TableCell>
      {showActions && (
        <TableCell>
          {editable && (
            <span className={styles.actions}>
              <DropdownMenu
                trigger={<MoreMenuTrigger label="Override actions" />}
                menuPlacement="end"
                variant="soft"
              >
                <DropdownMenuItem onClick={() => onEdit(row)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  color="red"
                  confirmation={{
                    confirmationTitle: "Remove this QA override?",
                    cta: "Remove",
                    ctaColor: "red",
                    getConfirmationContent: async () => removeConfirmation(row),
                    // Errors propagate so the dialog shows them inline
                    // instead of closing as if the remove worked.
                    submit: () => onRemove(row),
                  }}
                >
                  Remove
                </DropdownMenuItem>
              </DropdownMenu>
            </span>
          )}
        </TableCell>
      )}
    </>
  );
}

function SortableRow({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { setNodeRef, style, isDragging, handle } = useSortableItem(id);
  return (
    <TableRow
      ref={setNodeRef}
      className={styles.row}
      style={{ ...style, opacity: isDragging ? 0.4 : 1 }}
    >
      {children(<FunnelStepDragHandle handleProps={handle} label={label} />)}
    </TableRow>
  );
}

function Group({
  group,
  reorderable,
  onReorder,
  columns,
  ...cells
}: {
  group: QaOverrideGroup<QaOverrideRow>;
  columns: number;
  reorderable: boolean;
} & Pick<
  QaOverridesTableProps,
  | "leading"
  | "grouped"
  | "lookups"
  | "canEdit"
  | "onEdit"
  | "onRemove"
  | "removeConfirmation"
  | "onReorder"
> & { showActions: boolean }) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const ids = group.rows.map((r) => r.item.override.id);
  // Dragging reorders the whole group, so it needs edit access to all of it.
  const canDrag =
    reorderable &&
    ids.length > 1 &&
    group.rows.every((r) => cells.canEdit(r.item));

  const rows = group.rows.map(({ item: row, priority }) => {
    const { override } = row;
    const label = `override ${priority} in ${group.environment}`;
    return canDrag ? (
      <SortableRow key={override.id} id={override.id} label={label}>
        {(handle) => (
          <RowCells row={row} priority={priority} handle={handle} {...cells} />
        )}
      </SortableRow>
    ) : (
      <TableRow key={override.id} className={styles.row}>
        <RowCells
          row={row}
          priority={priority}
          // Keeps the column count when another group is draggable.
          handle={reorderable ? <span /> : null}
          {...cells}
        />
      </TableRow>
    );
  });

  const header = cells.grouped ? (
    <TableRow className={styles.groupHeader} data-no-hover>
      <TableRowHeaderCell colSpan={columns}>
        <Text weight="semibold" size="sm">
          {group.environment}
        </Text>
      </TableRowHeaderCell>
    </TableRow>
  ) : null;

  if (!canDrag) {
    return (
      <>
        {header}
        {rows}
      </>
    );
  }
  return (
    <>
      {header}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id || !onReorder) return;
          const next = arrayMove(
            ids,
            ids.indexOf(String(active.id)),
            ids.indexOf(String(over.id)),
          );
          void onReorder(group.environment, next);
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {rows}
        </SortableContext>
      </DndContext>
    </>
  );
}

export default function QaOverridesTable({
  groups,
  leading,
  grouped = false,
  reorderable = false,
  lookups,
  canEdit,
  onEdit,
  onRemove,
  removeConfirmation,
  onReorder,
}: QaOverridesTableProps) {
  const showActions = groups.some((g) => g.rows.some((r) => canEdit(r.item)));
  const showHandles =
    grouped &&
    reorderable &&
    groups.some(
      (g) => g.rows.length > 1 && g.rows.every((r) => canEdit(r.item)),
    );
  const columns = (showHandles ? 1 : 0) + 1 + 3 + (showActions ? 1 : 0);

  return (
    <Table variant="ghost" size="sm" className={styles.table}>
      <TableHeader>
        <TableRow>
          {showHandles && (
            <TableColumnHeader aria-label="Reorder" style={{ width: 28 }} />
          )}
          {grouped ? (
            <TableColumnHeader aria-label="Priority" style={{ width: 36 }} />
          ) : (
            <TableColumnHeader
              style={{ width: leading === "environment" ? 136 : undefined }}
            >
              {leading === "environment" ? "Environment" : "Experiment"}
            </TableColumnHeader>
          )}
          <TableColumnHeader>Filters</TableColumnHeader>
          <TableColumnHeader>Variation</TableColumnHeader>
          <TableColumnHeader style={{ width: 124 }}>Status</TableColumnHeader>
          {showActions && (
            <TableColumnHeader aria-label="Actions" style={{ width: 44 }} />
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <Group
            key={group.environment}
            group={group}
            columns={columns}
            leading={leading}
            grouped={grouped}
            reorderable={showHandles}
            showActions={showActions}
            lookups={lookups}
            canEdit={canEdit}
            onEdit={onEdit}
            onRemove={onRemove}
            removeConfirmation={removeConfirmation}
            onReorder={onReorder}
          />
        ))}
      </TableBody>
    </Table>
  );
}
