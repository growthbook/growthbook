import Link from "next/link";
import React, { useCallback } from "react";
import {
  ComputedExperimentInterface,
  ExperimentInterfaceStringDates,
  ExperimentStatus,
} from "shared/types/experiment";
import { ago, date, datetime, getValidDate } from "shared/dates";
import { RxDesktop } from "react-icons/rx";
import { BsFlag } from "react-icons/bs";
import { PiShuffle } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { phaseSummary } from "@/services/utils";
import { useExperimentSearch } from "@/services/experiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ExperimentStatusDetailsWithDot } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import SortedTags from "@/components/Tags/SortedTags";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

export default function ExperimentList({
  num,
  status,
  experiments,
  as = "list",
}: {
  num: number;
  status: ExperimentStatus;
  experiments: ExperimentInterfaceStringDates[];
  as?: "list" | "table";
}): React.ReactElement {
  const filterResults = useCallback(
    (items: ComputedExperimentInterface[]) => {
      // filter to only those experiments that match the status
      if (!items || !items.length) return [];
      items = items.filter((e) => e.status === status);
      // remove any archived experiments
      items = items.filter((e) => !e.archived);
      return items;
    },
    [status],
  );
  const { items, SortableTableColumnHeader } = useExperimentSearch({
    allExperiments: experiments,
    filterResults,
  });

  if (as === "table") {
    // create a sortable table with the following columns: experiment name, project, type, tags, date started, owner, status
    return (
      <Table variant="list" stickyHeader={false} roundedCorners>
        <TableHeader>
          <TableRow>
            <SortableTableColumnHeader field="name">
              Experiment
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="projectName">
              Project
            </SortableTableColumnHeader>
            <TableColumnHeader>Type</TableColumnHeader>
            <TableColumnHeader>Tags</TableColumnHeader>
            <SortableTableColumnHeader field="date">
              Date Started
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="ownerName">
              Owner
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="status">
              Status
            </SortableTableColumnHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.slice(0, num).map((test, i) => {
            const currentPhase = test.phases[test.phases.length - 1];
            return (
              <TableRow key={i}>
                <TableCell>
                  <Link href={`/experiment/${test.id}`}>{test.name}</Link>
                </TableCell>
                <TableCell>{test.projectName}</TableCell>
                <TableCell>
                  <Flex gap="1" align="center">
                    {test.hasVisualChangesets ? (
                      <Tooltip body="Visual experiment">
                        <RxDesktop className="text-blue" />
                      </Tooltip>
                    ) : null}
                    {(test.linkedFeatures || []).length > 0 ? (
                      <Tooltip body="Linked Feature Flag">
                        <BsFlag className="text-blue" />
                      </Tooltip>
                    ) : null}
                    {test.hasURLRedirects ? (
                      <Tooltip body="URL Redirect experiment">
                        <PiShuffle className="text-blue" />
                      </Tooltip>
                    ) : null}
                  </Flex>
                </TableCell>
                <TableCell>
                  <SortedTags tags={Object.values(test.tags)} useFlex={true} />
                </TableCell>
                <TableCell title={datetime(test.date)}>
                  {date(test.date)}
                </TableCell>
                <TableCell>{test.ownerName}</TableCell>
                <TableCell style={{ whiteSpace: "nowrap" }}>
                  {phaseSummary(
                    currentPhase,
                    test.type === "multi-armed-bandit",
                  )}
                  <ExperimentStatusDetailsWithDot
                    statusIndicatorData={test.statusIndicator}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  } else {
    let exps = experiments.filter((e) => e.status === status);
    if (!exps.length) {
      return <div>no {status} experiments</div>;
    }
    if (exps.length > num) {
      exps = exps.slice(0, num);
    }
    return (
      <ul className="list-unstyled simple-divider ">
        {exps.map((test, i) => {
          // get start and end dates by looking for min and max start dates of main and rollup phases
          let startDate = test.dateCreated,
            endDate;

          test.phases.forEach((p) => {
            if (
              !startDate ||
              getValidDate(p?.dateStarted ?? "") < getValidDate(startDate)
            ) {
              startDate = p.dateStarted ?? "";
            }
            if (
              !endDate ||
              getValidDate(p?.dateEnded ?? "") > getValidDate(endDate)
            )
              endDate = p.dateEnded;
          });
          const currentPhase = test.phases[test.phases.length - 1];
          return (
            <li key={i} className="w-100 px-1 hover-highlight">
              <div key={test.id} className="d-flex">
                <Link
                  href={`/experiment/${test.id}`}
                  className="w-100 no-link-color"
                >
                  <div className="d-flex w-100">
                    <div className="mb-1 mr-1">
                      <strong>{test.name}</strong>
                    </div>
                    <div style={{ flex: 1 }} />
                    <div className="">
                      <span className="purple-phase">
                        {phaseSummary(
                          currentPhase,
                          test.type === "multi-armed-bandit",
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="d-flex">
                    <div className="text-muted" title={datetime(startDate)}>
                      {ago(startDate)}
                    </div>
                    <div style={{ flex: 1 }} />
                    <div>
                      {" "}
                      {currentPhase?.name} ({test.variations.length} variations)
                    </div>
                  </div>
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
}
