import React, { FC, useEffect, useState } from "react";
import Link from "next/link";
import { RxDesktop } from "react-icons/rx";
import { Flex } from "@radix-ui/themes";
import { BsFlag } from "react-icons/bs";
import { PiShuffle } from "react-icons/pi";
import { Trans, useLingui } from "@lingui/react/macro";
import { ComputedExperimentInterface } from "shared/types/experiment";
import { date, datetime } from "shared/dates";
import Tooltip from "@/components/Tooltip/Tooltip";
import WatchButton from "@/components/WatchButton";
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
import { useStatusIndicatorText } from "@/hooks/useExperimentStatusIndicator";
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
  const { t } = useLingui();
  const statusText = useStatusIndicatorText();
  const [currentPage, setCurrentPage] = useState(1);
  const NUM_PER_PAGE = 20;
  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  const needsStatusColumn = tab === "all" || tab === "running";
  const needsResultColumn =
    tab === "stopped" || tab === "running" || tab === "all";
  // If "All Projects" is selected and some experiments are in a project, show the project column
  const showProjectColumn = !project && filtered.some((e) => e.project);
  const showHealthColumn = filtered.some((e) => e.healthState !== null);

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
              <Trans>Experiment</Trans>
            </SortableTableColumnHeader>
            {showProjectColumn && (
              <SortableTableColumnHeader field="projectName">
                <Trans>Project</Trans>
              </SortableTableColumnHeader>
            )}
            <SortableTableColumnHeader field="tags">
              <Trans>Tags</Trans>
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="ownerName">
              <Trans>Owner</Trans>
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="date">
              <Trans>Date</Trans>
            </SortableTableColumnHeader>
            {needsStatusColumn && (
              <SortableTableColumnHeader field="statusSortOrder">
                <Trans>Status</Trans>
              </SortableTableColumnHeader>
            )}
            {needsResultColumn &&
              (needsStatusColumn ? (
                <TableColumnHeader>
                  <Trans>Result</Trans>
                </TableColumnHeader>
              ) : (
                <SortableTableColumnHeader field="statusSortOrder">
                  <Trans>Result</Trans>
                </SortableTableColumnHeader>
              ))}
            {showHealthColumn && (
              <SortableTableColumnHeader field="healthSortOrder">
                <Trans>Health</Trans>
              </SortableTableColumnHeader>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.slice(start, end).map((e) => {
            const projectId = e.project;
            const formattedDate = date(e.date);
            const shownStatus = statusText(e.statusIndicator);
            return (
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
                            body={t`Visual experiment`}
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
                            body={t`Linked Feature Flag`}
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
                            body={t`URL Redirect experiment`}
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
                            title={t`Experiment Id`}
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
                          <Trans>
                            Project <code>{projectId}</code> not found
                          </Trans>
                        }
                      >
                        <span className="text-danger">
                          <Trans>Invalid project</Trans>
                        </span>
                      </Tooltip>
                    ) : (
                      (e.projectName ?? (
                        <em>
                          <Trans>None</Trans>
                        </em>
                      ))
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
                <TableCell>
                  {e.ownerName ?? (
                    <em>
                      <Trans>None</Trans>
                    </em>
                  )}
                </TableCell>
                <TableCell title={datetime(e.date)}>
                  {e.tab === "running" ? (
                    <Trans>started {formattedDate}</Trans>
                  ) : e.tab === "drafts" ? (
                    <Trans>created {formattedDate}</Trans>
                  ) : e.tab === "stopped" ? (
                    <Trans>ended {formattedDate}</Trans>
                  ) : e.tab === "archived" ? (
                    <Trans>updated {formattedDate}</Trans>
                  ) : (
                    <> {formattedDate}</>
                  )}
                </TableCell>
                {needsStatusColumn ? (
                  <TableCell>
                    {shownStatus.tooltip &&
                    !e.statusIndicator.detailedStatus ? (
                      <Tooltip flipTheme={false} body={shownStatus.tooltip}>
                        {shownStatus.status}
                      </Tooltip>
                    ) : (
                      shownStatus.status
                    )}
                  </TableCell>
                ) : null}
                {needsResultColumn ? (
                  <TableCell>
                    {getHealthStateFromDetailedStatus(
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
                ) : null}
              </TableRow>
            );
          })}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={colSpan} className="text-center">
                {isFiltered ? (
                  <Trans>No experiments match the current filter.</Trans>
                ) : (
                  <Trans>No experiments found.</Trans>
                )}
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
