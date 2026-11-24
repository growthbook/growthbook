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
import { qaOverrideHasOwnTargeting } from "shared/util";
import {
  QaOverrideGroup,
  QaOverrideNameLookups,
  withStaleSdkConnections,
} from "@/services/qaOverrides";
import useSortableItem from "@/hooks/useSortableItem";
import FunnelStepDragHandle from "@/components/FactTables/FunnelStepDragHandle";
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

type Override = ExperimentQaOverrideWithStatus;

export type QaOverridesTableProps = {
  groups: QaOverrideGroup<Override>[];
  variations: { id: string; name: string }[];
  grouped?: boolean;
  reorderable?: boolean;
  lookups: QaOverrideNameLookups;
  canEdit: (override: Override) => boolean;
  onEdit: (override: Override) => void;
  onRemove: (override: Override) => Promise<void>;
  removeConfirmation: (override: Override) => string;
  onReorder?: (environment: string, orderedIds: string[]) => void;
};

function VariationCell({
  override,
  variations,
}: Pick<QaOverridesTableProps, "variations"> & { override: Override }) {
  const { assignment } = override;
  if (assignment.type === "random") {
    return (
      <Text size="inherit" color="text-mid">
        Set by experiment
      </Text>
    );
  }
  const index = variations.findIndex((v) => v.id === assignment.variationId);
  if (index < 0)
    return (
      <Text size="inherit" color="text-mid" fontStyle="italic">
        Deleted variation
      </Text>
    );
  return (
    <VariationLabel number={index} name={variations[index].name} size="sm" />
  );
}

function RowCells({
  override,
  variations,
  priority,
  grouped,
  handle,
  showActions,
  lookups,
  canEdit,
  onEdit,
  onRemove,
  removeConfirmation,
}: {
  override: Override;
  priority: number;
  handle: ReactNode;
  showActions: boolean;
} & Pick<
  QaOverridesTableProps,
  | "variations"
  | "grouped"
  | "lookups"
  | "canEdit"
  | "onEdit"
  | "onRemove"
  | "removeConfirmation"
>) {
  const editable = canEdit(override);
  const rowLookups = withStaleSdkConnections(
    lookups,
    override.staleSdkConnections,
  );
  return (
    <>
      {handle !== null && <TableCell>{handle}</TableCell>}
      {grouped ? (
        <TableCell>
          <Text size="sm" weight="semibold" color="text-mid">
            {priority}
          </Text>
        </TableCell>
      ) : (
        <TableCell>
          <Text size="inherit" weight="medium">
            {override.environment}
          </Text>
        </TableCell>
      )}
      <TableCell>
        <QaOverrideAudience
          variant="inline"
          filters={override.filters}
          environment={override.environment}
          usesExperimentTargeting={
            override.assignment.type === "random" &&
            !qaOverrideHasOwnTargeting(override.filters)
          }
          lookups={rowLookups}
        />
      </TableCell>
      <TableCell>
        <VariationCell override={override} variations={variations} />
      </TableCell>
      <TableCell>
        <QaOverrideStatusBadge
          override={override}
          onEdit={editable ? () => onEdit(override) : undefined}
        />
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
                <DropdownMenuItem onClick={() => onEdit(override)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  color="red"
                  confirmation={{
                    confirmationTitle: "Remove this QA override?",
                    cta: "Remove",
                    ctaColor: "red",
                    getConfirmationContent: async () =>
                      removeConfirmation(override),
                    // Let errors propagate so the dialog shows them inline.
                    submit: () => onRemove(override),
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
  group: QaOverrideGroup<Override>;
  columns: number;
  reorderable: boolean;
} & Pick<
  QaOverridesTableProps,
  | "variations"
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
  const ids = group.rows.map((r) => r.item.id);
  const canDrag =
    reorderable &&
    ids.length > 1 &&
    group.rows.every((r) => cells.canEdit(r.item));

  const rows = group.rows.map(({ item: override, priority }) => {
    const label = `override ${priority} in ${group.environment}`;
    return canDrag ? (
      <SortableRow key={override.id} id={override.id} label={label}>
        {(handle) => (
          <RowCells
            override={override}
            priority={priority}
            handle={handle}
            {...cells}
          />
        )}
      </SortableRow>
    ) : (
      <TableRow key={override.id} className={styles.row}>
        <RowCells
          override={override}
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
          onReorder(group.environment, next);
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
  variations,
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
            <TableColumnHeader style={{ width: 136 }}>
              Environment
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
            variations={variations}
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
