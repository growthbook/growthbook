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
import { tagFilterOnClick, tagLinkProps } from "@/services/search";
import { isHealthDetailedStatus } from "@/services/experiments";

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
  searchValue: string;
  setSearchValue: (value: string) => void;
  hrefBase?: string;
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
  // State column surfaces signals like "No data", "Unhealthy", or
  // "Temp Rollout" — things that need attention beyond the lifecycle status.
  const showHealthColumn = filtered.some((e) => e.healthStatus !== "");

  // Reset to page 1 when a filter is applied or tabs change
  useEffect(() => {
    setCurrentPage(1);
  }, [filtered.length]);

  const colSpan =
    5 +
    (showProjectColumn ? 1 : 0) +
    (needsStatusColumn ? 1 : 0) +
    (needsResultColumn ? 1 : 0) +
    (showHealthColumn ? 1 : 0);

  return (
    <>
      <Table variant="list" stickyHeader roundedCorners>
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
            {needsStatusColumn && (
              <SortableTableColumnHeader field="statusSortOrder">
                Status
              </SortableTableColumnHeader>
            )}
            {needsResultColumn && (
              <SortableTableColumnHeader field="statusSortOrder">
                Result
              </SortableTableColumnHeader>
            )}
            {showHealthColumn && (
              <SortableTableColumnHeader field="healthStatus">
                State
              </SortableTableColumnHeader>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.slice(start, end).map((e) => (
            <TableRow key={e.id}>
              <TableCell className="watching">
                <WatchButton item={e.id} itemType="experiment" type="icon" />
              </TableCell>
              <TableCell style={{ padding: "var(--space-0)" }}>
                <Link
                  href={`${hrefBase}/${e.id}`}
                  style={{
                    display: "block",
                    padding: "var(--space-3)",
                    color: "var(--gray-12)",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <span className="testname">{e.name}</span>
                      {e.hasVisualChangesets ? (
                        <Tooltip
                          flipTheme={false}
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
                    {isFiltered &&
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
              {showProjectColumn && (
                <TableCell>
                  {e.projectIsDeReferenced ? (
                    <Tooltip
                      flipTheme={false}
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
                <SortedTags
                  tags={Object.values(e.tags)}
                  useFlex={true}
                  {...tagLinkProps("experiments")}
                  onTagClick={tagFilterOnClick(searchValue, setSearchValue)}
                />
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
                    <Tooltip flipTheme={false} body={e.statusIndicator.tooltip}>
                      {e.statusIndicator.status}
                    </Tooltip>
                  ) : (
                    e.statusIndicator.status
                  )}
                </TableCell>
              ) : null}
              {needsResultColumn ? (
                <TableCell>
                  {isHealthDetailedStatus(
                    e.statusIndicator.detailedStatus,
                  ) ? null : (
                    <ExperimentStatusDetailsWithDot
                      statusIndicatorData={e.statusIndicator}
                    />
                  )}
                </TableCell>
              ) : null}
              {showHealthColumn ? (
                <TableCell style={{ whiteSpace: "nowrap" }}>
                  {isHealthDetailedStatus(e.statusIndicator.detailedStatus) ? (
                    <ExperimentStatusDetailsWithDot
                      statusIndicatorData={e.statusIndicator}
                    />
                  ) : e.hasTempRollout ? (
                    <Tooltip
                      flipTheme={false}
                      body="A stopped experiment is still serving its released variation. Ready for cleanup."
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span
                          aria-label="Temporary rollout"
                          style={{
                            display: "inline-block",
                            width: 8,
                            height: 8,
                            borderRadius: 8,
                            backgroundColor: "var(--orange-9)",
                          }}
                        />
                        Temp Rollout
                      </span>
                    </Tooltip>
                  ) : null}
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
