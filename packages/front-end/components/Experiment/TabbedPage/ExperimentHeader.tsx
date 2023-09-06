import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import Link from "next/link";
import { FaHome, FaUsers } from "react-icons/fa";
import { PiChartBarHorizontalFill } from "react-icons/pi";
import { useRouter } from "next/router";
import { getAffectedEnvsForExperiment } from "shared/util";
import React, { useMemo, useState } from "react";
import { date, daysBetween } from "shared/dates";
import { MdRocketLaunch } from "react-icons/md";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import clsx from "clsx";
import { useAuth } from "@/services/auth";
import { GBCircleArrowLeft } from "@/components/Icons";
import WatchButton from "@/components/WatchButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import TabButtons from "@/components/Tabs/TabButtons";
import TabButton from "@/components/Tabs/TabButton";
import usePermissions from "@/hooks/usePermissions";
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import Modal from "@/components/Modal";
import Dropdown from "@/components/Dropdown/Dropdown";
import DropdownLink from "@/components/Dropdown/DropdownLink";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useScrollPosition } from "@/hooks/useScrollPosition";
import ResultsIndicator from "../ResultsIndicator";
import { useSnapshot } from "../SnapshotProvider";
import { StartExperimentBanner } from "../StartExperimentBanner";
import ExperimentStatusIndicator from "./ExperimentStatusIndicator";
import OverflowText from "./OverflowText";
import StopExperimentButton from "./StopExperimentButton";
import { ExperimentTab, LinkedFeature } from ".";

export interface Props {
  tab: ExperimentTab;
  setTab: (tab: ExperimentTab) => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  duplicate?: (() => void) | null;
  setEditNameOpen: (open: boolean) => void;
  setStatusModal: (open: boolean) => void;
  setAuditModal: (open: boolean) => void;
  setWatchersModal: (open: boolean) => void;
  editResult?: () => void;
  safeToEdit: boolean;
  usersWatching: (string | undefined)[];
  linkedFeatures: LinkedFeature[];
  visualChangesets: VisualChangesetInterface[];
  connections: SDKConnectionInterface[];
  newPhase?: (() => void) | null;
  editTargeting?: (() => void) | null;
  editPhases?: (() => void) | null;
}

const shortNumberFormatter = Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function PhaseDateSummary({ phase }: { phase?: ExperimentPhaseStringDates }) {
  const startDate = phase && phase.dateStarted ? date(phase.dateStarted) : null;
  const endDate = phase && phase.dateEnded ? date(phase.dateEnded) : null;

  if (!startDate) return null;

  return (
    <span>
      {startDate} — {endDate || "now"}
      <span className="ml-2">
        ({daysBetween(startDate, endDate || new Date())} days)
      </span>
    </span>
  );
}

export default function ExperimentHeader({
  tab,
  setTab,
  experiment,
  mutate,
  setEditNameOpen,
  duplicate,
  setAuditModal,
  setStatusModal,
  setWatchersModal,
  safeToEdit,
  usersWatching,
  editResult,
  connections,
  linkedFeatures,
  visualChangesets,
  editTargeting,
  newPhase,
  editPhases,
}: Props) {
  const { apiCall } = useAuth();
  const router = useRouter();
  const permissions = usePermissions();
  const { scrollY } = useScrollPosition();
  const headerPinned = scrollY > 70;

  const { phase, setPhase } = useSnapshot();

  const phases = experiment.phases || [];
  const lastPhaseIndex = phases.length - 1;
  const lastPhase = phases[lastPhaseIndex] as
    | undefined
    | ExperimentPhaseStringDates;
  const startDate = phases?.[0]?.dateStarted
    ? date(phases[0].dateStarted)
    : null;
  const endDate =
    phases.length > 0
      ? lastPhase?.dateEnded
        ? date(lastPhase.dateEnded ?? "")
        : "now"
      : new Date();

  const [startExperiment, setStartExperiment] = useState(false);

  const { analysis } = useSnapshot();

  const canCreateAnalyses = permissions.check(
    "createAnalyses",
    experiment.project
  );
  const canEditExperiment = !experiment.archived && canCreateAnalyses;

  let hasRunExperimentsPermission = true;
  const envs = getAffectedEnvsForExperiment({ experiment });
  if (envs.length > 0) {
    if (!permissions.check("runExperiments", experiment.project, envs)) {
      hasRunExperimentsPermission = false;
    }
  }
  const canRunExperiment = canEditExperiment && hasRunExperimentsPermission;

  const [totalUsers, variationUsers] = useMemo(() => {
    let totalUsers = 0;
    const variationUsers: number[] = [];
    analysis?.results?.forEach((dim) => {
      dim?.variations?.forEach((v, i) => {
        totalUsers += v.users;
        variationUsers[i] = variationUsers[i] || 0;
        variationUsers[i] += v.users;
      });
    });
    return [totalUsers, variationUsers];
  }, [analysis]);

  return (
    <>
      <div className="experiment-header bg-white px-3 pt-3">
        {startExperiment && experiment.status === "draft" && (
          <Modal
            open={true}
            size="lg"
            close={() => setStartExperiment(false)}
            header="Start Experiment"
          >
            <div className="alert alert-info">
              When you start this experiment, all linked Feature Flags rules and
              Visual Editor changes will be activated and users will begin to
              see your variations. Double check the list below to make sure
              you&apos;re ready.
            </div>
            <StartExperimentBanner
              connections={connections}
              experiment={experiment}
              linkedFeatures={linkedFeatures}
              mutateExperiment={mutate}
              visualChangesets={visualChangesets}
              editTargeting={editTargeting}
              newPhase={newPhase}
              openSetupTab={
                tab !== "overview" ? () => setTab("overview") : undefined
              }
              onStart={() => {
                setTab("results");
                setStartExperiment(false);
              }}
              className=""
              noConfirm={true}
            />
          </Modal>
        )}
        <div className="container-fluid pagecontents position-relative">
          <div style={{ marginTop: -8, marginBottom: 8 }}>
            <Link
              href={`/experiments${
                experiment.status === "draft"
                  ? "#drafts"
                  : experiment.status === "stopped"
                  ? "#stopped"
                  : ""
              }`}
            >
              <a>
                <GBCircleArrowLeft /> Back to all experiments
              </a>
            </Link>
          </div>
          <div className="d-flex align-items-center">
            <div>
              <HeaderWithEdit
                className="h1 mb-0"
                containerClassName=""
                edit={
                  canRunExperiment ? () => setEditNameOpen(true) : undefined
                }
                editClassName="ml-1"
              >
                {experiment.name}
              </HeaderWithEdit>
            </div>

            <div className="ml-auto flex-1"></div>

            <div className="ml-3 d-md-block d-none">
              {experiment.archived ? (
                <div className="badge badge-secondary">archived</div>
              ) : (
                <ExperimentStatusIndicator status={experiment.status} />
              )}
            </div>

            <div className="ml-2">
              {experiment.status === "running" ? (
                <StopExperimentButton
                  editResult={editResult}
                  editTargeting={editTargeting}
                />
              ) : experiment.status === "stopped" && experiment.results ? (
                <div className="experiment-status-widget border d-flex">
                  <div
                    className="d-flex border-left"
                    style={{ height: 30, lineHeight: "30px" }}
                  >
                    <ResultsIndicator results={experiment.results} />
                  </div>
                </div>
              ) : experiment.status === "draft" ? (
                <button
                  className="btn btn-teal"
                  onClick={(e) => {
                    e.preventDefault();
                    setStartExperiment(true);
                  }}
                >
                  Start Experiment <MdRocketLaunch />
                </button>
              ) : null}
            </div>

            <div className="ml-2">
              <MoreMenu>
                {canRunExperiment && (
                  <button
                    className="dropdown-item"
                    onClick={() => setStatusModal(true)}
                  >
                    Edit status
                  </button>
                )}
                <button
                  className="dropdown-item"
                  onClick={() => setAuditModal(true)}
                >
                  Audit log
                </button>
                {editPhases && (
                  <button
                    className="dropdown-item"
                    onClick={() => editPhases()}
                  >
                    Edit phases
                  </button>
                )}
                <WatchButton
                  itemType="experiment"
                  item={experiment.id}
                  className="dropdown-item text-dark"
                />
                <button
                  className="dropdown-item"
                  onClick={() => setWatchersModal(true)}
                >
                  View watchers{" "}
                  <span className="badge badge-pill badge-info">
                    {usersWatching.length}
                  </span>
                </button>
                {duplicate && (
                  <button className="dropdown-item" onClick={duplicate}>
                    Duplicate
                  </button>
                )}
                {canRunExperiment && (
                  <ConfirmButton
                    modalHeader="Archive Experiment"
                    confirmationText={
                      <div>
                        <p>Are you sure you want to archive this experiment?</p>
                        {!safeToEdit ? (
                          <div className="alert alert-danger">
                            This will immediately stop all linked Feature Flags
                            and Visual Changes from running
                          </div>
                        ) : null}
                      </div>
                    }
                    onClick={async () => {
                      try {
                        await apiCall(`/experiment/${experiment.id}/archive`, {
                          method: "POST",
                        });
                        mutate();
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                    cta="Archive"
                  >
                    <button className="dropdown-item" type="button">
                      Archive
                    </button>
                  </ConfirmButton>
                )}
                {canCreateAnalyses && experiment.archived && (
                  <button
                    className="dropdown-item"
                    onClick={async (e) => {
                      e.preventDefault();
                      try {
                        await apiCall(
                          `/experiment/${experiment.id}/unarchive`,
                          {
                            method: "POST",
                          }
                        );
                        mutate();
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                  >
                    Unarchive
                  </button>
                )}
                {canCreateAnalyses && (
                  <DeleteButton
                    className="dropdown-item text-danger"
                    useIcon={false}
                    text="Delete"
                    displayName="Experiment"
                    additionalMessage={
                      !safeToEdit ? (
                        <div className="alert alert-danger">
                          Deleting this experiment will also affect all linked
                          Feature Flags and Visual Changes
                        </div>
                      ) : null
                    }
                    onClick={async () => {
                      await apiCall<{ status: number; message?: string }>(
                        `/experiment/${experiment.id}`,
                        {
                          method: "DELETE",
                          body: JSON.stringify({ id: experiment.id }),
                        }
                      );
                      router.push("/experiments");
                    }}
                  />
                )}
              </MoreMenu>
            </div>
          </div>
        </div>
      </div>

      <div
        className={clsx(
          "experiment-tabs bg-white px-3 border-bottom d-print-none",
          {
            pinned: headerPinned,
          }
        )}
      >
        <div className="container-fluid pagecontents position-relative">
          <div className="row align-items-center header-tabs">
            <div
              className="col-auto pt-2 tab-wrapper"
              id="experiment-page-tabs"
            >
              <TabButtons className="mb-0 pb-0">
                <TabButton
                  active={tab === "overview"}
                  display={
                    <>
                      <FaHome /> Overview
                    </>
                  }
                  anchor="overview"
                  onClick={() => setTab("overview")}
                  newStyle={false}
                  activeClassName="active-tab"
                />
                <TabButton
                  active={tab === "results"}
                  display={
                    <>
                      <PiChartBarHorizontalFill /> Results
                    </>
                  }
                  anchor="results"
                  onClick={() => setTab("results")}
                  newStyle={false}
                  activeClassName="active-tab"
                  last={false}
                />
              </TabButtons>
            </div>
            <div className="flex-1" />

            {experiment.status !== "draft" && totalUsers > 0 && (
              <div className="col-auto mr-2 users">
                <Tooltip
                  usePortal={true}
                  body={
                    <table className="table my-0">
                      <thead>
                        <tr>
                          <th className="border-top-0">Variation</th>
                          <th className="border-top-0">Users</th>
                        </tr>
                      </thead>
                      <tbody>
                        {experiment.variations.map((v, i) => (
                          <tr key={i}>
                            <td
                              className={`variation with-variation-label variation${i}`}
                            >
                              <div className="d-flex align-items-center">
                                <span
                                  className="label"
                                  style={{
                                    width: 20,
                                    height: 20,
                                  }}
                                >
                                  {i}
                                </span>{" "}
                                <OverflowText
                                  className="font-weight-bold"
                                  maxWidth={150}
                                  title={v.name}
                                >
                                  {v.name}
                                </OverflowText>
                              </div>
                            </td>
                            <td>
                              {shortNumberFormatter.format(
                                variationUsers[i] || 0
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  }
                >
                  <div className="px-2 py-1 rounded text-gray">
                    <FaUsers />{" "}
                    <code className="text-dark">
                      {shortNumberFormatter.format(totalUsers)}
                    </code>{" "}
                    users
                  </div>
                </Tooltip>
              </div>
            )}
            <div className="col-auto experiment-date-range">
              {startDate && (
                <>
                  {startDate} — {endDate}{" "}
                  <span className="text-muted">
                    ({daysBetween(startDate, endDate || new Date())} days)
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
