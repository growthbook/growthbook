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
import clsx from "clsx";
import Link from "next/link";
import { RxDesktop } from "react-icons/rx";
import { Flex } from "@radix-ui/themes";
import { BsFlag } from "react-icons/bs";
import { PiShuffle, PiXCircle } from "react-icons/pi";
import { ComputedExperimentInterface } from "shared/types/experiment";
import { date, datetime } from "shared/dates";
import Tooltip from "@/components/Tooltip/Tooltip";
import WatchButton from "@/components/WatchButton";
import EmptyState from "@/components/EmptyState";
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
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
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
import styles from "./ExperimentsListTable.module.scss";

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
  // With no rows: "row", a one-line row in the table (the default), or
  // "placeholder", a centred EmptyState in a tall row, the table's headers
  // and outline kept (set in review; see ExperimentsListTable.module.scss).
  emptyState?: "row" | "placeholder";
  // The pagination as the table's footer, inside its outline, with ghost
  // page buttons (set in review; see ExperimentsListTable.module.scss),
  // rather than a separate row of buttons below it.
  attachedFooter?: boolean;
  // Changing page plays the table entrance used for tabs and search (set in
  // review): the new page's rows fade in, drifting 8px from the side it's
  // coming from (from the right going to a later page).
  animatePages?: boolean;
  // The experiment's type (Feature Flag, Visual Change, URL Redirect) as its
  // own column, named rather than shown as icons on the name (set in
  // review). The icons come off the name.
  typeColumn?: boolean;
  // The Health column's status dots, in px (set in review: 6 on the
  // experiments list); 8 by default, as elsewhere.
  healthDotSize?: number;
  // The space between those dots and their labels (set in review: "2", 8px,
  // on the experiments list); "1", 4px, by default, as elsewhere.
  healthDotGap?: "1" | "2";
  // The name column's header (set in review: "Experiment Name" on the
  // experiments list); "Experiment" by default.
  nameHeader?: string;
  // Showing, hiding and reordering columns animate (set in review; the
  // experiments list). See animateColumns below.
  animateColumns?: boolean;
  // The same columns on every tab, search and filter (set in review). See
  // stableColumns below.
  stableColumns?: boolean;
  // Scrolls sideways when the columns are wider than the page, rather than
  // spilling off it (set in review). See scrollOnOverflow below.
  scrollOnOverflow?: boolean;
  // A toolbar (search, filters, table controls) drawn inside the table's
  // outline, as its top section (set in review; the experiments list).
  toolbar?: ReactNode;
  // Whether the tracking key shows under a name (when it differs from the
  // name). By default, while any search or filter is on (isFiltered); the
  // experiments list shows it only for typed search text (set in review),
  // since only a typed search can match on the key.
  showTrackingKey?: boolean;
}

// With resizableColumnsKey: each column's starting width in px, and the
// Experiment column's floor (it takes the rest). The starting widths add up
// to well under a laptop's content width, so the table fits until someone
// drags it wider; RESIZABLE_MAX_WIDTH caps how far one column can go.
const RESIZABLE_COLUMN_WIDTHS: Partial<Record<ColumnKey, number>> = {
  watch: 40,
  type: 140,
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
  showTypeColumn = false,
  hiddenLast = false,
}: {
  statusFirst?: boolean;
  hiddenColumns?: ("owner" | "date" | "result")[];
  showWatchColumn?: boolean;
  showTypeColumn?: boolean;
  // The columns that start hidden come after those that start shown, in
  // the default order (set in review; the experiments list), so the column
  // menu, which lists the table's order, has the shown ones first, and a
  // column turned on joins the table's end. Optional and additive.
  hiddenLast?: boolean;
}): TableColumnDef<ComputedExperimentInterface>[] {
  const startsHidden = (id: ColumnKey) =>
    id === "type" ||
    ((id === "owner" || id === "date" || id === "result") &&
      hiddenColumns.includes(id));
  const ids = (statusFirst ? STATUS_FIRST_ORDER : COLUMN_ORDER)
    .filter((id) => id !== "watch" || showWatchColumn)
    .filter((id) => id !== "type" || showTypeColumn);
  return (
    hiddenLast
      ? [
          ...ids.filter((id) => !startsHidden(id)),
          ...ids.filter((id) => startsHidden(id)),
        ]
      : ids
  ).map((id) => ({
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
          // Type starts hidden (set in review); the column settings
          // turn it on.
          defaultHidden: startsHidden(id),
        }),
  }));
}

const COLUMN_LABELS: Record<ColumnKey, string> = {
  watch: "Watch",
  name: "Experiment",
  type: "Type",
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
  | "type"
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
  "type",
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
  "type",
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
  type: "10%",
  project: "10%",
  tags: "14%",
  owner: "11%",
  date: "12%",
  status: "11%",
  result: "10%",
  health: "8%",
};
// Rows per page (set in review), as the Diagnostics prototype's
// StreamPagination offers; 20 as before by default.
const ROWS_PER_PAGE_OPTIONS = [10, 15, 20, 50, 100];
const DEFAULT_ROWS_PER_PAGE = 20;

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
  emptyState = "row",
  attachedFooter = false,
  animatePages = false,
  typeColumn = false,
  healthDotSize,
  healthDotGap = "1",
  nameHeader = "Experiment",
  animateColumns = false,
  stableColumns = false,
  scrollOnOverflow = false,
  toolbar,
  showTrackingKey,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  // Rows per page: 20, or with attachedFooter, the footer's selector (set in
  // review; as the Diagnostics prototype's StreamPagination).
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const NUM_PER_PAGE = attachedFooter ? rowsPerPage : DEFAULT_ROWS_PER_PAGE;
  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const visible = filtered.slice(start, end);
  const rowRef = useSortAnimation(
    animateSort,
    filtered,
    visible.map((e) => e.id),
  );

  // stableColumns (set in review; the experiments list): the columns don't
  // change with the tab, a search or filter, or the rows' data; only the
  // column settings decide. Otherwise Status shows on All and Running,
  // Result on All, Running and Stopped, and Project and Health only when a
  // row has one. Project still stays off with a single project selected.
  const needsStatusColumn = stableColumns || tab === "all" || tab === "running";
  // With resizable columns, the column state decides whether Owner, Date
  // and Result show (hiddenColumns only sets where they start), so they can
  // be turned back on from the column settings.
  const resizableColumns = !!resizableColumnsKey || !!tableColumnsProp;
  const needsResultColumn =
    (resizableColumns || !hiddenColumns.includes("result")) &&
    (stableColumns || tab === "stopped" || tab === "running" || tab === "all");
  const showOwnerColumn = resizableColumns || !hiddenColumns.includes("owner");
  const showDateColumn = resizableColumns || !hiddenColumns.includes("date");
  // If "All Projects" is selected and some experiments are in a project, show the project column
  const showProjectColumn =
    !project && (stableColumns || filtered.some((e) => e.project));
  const showHealthColumn =
    stableColumns || filtered.some((e) => e.healthState !== null);

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
        showTypeColumn: typeColumn,
      }),
    // hiddenColumns is a literal at each call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusFirst, hiddenColumns.join(","), showWatchColumn, typeColumn],
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
    type: typeColumn,
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
            {nameHeader}
          </SortableTableColumnHeader>
        );
      case "type":
        // Not sortable: an experiment can have several types, or none.
        return (
          <TableColumnHeader style={fixedWidth("type")}>
            Type
            {adornment}
          </TableColumnHeader>
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
                  {/* The type icons; with typeColumn, the Type column
                    names them instead (set in review). */}
                  {!typeColumn ? (
                    <>
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
                    </>
                  ) : null}
                </div>
                {(showTrackingKey ?? isFiltered) &&
                  e.trackingKey &&
                  e.trackingKey !== e.name && (
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
      case "type": {
        // The names the Type filter uses (experimentFilterCategories.ts),
        // comma-separated when there are several; empty when it has none
        // (set in review).
        const types = [
          ...((e.linkedFeatures || []).length > 0 ? ["Feature Flag"] : []),
          ...(e.hasVisualChangesets ? ["Visual Change"] : []),
          ...(e.hasURLRedirects ? ["URL Redirect"] : []),
        ];
        return <TableCell>{types.join(", ")}</TableCell>;
      }
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
                <Flex gap={healthDotGap} align="center">
                  <ExperimentDot
                    color={TEMP_ROLLOUT_HEALTH[e.healthState].color}
                    size={healthDotSize}
                  />
                  {EXPERIMENT_HEALTH_STATE_LABELS[e.healthState]}
                </Flex>
              </UITooltip>
            ) : e.healthState ? (
              <ExperimentStatusDetailsWithDot
                statusIndicatorData={e.statusIndicator}
                dotSize={healthDotSize}
                dotGap={healthDotGap}
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

  // animateColumns (set in review; the experiments list): a column that's
  // shown fades in; one that's hidden fades out, then the columns after it
  // slide over to close the gap; reordered columns slide to their new
  // places. The slides are FLIP: each column's header position is read just
  // before the change (here, while the DOM still has the old columns) and
  // its cells are moved back there and eased home. A hidden column stays
  // rendered (renderedColumns) until its fade ends. Instant for reduced
  // motion.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const columnsKey = columns.join(",");
  const [prevColumns, setPrevColumns] = useState(columns);
  // Counts column changes, so the effect below runs on each one: hiding a
  // column doesn't change renderedColumns at first (it stays to fade out).
  const [columnsChange, setColumnsChange] = useState(0);
  const [leavingColumns, setLeavingColumns] = useState<
    { column: ColumnKey; after: ColumnKey | null }[]
  >([]);
  const columnLefts = useRef<Map<ColumnKey, number> | null>(null);
  const enteringColumns = useRef<ColumnKey[]>([]);
  const renderedColumnsRef = useRef<ColumnKey[]>(columns);
  const measureColumnLefts = () => {
    const lefts = new Map<ColumnKey, number>();
    wrapperRef.current
      ?.querySelectorAll<HTMLElement>(".rt-TableHeader .rt-TableRow > *")
      .forEach((header, i) => {
        const column = renderedColumnsRef.current[i];
        if (column) lefts.set(column, header.getBoundingClientRect().left);
      });
    return lefts;
  };
  if (columnsKey !== prevColumns.join(",")) {
    const animate =
      animateColumns &&
      typeof window !== "undefined" &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (animate) {
      columnLefts.current = measureColumnLefts();
      enteringColumns.current = columns.filter((c) => !prevColumns.includes(c));
      setLeavingColumns(
        prevColumns
          .filter((c) => !columns.includes(c))
          .map((column) => ({
            column,
            // Kept after the nearest earlier column that's still shown.
            after:
              prevColumns
                .slice(0, prevColumns.indexOf(column))
                .reverse()
                .find((c) => columns.includes(c)) ?? null,
          })),
      );
    } else if (leavingColumns.length) {
      setLeavingColumns([]);
    }
    setPrevColumns(columns);
    setColumnsChange((n) => n + 1);
  }
  const renderedColumns = [...columns];
  leavingColumns
    .filter(({ column }) => !columns.includes(column))
    .forEach(({ column, after }) => {
      const i = after === null ? -1 : renderedColumns.indexOf(after);
      renderedColumns.splice(i + 1, 0, column);
    });
  const renderedKey = renderedColumns.join(",");
  useLayoutEffect(() => {
    const before = columnLefts.current;
    const entering = enteringColumns.current;
    columnLefts.current = null;
    enteringColumns.current = [];
    renderedColumnsRef.current = renderedColumns;
    const wrapper = wrapperRef.current;
    if (!before || !wrapper) return;
    // The header row and the body's rows (not the empty state's one cell).
    const rows = Array.from(
      wrapper.querySelectorAll(
        ".rt-TableHeader .rt-TableRow, .rt-TableBody .rt-TableRow",
      ),
    ).filter((row) => row.children.length === renderedColumns.length);
    const leaving = leavingColumns.map(({ column }) => column);
    const fadeOuts: Animation[] = [];
    renderedColumns.forEach((column, i) => {
      const cells = rows
        .map((row) => row.children[i] as HTMLElement)
        .filter((cell) => typeof cell?.animate === "function");
      if (!cells.length) return;
      if (leaving.includes(column)) {
        cells.forEach((cell) =>
          fadeOuts.push(
            cell.animate([{ opacity: 1 }, { opacity: 0 }], {
              duration: 120,
              easing: "ease-out",
              fill: "forwards",
            }),
          ),
        );
      } else if (entering.includes(column)) {
        cells.forEach((cell) => {
          // Shown again mid-fade-out: drop that fade, which would otherwise
          // hold it at 0 once this one ends.
          cell.getAnimations().forEach((a) => a.cancel());
          cell.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 220,
            easing: "ease-out",
          });
        });
      } else {
        const old = before.get(column);
        const dx =
          old === undefined ? 0 : old - cells[0].getBoundingClientRect().left;
        if (Math.abs(dx) < 1) return;
        cells.forEach((cell) =>
          cell.animate(
            [{ transform: `translateX(${dx}px)` }, { transform: "none" }],
            { duration: 240, easing: SORT_EASE_OUT },
          ),
        );
      }
    });
    // Once a hidden column has faded, it's removed, and the columns after
    // it slide over (this effect again, with fresh positions).
    if (fadeOuts.length) {
      fadeOuts[0].onfinish = () => {
        columnLefts.current = measureColumnLefts();
        setLeavingColumns([]);
      };
    }
    // Runs when the rendered columns change; the rest is read fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedKey, columnsChange]);

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

  // With attachedFooter, the footer shows whenever there are rows (it holds
  // the rows-per-page selector, needed even when they fit on one page);
  // otherwise, as before, only when there's more than one page.
  const hasFooter = attachedFooter
    ? filtered.length > 0
    : filtered.length > NUM_PER_PAGE;

  // animatePages: which way the last page change went, and the wrapper to
  // find the table body in (TableBody takes no ref). Only the rows move;
  // the headers, outline and footer stay put. Instant for reduced motion.
  const pageDirection = useRef<1 | -1 | null>(null);
  const changePage = (page: number) => {
    pageDirection.current = page > currentPage ? 1 : -1;
    setCurrentPage(page);
  };
  // scrollOnOverflow: while the table is wider than its space (columns added
  // past the page's width), it scrolls sideways. Only then: a scroll box
  // can't let the header stick to the page as it scrolls down, so the
  // header stays in place in that case only.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tableOverflows, setTableOverflows] = useState(false);
  useEffect(() => {
    const box = scrollRef.current;
    const table = box?.querySelector("table");
    if (!scrollOnOverflow || !box || !table) return;
    const check = () =>
      setTableOverflows(table.offsetWidth > box.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(box);
    observer.observe(table);
    return () => observer.disconnect();
  }, [scrollOnOverflow]);

  useLayoutEffect(() => {
    const direction = pageDirection.current;
    pageDirection.current = null;
    if (!animatePages || direction === null) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const body =
      wrapperRef.current?.querySelector<HTMLElement>(".rt-TableBody");
    if (!body || typeof body.animate !== "function") return;
    body.animate(
      [
        { opacity: 0, transform: `translateX(${direction * 8}px)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: 260, easing: SORT_EASE_OUT },
    );
  }, [currentPage, animatePages]);

  return (
    <div
      ref={wrapperRef}
      className={clsx(
        attachedFooter && hasFooter && styles.withFooter,
        toolbar && styles.withToolbar,
      )}
    >
      {toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
      <div
        ref={scrollRef}
        className={tableOverflows ? styles.scrollX : undefined}
      >
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
              {renderedColumns.map((column) => {
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
              {renderedColumns.map((column) => (
                <Fragment key={column}>
                  {renderHeader(column, renderResizeHandle(column))}
                </Fragment>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((e) => (
              <TableRow key={e.id} ref={rowRef(e.id)}>
                {renderedColumns.map((column) => (
                  <Fragment key={column}>{renderCell(column, e)}</Fragment>
                ))}
              </TableRow>
            ))}
            {filtered.length === 0 &&
              (emptyState === "placeholder" ? (
                // The table stays, headers and outline, holding its height;
                // one row across it carries the message (set in review).
                <TableRow data-no-hover>
                  <TableCell
                    colSpan={renderedColumns.length}
                    className={styles.emptyCell}
                  >
                    <div className={styles.emptyPlaceholder}>
                      <EmptyState
                        // A circled X (set in review; a plain X was tried), for "none", the same whether a search or
                        // filter left no results or the tab is empty (set in
                        // review; tried a flask, and a magnifying glass for the
                        // filtered case, which echoed the search field), 24px
                        // (tried 32px). Regular
                        // weight, as the toolbar's icons; --slate-10 (tried
                        // --slate-9) is 3.78:1 on white, above the 3:1 asked of
                        // icons.
                        icon={
                          <PiXCircle
                            size={24}
                            style={{ color: "var(--slate-10)" }}
                          />
                        }
                        title="No experiments found"
                        description={
                          isFiltered
                            ? "Try a different search or filter, or clear them to see every experiment"
                            : "There are no experiments in this tab"
                        }
                        leftButton={null}
                        rightButton={null}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={renderedColumns.length}
                    className="text-center"
                  >
                    {isFiltered
                      ? "No experiments match the current filter."
                      : "No experiments found."}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
      {hasFooter &&
        (attachedFooter ? (
          // The footer (set in review), as the Diagnostics prototype's:
          // rows per page on the left, the page buttons on the right.
          // Changing the page size goes back to page 1.
          <div className={styles.footer}>
            <Flex gap="2" align="center">
              {/* --gray-11, the unselected page numbers' colour (set in
                review), on a wrapper Text inherits from (it takes only its
                preset colours). */}
              <span style={{ color: "var(--gray-11)" }}>
                <Text size="sm">Rows per page</Text>
              </span>
              <Select
                size="sm"
                // The list's menu shadow (see .menuShadow), and a neutral
                // hovered option (set in review; see .rowsPerPageMenu).
                contentClassName={clsx(
                  styles.menuShadow,
                  styles.rowsPerPageMenu,
                )}
                value={String(rowsPerPage)}
                setValue={(v) => {
                  setRowsPerPage(Number(v));
                  setCurrentPage(1);
                }}
              >
                {ROWS_PER_PAGE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {String(n)}
                  </SelectItem>
                ))}
              </Select>
              {/* A small divider between the select and the count (set in
                review): 1px by 24px, the select's height (set in review; tried
                16px, the text line), in --gray-a5 (set in review; tried
                --gray-a4, the table's other frame dividers' shade), 16px
                either side (set in review; tried 8px and 12px): the row's 8px
                gap plus 8px of its own. */}
              <span
                aria-hidden
                style={{
                  width: 1,
                  height: 24,
                  margin: "0 var(--space-2)",
                  backgroundColor: "var(--gray-a5)",
                }}
              />
              {/* The rows on this page out of the total, "15 of 130", both
                counts of rows, so neither reads as a page number (set in
                review; tried "Showing 20 of 130" and "of 130"). In --gray-10,
                a shade lighter than the label (set in review). NB: 3.8:1 on
                white, below WCAG AA's 4.5:1 for text this size. */}
              <span style={{ color: "var(--gray-10)" }}>
                <Text size="sm" whiteSpace="nowrap">
                  {`${visible.length} of ${filtered.length}`}
                </Text>
              </span>
            </Flex>
            <Pagination
              numItemsTotal={filtered.length}
              currentPage={currentPage}
              perPage={NUM_PER_PAGE}
              onPageChange={changePage}
            />
          </div>
        ) : (
          <Pagination
            numItemsTotal={filtered.length}
            currentPage={currentPage}
            perPage={NUM_PER_PAGE}
            onPageChange={changePage}
          />
        ))}
    </div>
  );
};

export default ExperimentsListTable;
