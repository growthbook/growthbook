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
import { getVariationsForPhase } from "shared/experiments";
import { phaseSummary } from "@/services/utils";
import { useExperimentSearch } from "@/services/experiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ExperimentStatusDetailsWithDot } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import SortedTags from "@/components/Tags/SortedTags";

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
  const { items, SortableTH } = useExperimentSearch({
    allExperiments: experiments,
    filterResults,
  });

  if (as === "table") {
    // create a sortable table with the following columns: experiment name, project, type, tags, date started, owner, status
    return (
      <table className="table experiment-table gbtable">
        <thead>
          <tr>
            <SortableTH field="name">Experiment</SortableTH>
            <SortableTH field="projectName">Project</SortableTH>
            <th>Type</th>
            <th>Tags</th>
            <SortableTH field="date">Date Started</SortableTH>
            <SortableTH field="ownerName">Owner</SortableTH>
            <SortableTH field="status">Status</SortableTH>
          </tr>
        </thead>
        <tbody>
          {items.slice(0, num).map((test, i) => {
            const currentPhase = test.phases[test.phases.length - 1];
            return (
              <tr key={i}>
                <td>
                  <Link href={`/experiment/${test.id}`}>{test.name}</Link>
                </td>
                <td>{test.projectName}</td>
                <td>
                  <Flex gap="1" align="center">
                    {test.hasVisualChangesets ? (
                      <Tooltip
                        className="d-flex align-items-center"
                        body="Visual experiment"
                      >
                        <RxDesktop className="text-blue" />
                      </Tooltip>
                    ) : null}
                    {(test.linkedFeatures || []).length > 0 ? (
                      <Tooltip
                        className="d-flex align-items-center"
                        body="Linked Feature Flag"
                      >
                        <BsFlag className="text-blue" />
                      </Tooltip>
                    ) : null}
                    {test.hasURLRedirects ? (
                      <Tooltip
                        className="d-flex align-items-center"
                        body="URL Redirect experiment"
                      >
                        <PiShuffle className="text-blue" />
                      </Tooltip>
                    ) : null}
                  </Flex>
                </td>
                <td>
                  <SortedTags tags={Object.values(test.tags)} useFlex={true} />
                </td>
                <td title={datetime(test.date)}>{date(test.date)}</td>
                <td>{test.ownerName}</td>
                <td className="text-nowrap">
                  {phaseSummary(
                    currentPhase,
                    test.type === "multi-armed-bandit",
                  )}
                  <ExperimentStatusDetailsWithDot
                    statusIndicatorData={test.statusIndicator}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
                      {currentPhase?.name} (
                      {getVariationsForPhase(test, currentPhase).length}{" "}
                      variations)
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
