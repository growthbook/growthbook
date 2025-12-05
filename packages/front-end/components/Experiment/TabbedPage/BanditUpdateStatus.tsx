import React, { useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { BanditEvent } from "shared/validators";
import { ago, datetime, getValidDate } from "shared/dates";
import { upperFirst } from "lodash";
import { FaExclamationTriangle } from "react-icons/fa";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import Dropdown from "@/components/Dropdown/Dropdown";
import RefreshBanditButton from "@/components/Experiment/RefreshBanditButton";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";

export default function BanditUpdateStatus({
  experiment,
  mutate,
  isPublic,
  ssrSnapshot,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutate?: () => void;
  isPublic?: boolean;
  ssrSnapshot?: ExperimentSnapshotInterface;
}) {
  const { latest: _latest } = useSnapshot();
  const latest = _latest ?? ssrSnapshot;
  const { status } = getQueryStatus(latest?.queries || [], latest?.error);

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
    experiment?.banditStageDateStarted ?? phase?.dateStarted,
  ).getTime();
  const burnInHoursMultiple = experiment.banditBurnInUnit === "days" ? 24 : 1;
  const burnInRunDate = getValidDate(
    start +
      (experiment?.banditBurnInValue ?? 0) *
        burnInHoursMultiple *
        60 *
        60 *
        1000,
  );

  const _error = !lastEvent?.banditResult
    ? "Bandit update failed"
    : lastEvent?.banditResult?.error;

  const [error, setError] = useState<string | undefined>(_error);
  const [generatedSnapshot, setGeneratedSnapshot] = useState<
    ExperimentSnapshotInterface | undefined
  >(undefined);

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
              {error && !isPublic ? (
                <FaExclamationTriangle
                  className="text-danger mr-1 mb-1"
                  size={14}
                />
              ) : null}
              last updated
            </div>
            <div className="d-flex align-items-center">
              <div
                style={{ lineHeight: 1 }}
                title={
                  (phase?.banditEvents?.length ?? 0) > 1
                    ? datetime(lastEvent?.date ?? "")
                    : "never"
                }
              >
                {(phase?.banditEvents?.length ?? 0) > 1 ? (
                  ago(lastEvent?.date ?? "")
                ) : (
                  <em>never</em>
                )}
              </div>
            </div>
          </div>
        }
        toggleClassName="p-1 rounded"
      >
        <div className="px-2 pb-1" style={{ minWidth: 330 }}>
          <table className="table-tiny mb-4">
            <tbody>
              <tr>
                <td colSpan={2} className="pt-2">
                  <span className="uppercase-title">Current update</span>
                </td>
              </tr>
              <tr>
                <td className="text-muted">Last updated at:</td>
                <td className="nowrap">
                  {(phase?.banditEvents?.length ?? 0) > 1 ? (
                    datetime(lastEvent?.date ?? "")
                  ) : (
                    <em>never</em>
                  )}
                </td>
              </tr>
              {lastReweightEvent ? (
                <tr>
                  <td className="text-muted">Last weights updated:</td>
                  <td className="nowrap">
                    {datetime(lastReweightEvent?.date ?? "")}
                  </td>
                </tr>
              ) : null}
              {experiment.status === "running" &&
                !isPublic &&
                ["explore", "exploit"].includes(
                  experiment.banditStage ?? "",
                ) && (
                  <>
                    <tr>
                      <td colSpan={2} className="pt-3">
                        <span className="uppercase-title">Scheduling</span>
                      </td>
                    </tr>
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
                  </>
                )}
            </tbody>
            {!isPublic && (
              <tbody>
                <tr>
                  <td className="text-muted">Current schedule:</td>
                  <td>
                    every {experiment.banditScheduleValue ?? ""}{" "}
                    {experiment.banditScheduleUnit ?? ""}
                  </td>
                </tr>
              </tbody>
            )}
          </table>

          <div className="mx-2" style={{ fontSize: "12px" }}>
            <p>
              The Bandit is{" "}
              {experiment.banditStage === "paused" ||
              experiment.status !== "running" ? (
                "not running"
              ) : experiment.banditStage ? (
                <>
                  in the{" "}
                  <strong>
                    {experiment.banditStage === "explore"
                      ? "Exploratory"
                      : upperFirst(experiment.banditStage)}
                  </strong>{" "}
                  stage
                </>
              ) : (
                "not running"
              )}
              {!isPublic &&
                experiment.status === "running" &&
                experiment.banditStage === "explore" && (
                  <> and is waiting until more data is collected</>
                )}
              .
            </p>

            {!isPublic &&
              experiment.status === "running" &&
              experiment.banditStage === "explore" && (
                <p>
                  {" "}
                  It will start updating weights and enter the Exploit stage on{" "}
                  <em className="nowrap">{datetime(burnInRunDate)}</em> (
                  {ago(burnInRunDate)}).
                </p>
              )}
          </div>

          {!isPublic && error ? (
            <div className="alert small alert-danger mx-2 px-1 pt-2 pb-1 row align-items-start">
              <div className="col">
                <FaExclamationTriangle className="mr-1" />
                {error}
              </div>
              {generatedSnapshot || latest ? (
                <div className="col-auto">
                  <ViewAsyncQueriesButton
                    queries={
                      (generatedSnapshot || latest)?.queries?.map(
                        (q) => q.query,
                      ) ?? []
                    }
                    error={(generatedSnapshot || latest)?.error}
                    status={status}
                    display={null}
                    color="link link-purple p-0 pb-1"
                    condensed={true}
                    hideQueryCount={true}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {!isPublic && experiment.status === "running" && mutate && (
            <>
              <hr className="mx-2" />
              <RefreshBanditButton
                mutate={mutate}
                experiment={experiment}
                setError={setError}
                setGeneratedSnapshot={setGeneratedSnapshot}
              />
            </>
          )}
        </div>
      </Dropdown>
    </div>
  );
}
