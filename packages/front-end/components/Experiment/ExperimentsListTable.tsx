import React, { FC, useEffect, useState } from "react";
import Link from "next/link";
import { RxDesktop } from "react-icons/rx";
import { BsFlag } from "react-icons/bs";
import { PiShuffle } from "react-icons/pi";
import { ComputedExperimentInterface } from "back-end/types/experiment";
import { date, datetime } from "shared/dates";
import Tooltip from "@/components/Tooltip/Tooltip";
import WatchButton from "@/components/WatchButton";
import SortedTags from "@/components/Tags/SortedTags";
import { ExperimentStatusDetailsWithDot } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Pagination from "@/components/Pagination";

interface ExperimentsListTableProps {
  tab: string;
  SortableTH: FC<{
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
  SortableTH,
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

  return (
    <>
      <table className="table gbtable responsive-table">
        <thead>
          <tr>
            <th></th>
            <SortableTH field="name" className="w-100">
              Experiment
            </SortableTH>
            {showProjectColumn && (
              <SortableTH field="projectName">Project</SortableTH>
            )}
            <SortableTH field="tags">Tags</SortableTH>
            <SortableTH field="ownerName">Owner</SortableTH>
            <SortableTH field="date">Date</SortableTH>
            {needsStatusColumn && needsResultColumn ? (
              <>
                <SortableTH field="statusSortOrder">Status</SortableTH>
                <th></th>
              </>
            ) : needsStatusColumn || needsResultColumn ? (
              <SortableTH field="statusSortOrder">Status</SortableTH>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {filtered.slice(start, end).map((e) => {
            return (
              <tr key={e.id} className="hover-highlight">
                <td data-title="Watching status:" className="watching">
                  <WatchButton item={e.id} itemType="experiment" type="icon" />
                </td>
                <td data-title="Experiment name:" className="p-0">
                  <Link href={`/experiment/${e.id}`} className="d-block p-2">
                    <div className="d-flex flex-column">
                      <div className="d-flex">
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
                </td>
                {showProjectColumn && (
                  <td className="nowrap" data-title="Project:">
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
                  </td>
                )}

                <td data-title="Tags:" className="table-tags">
                  <SortedTags tags={Object.values(e.tags)} useFlex={true} />
                </td>
                <td className="nowrap" data-title="Owner:">
                  {e.ownerName}
                </td>
                <td className="nowrap" title={datetime(e.date)}>
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
                </td>
                {needsStatusColumn ? (
                  <td className="nowrap" data-title="Status:">
                    {e.statusIndicator.tooltip &&
                    !e.statusIndicator.detailedStatus ? (
                      <Tooltip body={e.statusIndicator.tooltip}>
                        {e.statusIndicator.status}
                      </Tooltip>
                    ) : (
                      e.statusIndicator.status
                    )}
                  </td>
                ) : null}
                {needsResultColumn ? (
                  <td className="nowrap" data-title="Details:">
                    <ExperimentStatusDetailsWithDot
                      statusIndicatorData={e.statusIndicator}
                    />
                  </td>
                ) : null}
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={10} className="text-center">
                {isFiltered
                  ? "No experiments match the current filter."
                  : "No experiments found."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
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
