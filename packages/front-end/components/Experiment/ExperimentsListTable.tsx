import React, { FC, useEffect, useState } from "react";
import Link from "next/link";
import { RxDesktop } from "react-icons/rx";
import { BsFlag } from "react-icons/bs";
import { PiShuffle } from "react-icons/pi";
import { ComputedExperimentInterface } from "shared/types/experiment";
import { date, datetime } from "shared/dates";
import Tooltip from "@/components/Tooltip/Tooltip";
import WatchButton from "@/components/WatchButton";
import SortedTags from "@/components/Tags/SortedTags";
import { ExperimentStatusDetailsWithDot } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Pagination from "@/ui/Pagination";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

const HEADER_HEIGHT_PX = 55;

interface ExperimentsListTableProps {
  tab: string;
  SortableTableColumnHeader: FC<{
    field: string;
    className?: string;
    children: React.ReactNode;
    style?: React.CSSProperties;
  }>;
  filtered: Array<ComputedExperimentInterface>;
  isFiltered: boolean;
  project?: string | null;
}

const ExperimentsListTable: React.FC<ExperimentsListTableProps> = ({
  tab,
  SortableTableColumnHeader,
  filtered,
  isFiltered,
  project,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const NUM_PER_PAGE = 20;
  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  const needsStatusColumn = tab === "all" || tab === "running";
  const needsResultColumn =
    tab === "stopped" || tab === "running" || tab === "all";
  // If "All Projects" is selected and some experiments are in a project, show the project column
  const showProjectColumn = !project && filtered.some((e) => e.project);

  // Reset to page 1 when a filter is applied or tabs change
  useEffect(() => {
    setCurrentPage(1);
  }, [filtered.length]);

  const colSpan =
    5 +
    (showProjectColumn ? 1 : 0) +
    (needsStatusColumn && needsResultColumn
      ? 2
      : needsStatusColumn || needsResultColumn
        ? 1
        : 0);

  return (
    <>
      <Table
        variant="list"
        stickyHeader
        stickyTopOffset={HEADER_HEIGHT_PX}
        roundedCorners
      >
        <TableHeader>
          <TableRow>
            <TableColumnHeader style={{ width: 40 }} />
            <SortableTableColumnHeader field="name" style={{ maxWidth: 320 }}>
              Experiment
            </SortableTableColumnHeader>
            {showProjectColumn && (
              <SortableTableColumnHeader field="projectName">
                Project
              </SortableTableColumnHeader>
            )}
            <SortableTableColumnHeader field="tags">
              Tags
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="ownerName">
              Owner
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="date">
              Date
            </SortableTableColumnHeader>
            {needsStatusColumn && needsResultColumn ? (
              <>
                <SortableTableColumnHeader field="statusSortOrder">
                  Status
                </SortableTableColumnHeader>
                <TableColumnHeader></TableColumnHeader>
              </>
            ) : needsStatusColumn || needsResultColumn ? (
              <SortableTableColumnHeader field="statusSortOrder">
                Status
              </SortableTableColumnHeader>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.slice(start, end).map((e) => (
            <TableRow key={e.id}>
              <TableCell className="watching">
                <WatchButton item={e.id} itemType="experiment" type="icon" />
              </TableCell>
              <TableCell className="p-0">
                <Link href={`/experiment/${e.id}`} className="d-block p-2">
                  <div className="d-flex flex-column">
                    <div className="d-flex align-items-center">
                      <span className="testname">{e.name}</span>
                      {e.hasVisualChangesets ? (
                        <Tooltip
                          className="d-flex align-items-center ml-2"
                          body="Visual experiment"
                        >
                          <RxDesktop className="text-blue" />
                        </Tooltip>
                      ) : null}
                      {(e.linkedFeatures || []).length > 0 ? (
                        <Tooltip
                          className="d-flex align-items-center ml-2"
                          body="Linked Feature Flag"
                        >
                          <BsFlag className="text-blue" />
                        </Tooltip>
                      ) : null}
                      {e.hasURLRedirects ? (
                        <Tooltip
                          className="d-flex align-items-center ml-2"
                          body="URL Redirect experiment"
                        >
                          <PiShuffle className="text-blue" />
                        </Tooltip>
                      ) : null}
                    </div>
                    {isFiltered && e.trackingKey && (
                      <span
                        className="testid text-muted small"
                        title="Experiment Id"
                      >
                        {e.trackingKey}
                      </span>
                    )}
                  </div>
                </Link>
              </TableCell>
              {showProjectColumn && (
                <TableCell>
                  {e.projectIsDeReferenced ? (
                    <Tooltip
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
              )}
              <TableCell>
                <SortedTags tags={Object.values(e.tags)} useFlex={true} />
              </TableCell>
              <TableCell>{e.ownerName ?? <em>None</em>}</TableCell>
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
              {needsStatusColumn ? (
                <TableCell>
                  {e.statusIndicator.tooltip &&
                  !e.statusIndicator.detailedStatus ? (
                    <Tooltip body={e.statusIndicator.tooltip}>
                      {e.statusIndicator.status}
                    </Tooltip>
                  ) : (
                    e.statusIndicator.status
                  )}
                </TableCell>
              ) : null}
              {needsResultColumn ? (
                <TableCell>
                  <ExperimentStatusDetailsWithDot
                    statusIndicatorData={e.statusIndicator}
                  />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={colSpan} className="text-center">
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
