import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import Link from "next/link";
import { FaChartBar, FaCog, FaStop, FaUndo, FaUsers } from "react-icons/fa";
import { useRouter } from "next/router";
import { getAffectedEnvsForExperiment } from "shared/util";
import { useMemo, useState } from "react";
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
import track from "@/services/track";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useScrollPosition } from "@/hooks/useScrollPosition";
import ResultsIndicator from "../ResultsIndicator";
import { useSnapshot } from "../SnapshotProvider";
import { StartExperimentBanner } from "../StartExperimentBanner";
import ExperimentStatusIndicator from "./ExperimentStatusIndicator";
import OverflowText from "./OverflowText";
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
  switchToOldDesign?: () => void;
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
  switchToOldDesign,
}: Props) {
  const { apiCall } = useAuth();
  const router = useRouter();
  const permissions = usePermissions();
  const { scrollY } = useScrollPosition();
  const headerCondensed = scrollY > 60;
  const headerPinned = scrollY > 80;

  const { phase, setPhase } = useSnapshot();

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
    <div
      className={clsx("experiment-header bg-white px-3 pt-3 border-bottom", {
        condensed: headerCondensed,
        pinned: headerPinned,
      })}
    >
      {startExperiment && experiment.status === "draft" && (
        <Modal
          open={true}
          size="lg"
          close={() => setStartExperiment(false)}
          header="Start Experiment"
        >
          <div className="alert alert-info">
            When you start this experiment, all linked Feature Flags rules and
            Visual Editor changes will be activated and users will begin to see
            your variations. Double check the list below to make sure
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
            openSetupTab={tab !== "setup" ? () => setTab("setup") : undefined}
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
        <div className="row align-items-top">
          <div className="col-auto">
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

            <HeaderWithEdit
              className="h1 mb-0"
              edit={canRunExperiment ? () => setEditNameOpen(true) : undefined}
              editClassName="ml-1"
            >
              <OverflowText maxWidth={550} title={experiment.name}>
                <a
                  role="button"
                  className="text-main hover-underline"
                  onClick={() => setTab("setup")}
                >
                  {experiment.name}
                </a>
              </OverflowText>
            </HeaderWithEdit>
          </div>

          {switchToOldDesign ? (
            <div className="ml-auto mr-auto">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  switchToOldDesign();
                  track("Switched Experiment Page V2", {
                    switchTo: "old",
                  });
                }}
              >
                switch to old design <FaUndo />
              </a>
            </div>
          ) : (
            <div className="flex-1 col"></div>
          )}

          <div className="col-auto">
            {experiment.status === "running" ? (
              <button
                className="btn btn-primary"
                onClick={(e) => {
                  e.preventDefault();
                  if (editResult) {
                    editResult();
                  }
                }}
                disabled={!editResult}
              >
                Stop Experiment <FaStop className="ml-2" />
              </button>
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

          <div className="col-auto">
            <WatchButton itemType="experiment" item={experiment.id} />
          </div>

          <div className="col-auto">
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
                <button className="dropdown-item" onClick={() => editPhases()}>
                  Edit phases
                </button>
              )}
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
                      await apiCall(`/experiment/${experiment.id}/unarchive`, {
                        method: "POST",
                      });
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
        <div className="row align-items-center header-tabs">
          <OverflowText
            className="experiment-title"
            maxWidth={headerCondensed ? 550 : 0}
            title={experiment.name}
          >
            <a
              role="button"
              className="text-main font-weight-bold hover-underline"
              onClick={() => setTab("setup")}
            >
              {experiment.name}
            </a>
          </OverflowText>
          <div className="col-auto pt-2" id="experiment-page-tabs">
            <TabButtons className="mb-0 pb-0">
              <TabButton
                active={tab === "setup"}
                display={
                  <>
                    <FaCog /> Setup
                  </>
                }
                onClick={() => setTab("setup")}
                newStyle={false}
                activeClassName="active-tab"
              />
              <TabButton
                active={tab === "results"}
                display={
                  <>
                    <FaChartBar /> Results
                  </>
                }
                onClick={() => setTab("results")}
                newStyle={false}
                activeClassName="active-tab"
                last={false}
              />
            </TabButtons>
          </div>
          <div className="col-auto ml-auto"></div>
          <div className="col-auto mr-2">
            {experiment.archived ? (
              <div className="badge badge-secondary">archived</div>
            ) : (
              <ExperimentStatusIndicator status={experiment.status} />
            )}
          </div>

          {experiment.status !== "draft" && totalUsers > 0 && (
            <div className="col-auto mr-2">
              <Tooltip
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
          {experiment.phases.length > 1 ? (
            <div className="col-auto">
              <Dropdown
                toggle={<PhaseDateSummary phase={experiment.phases[phase]} />}
                uuid="experiment-phase-selector"
              >
                {experiment.phases.map((p, i) => (
                  <DropdownLink
                    onClick={() => {
                      setPhase(i);
                    }}
                    key={i}
                  >
                    <PhaseDateSummary phase={p} />
                  </DropdownLink>
                ))}
              </Dropdown>
            </div>
          ) : experiment.phases.length > 0 ? (
            <div className="col-auto">
              <PhaseDateSummary phase={experiment.phases[phase]} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
