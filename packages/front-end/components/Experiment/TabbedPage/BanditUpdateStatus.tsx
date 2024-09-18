import React from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { BanditEvent } from "back-end/src/validators/experiments";
import { ago, datetime, getValidDate } from "shared/dates";
import { upperFirst } from "lodash";
import Dropdown from "@/components/Dropdown/Dropdown";
import RefreshBanditButton from "@/components/Experiment/RefreshBanditButton";

export default function BanditUpdateStatus({
  experiment,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}) {
  const phase = experiment.phases?.[experiment.phases.length - 1];

  const lastEvent: BanditEvent | undefined =
    phase?.banditEvents?.[(phase?.banditEvents?.length ?? 0) - 1];
  const updateType = lastEvent?.banditResult?.reweight ? "reweight" : "refresh";

  let lastReweightEvent: BanditEvent | undefined = undefined;
  if (updateType === "refresh") {
    for (let i = phase?.banditEvents?.length || 0; i >= 0; i--) {
      const event = phase?.banditEvents?.[i];
      if (event?.banditResult?.reweight) {
        lastReweightEvent = event;
        break;
      }
    }
  }

  const start = getValidDate(
    experiment?.banditStageDateStarted ?? phase?.dateStarted
  ).getTime();
  const burnInHoursMultiple = experiment.banditBurnInUnit === "days" ? 24 : 1;
  const burnInRunDate = getValidDate(
    start +
      (experiment?.banditBurnInValue ?? 0) *
        burnInHoursMultiple *
        60 *
        60 *
        1000
  );

  return (
    <div className="hover-highlight rounded">
      <Dropdown
        uuid="bandit-update-status"
        toggle={
          <div
            className="d-inline-block text-muted text-right mr-1 user-select-none"
            style={{ maxWidth: 130, fontSize: "0.8em" }}
          >
            <div className="font-weight-bold" style={{ lineHeight: 1.2 }}>
              last updated
            </div>
            <div className="d-flex align-items-center">
              <div
                style={{ lineHeight: 1 }}
                title={datetime(lastEvent?.date ?? "")}
              >
                {ago(lastEvent?.date ?? "")}
              </div>
            </div>
          </div>
        }
        toggleClassName="p-1 rounded"
      >
        <div className="px-2 py-1" style={{ minWidth: 320 }}>
          <table className="table-tiny mb-3">
            <tbody>
              <tr>
                <td className="text-muted">Last updated at:</td>
                <td className="nowrap">{datetime(lastEvent?.date ?? "")}</td>
              </tr>
              {lastReweightEvent ? (
                <>
                  <tr>
                    <td className="text-muted">Update type:</td>
                    <td className="nowrap">{upperFirst(updateType)}</td>
                  </tr>
                  <tr>
                    <td className="text-muted">Last weights updated:</td>
                    <td className="nowrap">
                      {datetime(lastReweightEvent?.date ?? "")}
                    </td>
                  </tr>
                </>
              ) : null}
              {["explore", "exploit"].includes(
                experiment.banditStage ?? ""
              ) && (
                <tr>
                  <td className="text-muted">Next scheduled update:</td>
                  <td>
                    {experiment.nextSnapshotAttempt &&
                    experiment.autoSnapshots ? (
                      ago(experiment.nextSnapshotAttempt)
                    ) : (
                      <em>Not scheduled</em>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
            <tbody>
              <tr>
                <td className="text-muted">Current schedule:</td>
                <td>
                  every {experiment.banditScheduleValue ?? ""}{" "}
                  {experiment.banditScheduleUnit ?? ""}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="mx-2" style={{ fontSize: "12px" }}>
            <p>
              The bandit is{" "}
              {experiment.banditStage ? (
                <>
                  in the <strong>{upperFirst(experiment.banditStage)}</strong>{" "}
                  stage
                </>
              ) : (
                "not running"
              )}
              {experiment.banditStage === "explore" && (
                <> and is waiting until more data is collected</>
              )}
              .
            </p>

            {experiment.banditStage === "explore" && (
              <p>
                {" "}
                It will start updating weights and enter the Exploit stage on{" "}
                <em className="nowrap">{datetime(burnInRunDate)}</em> (
                {ago(burnInRunDate)}).
              </p>
            )}

            {experiment.banditStage === "exploit" &&
            experiment.autoSnapshots &&
            experiment.nextSnapshotAttempt ? (
              <p>
                The next update is scheduled for{" "}
                <em className="nowrap">
                  {datetime(experiment.nextSnapshotAttempt)}
                </em>{" "}
                ({ago(experiment.nextSnapshotAttempt)}).
              </p>
            ) : null}
          </div>

          <hr />
          <RefreshBanditButton mutate={mutate} experiment={experiment} />
        </div>
      </Dropdown>
    </div>
  );
}
