import React, {
  FC,
  Fragment,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { RxDesktop } from "react-icons/rx";
import { Flex } from "@radix-ui/themes";
import { BsFlag } from "react-icons/bs";
import { PiShuffle } from "react-icons/pi";
import { ComputedExperimentInterface } from "shared/types/experiment";
import { date, datetime } from "shared/dates";
import Tooltip from "@/components/Tooltip/Tooltip";
import WatchButton from "@/components/WatchButton";
import ColumnResizeHandle from "@/ui/ColumnResizeHandle";
import {
  useTableColumns,
  UseTableColumnsReturn,
} from "@/hooks/useTableColumns";
import { columnWidthBounds, TableColumnDef } from "@/services/tableColumns";
import SortedTags from "@/components/Tags/SortedTags";
import {
  ExperimentDot,
  ExperimentStatusDetailsWithDot,
} from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Pagination from "@/ui/Pagination";
import UITooltip from "@/ui/Tooltip";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { tagFilterOnClick, tagLinkProps } from "@/services/search";
import {
  EXPERIMENT_HEALTH_STATE_LABELS,
  getHealthStateFromDetailedStatus,
  getTempRolloutTooltip,
} from "@/services/experiments";
import {
  isTempRolloutHealthState,
  TEMP_ROLLOUT_HEALTH,
} from "@/services/health";

interface ExperimentsListTableProps {
  tab: string;
  SortableTableColumnHeader: FC<{
    field: string;
    className?: string;
    children: React.ReactNode;
    style?: React.CSSProperties;
    // Rendered beside the sort target, e.g. a column resize handle.
    endAdornment?: React.ReactNode;
  }>;
  filtered: Array<ComputedExperimentInterface>;
  isFiltered: boolean;
  project?: string | null;
  searchValue: string;
  setSearchValue: (value: string) => void;
  hrefBase?: string;
  // The leading column of watch (eye) icons. Off on the experiments list
  // (set in review); the bandits list keeps it.
  showWatchColumn?: boolean;
  // Rows glide to their new places when the sort changes, rather than
  // jumping (set in review; on the experiments list).
  animateSort?: boolean;
  // Fixed column widths, so re-sorting (which brings different experiments
  // onto the page) doesn't resize the columns and shift them sideways (set
  // in review; on the experiments list). See FIXED_COLUMN_WIDTHS.
  fixedColumns?: boolean;
  // Columns to leave out (set in review: the experiments list hides Owner,
  // Date and Result). All shown when absent.
  hiddenColumns?: ("owner" | "date" | "result")[];
  // Status and Health (and Result) right after Experiment, then Project,
  // Owner and Date, with Tags last (set in review; on the experiments list).
  statusFirst?: boolean;
  // Resizable columns (set in review; on the experiments list): px widths
  // (RESIZABLE_COLUMN_WIDTHS) that a handle on each header's free side can
  // drag, saved in this browser under this key (useTableColumns, as the
  // attributes page). Experiment takes the rest. Replaces fixedColumns'
  // shares when set.
  resizableColumnsKey?: string;
  // The column state, when the page holds it (built from
  // experimentsListColumnDefs with this table's options); otherwise the
  // table keeps its own, under resizableColumnsKey.
  tableColumns?: UseTableColumnsReturn<ComputedExperimentInterface>;
}

// With resizableColumnsKey: each column's starting width in px, and the
// Experiment column's floor (it takes the rest). The starting widths add up
// to well under a laptop's content width, so the table fits until someone
// drags it wider; RESIZABLE_MAX_WIDTH caps how far one column can go.
const RESIZABLE_COLUMN_WIDTHS: Partial<Record<ColumnKey, number>> = {
  watch: 40,
  status: 150,
  result: 150,
  health: 130,
  project: 150,
  owner: 150,
  date: 170,
  tags: 200,
};
const RESIZABLE_NAME_MIN_WIDTH = 240;
const RESIZABLE_MIN_WIDTH = 80;
const RESIZABLE_MAX_WIDTH = 400;
export type ExperimentsListColumnKey = ColumnKey;

// The columns for useTableColumns, with resizableColumnsKey: widths, resize
// bounds and which start hidden. Exported so a page can hold the column
// state itself (e.g. to put the column settings in its own toolbar) and
// pass it in as tableColumns; build it with the same options the table gets.
export function experimentsListColumnDefs({
  statusFirst = false,
  hiddenColumns = [],
  showWatchColumn = true,
}: {
  statusFirst?: boolean;
  hiddenColumns?: ("owner" | "date" | "result")[];
  showWatchColumn?: boolean;
}): TableColumnDef<ComputedExperimentInterface>[] {
  return (statusFirst ? STATUS_FIRST_ORDER : COLUMN_ORDER)
    .filter((id) => id !== "watch" || showWatchColumn)
    .map((id) => ({
      id,
      label: COLUMN_LABELS[id],
      render: () => null,
      ...(id === "name"
        ? { locked: true, minWidth: RESIZABLE_NAME_MIN_WIDTH }
        : {
            defaultWidth: RESIZABLE_COLUMN_WIDTHS[id],
            minWidth: id === "watch" ? 40 : RESIZABLE_MIN_WIDTH,
            maxWidth: RESIZABLE_MAX_WIDTH,
            resizable: id !== "watch",
            hideable: id !== "watch",
            defaultHidden:
              (id === "owner" || id === "date" || id === "result") &&
              hiddenColumns.includes(id),
          }),
    }));
}

const COLUMN_LABELS: Record<ColumnKey, string> = {
  watch: "Watch",
  name: "Experiment",
  project: "Project",
  tags: "Tags",
  owner: "Owner",
  date: "Date",
  status: "Status",
  result: "Result",
  health: "Health",
};

type ColumnKey =
  | "watch"
  | "name"
  | "project"
  | "tags"
  | "owner"
  | "date"
  | "status"
  | "result"
  | "health";
const COLUMN_ORDER: ColumnKey[] = [
  "watch",
  "name",
  "project",
  "tags",
  "owner",
  "date",
  "status",
  "result",
  "health",
];
const STATUS_FIRST_ORDER: ColumnKey[] = [
  "watch",
  "name",
  "status",
  "result",
  "health",
  "project",
  "owner",
  "date",
  "tags",
];

// With fixedColumns: widths as shares of the table, for every column but
// Experiment, which takes the rest (at least 24% with every column shown).
// Shares rather than px, so the table always fits the page (set in review:
// px widths, about 1,400px in all, ran off narrower screens); they still
// don't change when a re-sort brings other experiments onto the page.
const FIXED_COLUMN_WIDTHS = {
  project: "10%",
  tags: "14%",
  owner: "11%",
  date: "12%",
  status: "11%",
  result: "10%",
  health: "8%",
};
// The watch column's icon, in px, as before.
const WATCH_COLUMN_WIDTH = 40;

// Starts quickly, settles gently; no overshoot (as the primary buttons).
const SORT_EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

// FLIP: after a re-sort, each row that was already on the page starts where
// it was and glides to its new place; rows new to the page fade in. Only for
// a re-sort, when the list holds the same experiments in a new order: a
// search or tab change (a different set) stays instant, so typing doesn't
// set the rows moving. Instant for reduced motion. Positions are offsetTop,
// within the table, so scrolling in between doesn't skew them.
function useSortAnimation(
  enabled: boolean,
  filtered: ComputedExperimentInterface[],
  visibleIds: string[],
) {
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const prevTops = useRef(new Map<string, number>());
  const prevOrder = useRef<string[] | null>(null);

  const order = filtered.map((e) => e.id);
  const orderKey = order.join("\n");
  const visibleKey = visibleIds.join("\n");

  useLayoutEffect(() => {
    const rows = rowRefs.current;
    const measure = () => {
      const tops = new Map<string, number>();
      visibleIds.forEach((id) => {
        const el = rows.get(id);
        if (el) tops.set(id, el.offsetTop);
      });
      prevTops.current = tops;
    };

    const previous = prevOrder.current;
    prevOrder.current = order;
    const isResort =
      !!previous &&
      previous.length === order.length &&
      previous.join("\n") !== orderKey &&
      [...previous].sort().join("\n") === [...order].sort().join("\n");
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (enabled && isResort && !reducedMotion) {
      visibleIds.forEach((id) => {
        const el = rows.get(id);
        if (!el || typeof el.animate !== "function") return;
        const oldTop = prevTops.current.get(id);
        if (oldTop === undefined) {
          el.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 250,
            easing: SORT_EASE_OUT,
          });
          return;
        }
        const dy = oldTop - el.offsetTop;
        if (dy === 0) return;
        el.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
          { duration: 300, easing: SORT_EASE_OUT },
        );
      });
    }
    measure();
    // visibleIds and order are captured by their keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, orderKey, visibleKey]);

  return (id: string) => (el: HTMLTableRowElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  };
}

const ExperimentsListTable: React.FC<ExperimentsListTableProps> = ({
  tab,
  SortableTableColumnHeader,
  filtered,
  isFiltered,
  project,
  searchValue,
  setSearchValue,
  hrefBase = "/experiment",
  showWatchColumn = true,
  animateSort = false,
  fixedColumns = false,
  hiddenColumns = [],
  statusFirst = false,
  resizableColumnsKey,
  tableColumns: tableColumnsProp,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const NUM_PER_PAGE = 20;
  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const visible = filtered.slice(start, end);
  const rowRef = useSortAnimation(
    animateSort,
    filtered,
    visible.map((e) => e.id),
  );

  const needsStatusColumn = tab === "all" || tab === "running";
  // With resizable columns, the column state decides whether Owner, Date
  // and Result show (hiddenColumns only sets where they start), so they can
  // be turned back on from the column settings.
  const resizableColumns = !!resizableColumnsKey || !!tableColumnsProp;
  const needsResultColumn =
    (resizableColumns || !hiddenColumns.includes("result")) &&
    (tab === "stopped" || tab === "running" || tab === "all");
  const showOwnerColumn = resizableColumns || !hiddenColumns.includes("owner");
  const showDateColumn = resizableColumns || !hiddenColumns.includes("date");
  // If "All Projects" is selected and some experiments are in a project, show the project column
  const showProjectColumn = !project && filtered.some((e) => e.project);
  const showHealthColumn = filtered.some((e) => e.healthState !== null);

  // Reset to page 1 when a filter is applied or tabs change
  useEffect(() => {
    setCurrentPage(1);
  }, [filtered.length]);

  const fixedWidth = (column: keyof typeof FIXED_COLUMN_WIDTHS) =>
    fixedColumns && !resizableColumnsKey
      ? { width: FIXED_COLUMN_WIDTHS[column] }
      : undefined;

  const resizable = resizableColumns;
  const order = statusFirst ? STATUS_FIRST_ORDER : COLUMN_ORDER;
  // The columns' widths and resize bounds for useTableColumns. Its own
  // visibility handles the default-hidden columns; which columns a tab
  // shows (shownColumns) is applied on top. Cells render through
  // renderCell, not the defs' render.
  const columnDefs = useMemo(
    () =>
      experimentsListColumnDefs({
        statusFirst,
        hiddenColumns,
        showWatchColumn,
      }),
    // hiddenColumns is a literal at each call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusFirst, hiddenColumns.join(","), showWatchColumn],
  );
  const ownTableColumns = useTableColumns({
    storageKey: resizableColumnsKey ?? "experiments-list-table",
    columns: columnDefs,
  });
  const tableColumns = tableColumnsProp ?? ownTableColumns;
  const resolvedById = new Map(
    tableColumns.columns.map((col) => [col.id as ColumnKey, col]),
  );

  const shownColumns: Record<ColumnKey, boolean> = {
    watch: showWatchColumn,
    name: true,
    project: showProjectColumn,
    tags: true,
    owner: showOwnerColumn,
    date: showDateColumn,
    status: needsStatusColumn,
    result: needsResultColumn,
    health: showHealthColumn,
  };
  // Each column's header and cell, rendered in COLUMN_ORDER (or
  // STATUS_FIRST_ORDER) and filtered to the columns this tab shows.
  const renderHeader = (column: ColumnKey, adornment: ReactNode = null) => {
    switch (column) {
      case "watch":
        return <TableColumnHeader style={{ width: WATCH_COLUMN_WIDTH }} />;
      case "name":
        return (
          <SortableTableColumnHeader
            field="name"
            style={fixedColumns ? undefined : { maxWidth: 320 }}
            endAdornment={adornment}
          >
            Experiment
          </SortableTableColumnHeader>
        );
      case "project":
        return (
          <SortableTableColumnHeader
            field="projectName"
            style={fixedWidth("project")}
            endAdornment={adornment}
          >
            Project
          </SortableTableColumnHeader>
        );
      case "tags":
        return (
          <SortableTableColumnHeader
            field="tags"
            style={fixedWidth("tags")}
            endAdornment={adornment}
          >
            Tags
          </SortableTableColumnHeader>
        );
      case "owner":
        return (
          <SortableTableColumnHeader
            field="ownerName"
            style={fixedWidth("owner")}
            endAdornment={adornment}
          >
            Owner
          </SortableTableColumnHeader>
        );
      case "date":
        return (
          <SortableTableColumnHeader
            field="date"
            style={fixedWidth("date")}
            endAdornment={adornment}
          >
            Date
          </SortableTableColumnHeader>
        );
      case "status":
        return (
          <SortableTableColumnHeader
            field="statusSortOrder"
            style={fixedWidth("status")}
            endAdornment={adornment}
          >
            Status
          </SortableTableColumnHeader>
        );
      case "result":
        return needsStatusColumn ? (
          <TableColumnHeader style={fixedWidth("result")}>
            Result
            {adornment}
          </TableColumnHeader>
        ) : (
          <SortableTableColumnHeader
            field="statusSortOrder"
            style={fixedWidth("result")}
            endAdornment={adornment}
          >
            Result
          </SortableTableColumnHeader>
        );
      case "health":
        return (
          <SortableTableColumnHeader
            field="healthSortOrder"
            style={fixedWidth("health")}
            endAdornment={adornment}
          >
            Health
          </SortableTableColumnHeader>
        );
    }
  };
  const renderCell = (column: ColumnKey, e: ComputedExperimentInterface) => {
    switch (column) {
      case "watch":
        return (
          <TableCell className="watching">
            <WatchButton item={e.id} itemType="experiment" type="icon" />
          </TableCell>
        );
      case "name":
        return (
          <TableCell style={{ padding: "var(--space-0)" }}>
            <Link
              href={`${hrefBase}/${e.id}`}
              style={{
                display: "block",
                // Top and bottom through a variable too, so a compact
                // density can tighten them.
                padding:
                  "var(--experiments-name-padding-y, var(--space-3)) var(--space-3)",
                // The cell has no padding (the link fills it), so a page
                // can set the name's left inset through this variable:
                // the experiments list does, when it's the first column.
                paddingLeft:
                  "var(--experiments-name-padding-left, var(--space-3))",
                color: "var(--gray-12)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span className="testname">{e.name}</span>
                  {e.hasVisualChangesets ? (
                    <Tooltip
                      flipTheme={false}
                      // Outside the cell, which clips its overflow on
                      // the experiments list (fixedColumns).
                      usePortal
                      style={{
                        display: "flex",
                        alignItems: "center",
                        marginLeft: "var(--space-2)",
                      }}
                      body="Visual experiment"
                    >
                      <RxDesktop className="text-blue" />
                    </Tooltip>
                  ) : null}
                  {(e.linkedFeatures || []).length > 0 ? (
                    <Tooltip
                      flipTheme={false}
                      usePortal
                      style={{
                        display: "flex",
                        alignItems: "center",
                        marginLeft: "var(--space-2)",
                      }}
                      body="Linked Feature Flag"
                    >
                      <BsFlag className="text-blue" />
                    </Tooltip>
                  ) : null}
                  {e.hasURLRedirects ? (
                    <Tooltip
                      flipTheme={false}
                      usePortal
                      style={{
                        display: "flex",
                        alignItems: "center",
                        marginLeft: "var(--space-2)",
                      }}
                      body="URL Redirect experiment"
                    >
                      <PiShuffle className="text-blue" />
                    </Tooltip>
                  ) : null}
                </div>
                {isFiltered && e.trackingKey && e.trackingKey !== e.name && (
                  <span
                    className="testid"
                    title="Experiment Id"
                    style={{
                      fontSize: "var(--font-size-1)",
                      color: "var(--gray-10)",
                    }}
                  >
                    {e.trackingKey}
                  </span>
                )}
              </div>
            </Link>
          </TableCell>
        );
      case "project":
        return (
          <TableCell>
            {e.projectIsDeReferenced ? (
              <Tooltip
                flipTheme={false}
                usePortal
                body={
                  <>
                    Project <code>{e.project}</code> not found
                  </>
                }
              >
                <span className="text-danger">Invalid project</span>
              </Tooltip>
            ) : (
              (e.projectName ?? <em>None</em>)
            )}
          </TableCell>
        );
      case "tags":
        return (
          <TableCell>
            <SortedTags
              tags={Object.values(e.tags)}
              useFlex={true}
              {...tagLinkProps("experiments")}
              onTagClick={tagFilterOnClick(searchValue, setSearchValue)}
            />
          </TableCell>
        );
      case "owner":
        return <TableCell>{e.ownerName ?? <em>None</em>}</TableCell>;
      case "date":
        return (
          <TableCell title={datetime(e.date)}>
            {e.tab === "running"
              ? "started"
              : e.tab === "drafts"
                ? "created"
                : e.tab === "stopped"
                  ? "ended"
                  : e.tab === "archived"
                    ? "updated"
                    : ""}{" "}
            {date(e.date)}
          </TableCell>
        );
      case "status":
        return (
          <TableCell>
            {e.statusIndicator.tooltip && !e.statusIndicator.detailedStatus ? (
              <Tooltip
                flipTheme={false}
                usePortal
                body={e.statusIndicator.tooltip}
              >
                {e.statusIndicator.status}
              </Tooltip>
            ) : (
              e.statusIndicator.status
            )}
          </TableCell>
        );
      case "result":
        return (
          <TableCell>
            {getHealthStateFromDetailedStatus(
              e.statusIndicator.detailedStatus,
            ) ? null : (
              <ExperimentStatusDetailsWithDot
                statusIndicatorData={e.statusIndicator}
              />
            )}
          </TableCell>
        );
      case "health":
        return (
          <TableCell style={{ whiteSpace: "nowrap" }}>
            {isTempRolloutHealthState(e.healthState) ? (
              <UITooltip content={getTempRolloutTooltip(e)}>
                <Flex gap="1" align="center">
                  <ExperimentDot
                    color={TEMP_ROLLOUT_HEALTH[e.healthState].color}
                  />
                  {EXPERIMENT_HEALTH_STATE_LABELS[e.healthState]}
                </Flex>
              </UITooltip>
            ) : e.healthState ? (
              <ExperimentStatusDetailsWithDot
                statusIndicatorData={e.statusIndicator}
              />
            ) : null}
          </TableCell>
        );
    }
  };
  // In the column state's order when resizable (the column settings can
  // reorder), otherwise the table's own.
  const columns = (
    resizable ? tableColumns.columns.map((col) => col.id as ColumnKey) : order
  ).filter(
    (column) =>
      shownColumns[column] &&
      (!resizable || resolvedById.get(column)?.visible !== false),
  );

  // With resizable columns: the table's floor is what the shown columns
  // take (Experiment its minimum), so the slack column can't be squeezed
  // to nothing.
  const resizableMinWidth = columns.reduce((sum, column) => {
    const col = resolvedById.get(column);
    if (!col) return sum;
    return sum + (col.width ?? columnWidthBounds(col).min);
  }, 0);
  const renderResizeHandle = (column: ColumnKey) => {
    const col = resolvedById.get(column);
    if (!resizable || !col || col.resizable === false) return null;
    const { min, max } = columnWidthBounds(col);
    return (
      <ColumnResizeHandle
        label={col.label}
        width={col.width}
        minWidth={min}
        maxWidth={max}
        onCommit={(w) => tableColumns.setWidth(col.id, w)}
        setLiveWidth={(w) => {
          const el = tableColumns.colRefs.current.get(col.id);
          if (!el) return;
          el.style.width = `${w}px`;
          // Move the floor with the drag, or Experiment squeezes mid-drag
          // and snaps back on release (as the attributes page).
          const committed = col.width ?? min;
          el.closest<HTMLElement>("[data-table-list]")?.style.setProperty(
            "--table-min-width",
            `${resizableMinWidth - committed + w}px`,
          );
        }}
      />
    );
  };

  return (
    <>
      <Table
        variant="list"
        stickyHeader
        roundedCorners
        layout={fixedColumns || resizable ? "fixed" : undefined}
        minTableWidth={resizable ? resizableMinWidth : undefined}
      >
        {/* The columns' widths, for the shown columns only (a tab can hide
          some); under a fixed layout these are what size them. */}
        {resizable ? (
          <colgroup>
            {columns.map((column) => {
              const width = resolvedById.get(column)?.width;
              return (
                <col
                  key={column}
                  ref={(el) => {
                    tableColumns.colRefs.current.set(column, el);
                  }}
                  style={width ? { width } : undefined}
                />
              );
            })}
          </colgroup>
        ) : null}
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <Fragment key={column}>
                {renderHeader(column, renderResizeHandle(column))}
              </Fragment>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((e) => (
            <TableRow key={e.id} ref={rowRef(e.id)}>
              {columns.map((column) => (
                <Fragment key={column}>{renderCell(column, e)}</Fragment>
              ))}
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center">
                {isFiltered
                  ? "No experiments match the current filter."
                  : "No experiments found."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {filtered.length > NUM_PER_PAGE && (
        <Pagination
          numItemsTotal={filtered.length}
          currentPage={currentPage}
          perPage={NUM_PER_PAGE}
          onPageChange={setCurrentPage}
        />
      )}
    </>
  );
};

export default ExperimentsListTable;
