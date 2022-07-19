import { useRouter } from "next/router";
import {
  ExperimentInterfaceStringDates,
  Screenshot,
} from "back-end/types/experiment";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import ScreenshotUpload from "../../components/EditExperiment/ScreenshotUpload";
import clone from "lodash/clone";
import React, { useState, ReactElement } from "react";
import { useAuth } from "../../services/auth";
import Tabs from "../../components/Tabs/Tabs";
import Tab from "../../components/Tabs/Tab";
import StatusIndicator from "../../components/Experiment/StatusIndicator";
import Carousel from "../../components/Carousel";
import { FaPalette, FaExternalLinkAlt } from "react-icons/fa";
import Link from "next/link";
import { ago, date, datetime, daysBetween } from "../../services/dates";
import NewPhaseForm from "../../components/Experiment/NewPhaseForm";
import StopExperimentForm from "../../components/Experiment/StopExperimentForm";
import { formatTrafficSplit, phaseSummary } from "../../services/utils";
import Results from "../../components/Experiment/Results";
import ResultsIndicator from "../../components/Experiment/ResultsIndicator";
import DiscussionThread from "../../components/DiscussionThread";
import useSwitchOrg from "../../services/useSwitchOrg";
import ConfirmModal from "../../components/ConfirmModal";
import WatchButton from "../../components/WatchButton";
import HistoryTable from "../../components/HistoryTable";
import EditTagsForm from "../../components/Tags/EditTagsForm";
import EditDataSourceForm from "../../components/Experiment/EditDataSourceForm";
import EditMetricsForm from "../../components/Experiment/EditMetricsForm";
import EditTargetingForm from "../../components/Experiment/EditTargetingForm";
import EditInfoForm from "../../components/Experiment/EditInfoForm";
import MarkdownInlineEdit from "../../components/Markdown/MarkdownInlineEdit";
import RightRailSection from "../../components/Layout/RightRailSection";
import RightRailSectionGroup from "../../components/Layout/RightRailSectionGroup";
import ConfirmButton from "../../components/Modal/ConfirmButton";
import NewExperimentForm from "../../components/Experiment/NewExperimentForm";
import MoreMenu from "../../components/Dropdown/MoreMenu";
import { useDefinitions } from "../../services/DefinitionsContext";
import VisualCode from "../../components/Experiment/VisualCode";
import { IdeaInterface } from "back-end/types/idea";
import EditProjectForm from "../../components/Experiment/EditProjectForm";
import DeleteButton from "../../components/DeleteButton";
import { GBAddCircle, GBCircleArrowLeft, GBEdit } from "../../components/Icons";
import Button from "../../components/Button";
import { useFeature } from "@growthbook/growthbook-react";
import usePermissions from "../../hooks/usePermissions";
import { getExposureQuery } from "../../services/datasources";
import clsx from "clsx";
import EditPhaseModal from "../../components/Experiment/EditPhaseModal";
import EditStatusModal from "../../components/Experiment/EditStatusModal";
import useUser from "../../hooks/useUser";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  idea?: IdeaInterface;
  mutate: () => void;
}

export default function MultiTabPage({experiment, idea, mutate}: Props) {
  const router = useRouter();

  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [phaseModalOpen, setPhaseModalOpen] = useState(false);
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [dataSourceModalOpen, setDataSourceModalOpen] = useState(false);
  const [metricsModalOpen, setMetricsModalOpen] = useState(false);
  const [targetingModalOpen, setTargetingModalOpen] = useState(false);
  const [editPhaseModalOpen, setEditPhaseModalOpen] = useState<number | null>(
    null
  );

  const {
    getMetricById,
    getDatasourceById,
    projects,
    project,
    getProjectById,
  } = useDefinitions();
  const permissions = usePermissions();

  const onScreenshotUpload = (variation: number, screenshot: Screenshot) => {
    mutate();
  };

  const currentPhase = experiment.phases[experiment.phases.length - 1];

  let wrapClasses = `container-fluid experiment-details exp-vars-${experiment.variations.length}`;
  if (experiment.variations.length <= 2) {
    wrapClasses += " pagecontents";
  } else if (experiment.variations.length > 2) {
    wrapClasses += " multivariations";
  }

  const canEdit = permissions.createAnalyses;

  const datasource = getDatasourceById(experiment.datasource);

  const watcherIds = useApi<{
    userIds: string[];
  }>(`/experiment/${experiment.id}/watchers`);

  // Get name or email of all active users watching this experiment
  const usersWatching = (watcherIds?.data?.userIds || [])
    .map((id) => users.get(id))
    .filter(Boolean)
    .map((u) => u.name || u.email);
  

  const { users } = useUser();

  const showTargeting = useFeature("show-experiment-targeting").on;

  const { apiCall } = useAuth();

  return (
    <div className={wrapClasses}>

{duplicateModalOpen && (
        <NewExperimentForm
          onClose={() => setDuplicateModalOpen(false)}
          initialValue={{
            ...experiment,
            name: experiment.name + " (Copy)",
            trackingKey: "",
          }}
          source="duplicate"
        />
      )}
      {tagsModalOpen && (
        <EditTagsForm
          tags={experiment.tags}
          save={async (tags) => {
            await apiCall(`/experiment/${experiment.id}`, {
              method: "POST",
              body: JSON.stringify({ tags }),
            });
          }}
          cancel={() => setTagsModalOpen(false)}
          mutate={mutate}
        />
      )}
      {projectModalOpen && (
        <EditProjectForm
          cancel={() => setProjectModalOpen(false)}
          mutate={mutate}
          current={experiment.project}
          apiEndpoint={`/experiment/${experiment.id}`}
        />
      )}
      {dataSourceModalOpen && (
        <EditDataSourceForm
          experiment={experiment}
          cancel={() => setDataSourceModalOpen(false)}
          mutate={mutate}
        />
      )}
      {metricsModalOpen && (
        <EditMetricsForm
          experiment={experiment}
          cancel={() => setMetricsModalOpen(false)}
          mutate={mutate}
        />
      )}
      {targetingModalOpen && (
        <EditTargetingForm
          experiment={experiment}
          cancel={() => setTargetingModalOpen(false)}
          mutate={mutate}
        />
      )}
      {deleteOpen && (
        <ConfirmModal
          modalState={deleteOpen}
          onConfirm={async () => {
            try {
              await apiCall<{ status: number; message?: string }>(
                `/experiment/${experiment.id}`,
                {
                  method: "DELETE",
                  body: JSON.stringify({ id: experiment.id }),
                }
              );
              router.push("/experiments");
            } catch (e) {
              console.error(e);
            }
          }}
          setModalState={setDeleteOpen}
          title="Delete Experiment"
          yesText="Delete"
          noText="Cancel"
          yesColor="danger"
          subtitle="Are you sure you want to permanently delete this experiment?"
        />
      )}
      {editModalOpen && (
        <EditInfoForm
          experiment={experiment}
          cancel={() => setEditModalOpen(false)}
          mutate={mutate}
        />
      )}
      {phaseModalOpen && (
        <NewPhaseForm
          close={() => setPhaseModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
        />
      )}
      {stopModalOpen && (
        <StopExperimentForm
          close={() => setStopModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
        />
      )}
      {editPhaseModalOpen !== null && (
        <EditPhaseModal
          close={() => setEditPhaseModalOpen(null)}
          mutate={mutate}
          experiment={experiment}
          i={editPhaseModalOpen}
        />
      )}
      {statusModalOpen && (
        <EditStatusModal
          close={() => setStatusModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
        />
      )}
      {project && project !== experiment.project && (
        <div className="bg-info p-2 mb-2 text-center text-white">
          This experiment is in a different project. Move it to{" "}
          <a
            href="#"
            className="text-white"
            onClick={async (e) => {
              e.preventDefault();
              await apiCall(`/experiment/${experiment.id}`, {
                method: "POST",
                body: JSON.stringify({
                  project,
                }),
              });
              mutate();
            }}
          >
            <strong>
              {getProjectById(project)?.name || "the current project"}
            </strong>
          </a>
        </div>
      )}
      <div className="row mb-2 align-items-center">
        <div className="col-auto">
          <Link href="/experiments">
            <a>
              <GBCircleArrowLeft /> Back to all experiments
            </a>
          </Link>
        </div>
        <div style={{ flex: 1 }} />

        <div className="col-auto">
          <WatchButton item={experiment.id} itemType="experiment" type="link" />
        </div>
        {canEdit && (
          <div className="col-auto">
            <MoreMenu id="experiment-more-menu">
              <button
                className="dropdown-item"
                onClick={() => {
                  setDuplicateModalOpen(true);
                }}
              >
                duplicate
              </button>
              {!experiment.archived && (
                <button
                  className="dropdown-item"
                  onClick={async (e) => {
                    e.preventDefault();
                    try {
                      await apiCall(`/experiment/${experiment.id}/archive`, {
                        method: "POST",
                      });
                      mutate();
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                >
                  archive
                </button>
              )}
              {experiment.archived && (
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
                  unarchive
                </button>
              )}
              {experiment.status !== "draft" && !experiment.archived && (
                <ConfirmButton
                  onClick={async () => {
                    const updates: Partial<ExperimentInterfaceStringDates> = {
                      status: "draft",
                      results: null,
                      analysis: "",
                    };
                    await apiCall(`/experiment/${experiment.id}`, {
                      method: "POST",
                      body: JSON.stringify(updates),
                    });
                    await mutate();
                  }}
                  modalHeader="Reset to Draft"
                  confirmationText={
                    <>
                      <div className="alert alert-warning">
                        <strong>Warning:</strong> All previously collected
                        results data will be archived and it will start fresh
                        from this point on.
                      </div>
                      <p>Are you sure you want to continue?</p>
                    </>
                  }
                  cta="Reset to Draft"
                  ctaColor="danger"
                >
                  <button className="dropdown-item">reset to draft</button>
                </ConfirmButton>
              )}
              <button
                className="dropdown-item"
                onClick={(e) => {
                  e.preventDefault();
                  setDeleteOpen(true);
                }}
              >
                delete
              </button>
            </MoreMenu>
          </div>
        )}
      </div>
      <div className="row align-items-center mb-3">
        <h2 className="col-auto mb-0">
          {experiment.name}
          {canEdit && !experiment.archived && (
            <a
              className="ml-2 cursor-pointer"
              onClick={() => setEditModalOpen(true)}
            >
              <GBEdit />
            </a>
          )}
        </h2>
      </div>
      <Tabs newStyle={true}>
        <Tab display="Info" anchor="info">
          {experiment.id.match(/^exp_sample_/) && (
            <div className="alert alert-info">
              Click the &quot;Results&quot; tab above to see how the sample
              experiment performed.
            </div>
          )}
          <div className="row mb-3">
            <div className="col-md-9">
              {canEdit && !experiment.archived && (
                <button
                  className="btn btn-sm btn-outline-primary ml-2 float-right font-weight-bold"
                  onClick={() => setEditModalOpen(true)}
                >
                  Edit
                </button>
              )}
              <h2 className="mb-4">{experiment.name}</h2>
              <MarkdownInlineEdit
                value={experiment.description || experiment.observations}
                save={async (description) => {
                  await apiCall(`/experiment/${experiment.id}`, {
                    method: "POST",
                    body: JSON.stringify({ description }),
                  });
                  await mutate();
                }}
                // Only allow inline edit when first creating a description
                canCreate={canEdit}
                canEdit={false}
                className="mb-4"
              />

              <div className="mb-4">
                <h4>Hypothesis</h4>
                {experiment.hypothesis ? (
                  experiment.hypothesis
                ) : canEdit ? (
                  <p>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setEditModalOpen(true);
                      }}
                    >
                      <em>Add hypothesis</em>
                    </a>
                  </p>
                ) : (
                  <p>
                    <em>No hypothesis</em>
                  </p>
                )}
              </div>
              <div className="mb-4">
                <h4>Variations</h4>
                {experiment.implementation === "visual" && (
                  <div className="alert alert-info">
                    <FaPalette /> This is a <strong>Visual Experiment</strong>.{" "}
                    {experiment.status === "draft" && canEdit && (
                      <Link href={`/experiments/designer/${experiment.id}`}>
                        <a className="d-none d-md-inline">Open the Editor</a>
                      </Link>
                    )}
                  </div>
                )}
                <div className="row mb-3">
                  {experiment.variations.map((v, i) => (
                    <div
                      className="col-md border rounded mx-2 mb-3 p-0 text-center position-relative d-flex flex-column"
                      key={i}
                      style={{ maxWidth: 600 }}
                    >
                      <div className="p-3">
                        <div>
                          <strong>{v.name}</strong>{" "}
                        </div>
                        <div className="mb-1">
                          <small className="text-muted">id: {v.key || i}</small>
                        </div>
                        {v.description && <p>{v.description}</p>}
                        {experiment.implementation === "visual" && (
                          <VisualCode
                            dom={v.dom || []}
                            css={v.css || ""}
                            experimentId={experiment.id}
                            control={i === 0}
                          />
                        )}
                      </div>
                      {v.screenshots.length > 0 ? (
                        <Carousel
                          deleteImage={
                            !permissions.createAnalyses || experiment.archived
                              ? null
                              : async (j) => {
                                  const { status, message } = await apiCall<{
                                    status: number;
                                    message?: string;
                                  }>(
                                    `/experiment/${experiment.id}/variation/${i}/screenshot`,
                                    {
                                      method: "DELETE",
                                      body: JSON.stringify({
                                        url: v.screenshots[j].path,
                                      }),
                                    }
                                  );

                                  if (status >= 400) {
                                    throw new Error(
                                      message ||
                                        "There was an error deleting the image"
                                    );
                                  }

                                  mutate();
                                }
                          }
                        >
                          {v.screenshots.map((s) => (
                            <img
                              className="experiment-image"
                              key={s.path}
                              src={s.path}
                            />
                          ))}
                        </Carousel>
                      ) : (
                        <div className="image-blank" />
                      )}
                      <div style={{ flex: 1 }} />
                      {permissions.createAnalyses && !experiment.archived && (
                        <div className="p-3">
                          <ScreenshotUpload
                            experiment={experiment.id}
                            variation={i}
                            onSuccess={onScreenshotUpload}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="col-md-3">
              <RightRailSection
                title="Status"
                open={() => setStatusModalOpen(true)}
                canOpen={canEdit && !experiment.archived}
              >
                <RightRailSectionGroup type="custom">
                  <div className="d-flex">
                    <StatusIndicator
                      status={experiment.status}
                      archived={experiment.archived}
                      showBubble={true}
                    />
                    {experiment.status === "stopped" && experiment.results && (
                      <div className="col-auto">
                        <ResultsIndicator results={experiment.results} />
                      </div>
                    )}
                  </div>
                </RightRailSectionGroup>
                {experiment.phases?.length > 0 && (
                  <RightRailSectionGroup type="custom">
                    <ol className="list-group">
                      {experiment.phases.map((phase, i) => (
                        <li
                          key={i}
                          className={clsx("list-group-item py-2 px-2", {
                            "list-group-item-light": phase?.dateEnded,
                          })}
                        >
                          <div className="d-flex">
                            <div className="mr-2">{i + 1}.</div>
                            <div>
                              {phaseSummary(phase)}
                              <div style={{ fontSize: "0.8em" }}>
                                started{" "}
                                <strong
                                  className=""
                                  title={datetime(phase?.dateStarted)}
                                >
                                  {date(phase?.dateStarted)}
                                </strong>
                                {phase?.dateEnded ? (
                                  <span
                                    className=""
                                    title={
                                      "Ended: " + datetime(phase.dateEnded)
                                    }
                                  >
                                    {" "}
                                    , ran for{" "}
                                    <strong>
                                      {daysBetween(
                                        phase.dateStarted,
                                        phase.dateEnded
                                      )}{" "}
                                      days
                                    </strong>
                                  </span>
                                ) : (
                                  ", active"
                                )}
                              </div>
                            </div>
                            <div className="ml-auto">
                              <MoreMenu id="phase-status">
                                <a
                                  className="dropdown-item"
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setEditPhaseModalOpen(i);
                                  }}
                                >
                                  Edit
                                </a>
                                <DeleteButton
                                  displayName="phase"
                                  useIcon={false}
                                  className="dropdown-item"
                                  text="Delete"
                                  onClick={async () => {
                                    await apiCall(
                                      `/experiment/${experiment.id}/phase/${i}`,
                                      {
                                        method: "DELETE",
                                      }
                                    );
                                    mutate();
                                  }}
                                />
                              </MoreMenu>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {experiment.phases?.length > 0 && (
                      <div className="mt-1">
                        <a
                          href="#"
                          className="text-muted"
                          onClick={(e) => {
                            e.preventDefault();
                            setPhaseModalOpen(true);
                          }}
                        >
                          <GBAddCircle /> add new phase
                        </a>
                      </div>
                    )}
                  </RightRailSectionGroup>
                )}
              </RightRailSection>
              <hr />
              <RightRailSection
                title="Data Source"
                open={() => setDataSourceModalOpen(true)}
                canOpen={canEdit && !experiment.archived}
              >
                <RightRailSectionGroup title="Data Source" type="commaList">
                  {experiment.datasource ? datasource?.name : "Manual"}
                </RightRailSectionGroup>
                {datasource?.properties?.exposureQueries && (
                  <RightRailSectionGroup
                    title="Assignment Table"
                    type="commaList"
                  >
                    {
                      getExposureQuery(
                        datasource?.settings,
                        experiment.exposureQueryId,
                        experiment.userIdType
                      )?.name
                    }
                  </RightRailSectionGroup>
                )}
                <RightRailSectionGroup title="Experiment Id">
                  <input
                    type="text"
                    readOnly
                    className="form-control form-control-sm"
                    value={experiment.trackingKey}
                  />
                </RightRailSectionGroup>
              </RightRailSection>
              <hr />
              <RightRailSection
                title="Metrics"
                open={() => setMetricsModalOpen(true)}
                canOpen={canEdit && !experiment.archived}
              >
                <RightRailSectionGroup title="Goals" type="custom">
                  {experiment.metrics.map((m) => {
                    return (
                      <div key={m} className="ml-2">
                        <span className="mr-1">-</span>
                        <Link href={`/metric/${m}`}>
                          <a className="mr-2 font-weight-bold">
                            {getMetricById(m)?.name}
                          </a>
                        </Link>
                      </div>
                    );
                  })}
                </RightRailSectionGroup>
                {experiment.guardrails?.length > 0 && (
                  <RightRailSectionGroup title="Guardrails" type="custom">
                    {experiment.guardrails.map((m) => {
                      return (
                        <div key={m} className="ml-2">
                          <span className="mr-1">-</span>
                          <Link href={`/metric/${m}`}>
                            <a className="mr-2 font-weight-bold">
                              {getMetricById(m)?.name}
                            </a>
                          </Link>
                        </div>
                      );
                    })}
                  </RightRailSectionGroup>
                )}
              </RightRailSection>

              {projects.length > 0 && (
                <>
                  <hr />
                  <RightRailSection
                    title="Project"
                    open={() => setProjectModalOpen(true)}
                    canOpen={canEdit}
                  >
                    <RightRailSectionGroup empty="None" type="commaList">
                      {getProjectById(experiment.project)?.name}
                    </RightRailSectionGroup>
                  </RightRailSection>
                </>
              )}
              <hr />
              <RightRailSection
                title="Tags"
                open={() => setTagsModalOpen(true)}
                canOpen={canEdit && !experiment.archived}
              >
                <RightRailSectionGroup type="tags">
                  {experiment.tags}
                </RightRailSectionGroup>
              </RightRailSection>

              {(experiment.implementation === "visual" || showTargeting) && (
                <>
                  <hr />
                  <RightRailSection
                    title="Targeting"
                    open={() => setTargetingModalOpen(true)}
                    canOpen={canEdit && !experiment.archived}
                  >
                    <RightRailSectionGroup title="URL" type="code" empty="Any">
                      {experiment.targetURLRegex}
                    </RightRailSectionGroup>
                    {currentPhase?.groups?.length > 0 && (
                      <RightRailSectionGroup
                        title="User Groups"
                        type="commaList"
                      >
                        {currentPhase?.groups}
                      </RightRailSectionGroup>
                    )}
                  </RightRailSection>
                </>
              )}
              {idea && <hr />}
              {idea && (
                <RightRailSection title="Linked Idea" canOpen={false}>
                  <div className="my-1">
                    {idea.impactScore && (
                      <div className="float-right text-right">
                        <div>
                          <small>Impact Score</small>
                        </div>
                        <div
                          className="badge badge-primary"
                          style={{ fontSize: "1.2em" }}
                        >
                          {idea.impactScore}
                          <small style={{ fontSize: "0.7em" }}>/100</small>
                        </div>
                      </div>
                    )}
                    <Link href={`/idea/${idea.id}`}>
                      <a>
                        <FaExternalLinkAlt /> {idea.text}
                      </a>
                    </Link>
                  </div>
                </RightRailSection>
              )}
              {usersWatching.length > 0 && (
                <>
                  <hr />
                  <RightRailSection title="Watching">
                    <RightRailSectionGroup type="list">
                      {usersWatching}
                    </RightRailSectionGroup>
                  </RightRailSection>
                </>
              )}
            </div>
          </div>
        </Tab>
        <Tab
          display="Results"
          anchor="results"
          lazy={true}
          padding={false}
          key="Results"
        >
          <div className="position-relative">
            <Results
              experiment={experiment}
              editMetrics={
                permissions.createAnalyses
                  ? () => setMetricsModalOpen(true)
                  : null
              }
              editResult={
                permissions.createAnalyses ? () => setStopModalOpen(true) : null
              }
              addPhase={
                permissions.createAnalyses
                  ? () => setPhaseModalOpen(true)
                  : null
              }
              mutateExperiment={mutate}
            />
          </div>
        </Tab>
        <Tab display="Discussion" anchor="discussions">
          <DiscussionThread
            type="experiment"
            id={experiment.id}
            allowNewComments={!experiment.archived}
          />
        </Tab>
        <Tab display="History" anchor="history" lazy={true}>
          {experiment.phases && (
            <div className="mb-4">
              <h4>Experiment Phases</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Type</th>
                    <th>Percent of Traffic</th>
                    <th>Traffic Split</th>
                    <th>Reason for Stopping</th>
                    {canEdit && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {experiment.phases.map((phase, i) => (
                    <tr className="border p-2 m-2" key={i}>
                      <td>{i + 1}</td>
                      <td>{datetime(phase.dateStarted)}</td>
                      <td>{datetime(phase.dateEnded)}</td>
                      <td>{phase.phase}</td>
                      <td>{Math.floor(phase.coverage * 100)}%</td>
                      <td>{formatTrafficSplit(phase.variationWeights)}</td>
                      <td>{phase.reason}</td>
                      {canEdit && (
                        <td>
                          <DeleteButton
                            displayName="phase"
                            additionalMessage={
                              experiment.phases.length === 1
                                ? "This is the only phase. Deleting this will revert the experiment to a draft."
                                : ""
                            }
                            onClick={async () => {
                              await apiCall(
                                `/experiment/${experiment.id}/phase/${i}`,
                                {
                                  method: "DELETE",
                                }
                              );
                              mutate();
                            }}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {"nextSnapshotAttempt" in experiment &&
            experiment.status === "running" && (
              <div className="mb-4">
                <h4>Next Scheduled Results Update</h4>
                {experiment.autoSnapshots && experiment.nextSnapshotAttempt ? (
                  <span title={datetime(experiment.nextSnapshotAttempt)}>
                    {ago(experiment.nextSnapshotAttempt)}{" "}
                    {canEdit && permissions.runQueries && (
                      <Button
                        color="link text-danger"
                        className="btn-sm"
                        onClick={async () => {
                          await apiCall(`/experiment/${experiment.id}`, {
                            method: "POST",
                            body: JSON.stringify({
                              autoSnapshots: false,
                            }),
                          });
                          mutate();
                        }}
                      >
                        cancel
                      </Button>
                    )}
                  </span>
                ) : (
                  <div>
                    Not automatically updating. Click the &quot;Update
                    Data&quot; button on the results tab to manually update
                    results.
                  </div>
                )}
              </div>
            )}
          <HistoryTable
            type="experiment"
            id={experiment.id}
            key={experiment.phases?.length}
          />
        </Tab>
      </Tabs>
    </div>
  )
}