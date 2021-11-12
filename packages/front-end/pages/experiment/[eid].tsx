import { useRouter } from "next/router";
import {
  ExperimentInterfaceStringDates,
  Screenshot,
} from "back-end/types/experiment";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import ScreenshotUpload from "../../components/EditExperiment/ScreenshotUpload";
import clone from "lodash/clone";
import { useState, ReactElement, useContext } from "react";
import { useAuth } from "../../services/auth";
import Tabs from "../../components/Tabs/Tabs";
import Tab from "../../components/Tabs/Tab";
import StatusIndicator from "../../components/Experiment/StatusIndicator";
import Carousel from "../../components/Carousel";
import {
  FaAngleLeft,
  FaStop,
  FaPlay,
  FaPencilAlt,
  FaArchive,
  FaTrash,
  FaCopy,
  FaUndo,
  FaCode,
  FaPalette,
  FaExternalLinkAlt,
} from "react-icons/fa";
import Link from "next/link";
import { ago, datetime } from "../../services/dates";
import NewPhaseForm from "../../components/Experiment/NewPhaseForm";
import StopExperimentForm from "../../components/Experiment/StopExperimentForm";
import { formatTrafficSplit, phaseSummary } from "../../services/utils";
import Results from "../../components/Experiment/Results";
import ResultsIndicator from "../../components/Experiment/ResultsIndicator";
import DiscussionThread from "../../components/DiscussionThread";
import useSwitchOrg from "../../services/useSwitchOrg";
import ConfirmModal from "../../components/ConfirmModal";
import WatchButton from "../../components/Experiment/WatchButton";
import { UserContext } from "../../components/ProtectedPage";
import HistoryTable from "../../components/HistoryTable";
import EditTagsForm from "../../components/Experiment/EditTagsForm";
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
import InstructionsModal from "../../components/Experiment/InstructionsModal";
import { useDefinitions } from "../../services/DefinitionsContext";
import VisualCode from "../../components/Experiment/VisualCode";
import Code from "../../components/Code";
import { IdeaInterface } from "back-end/types/idea";
import EditProjectForm from "../../components/Experiment/EditProjectForm";
import DeleteButton from "../../components/DeleteButton";

const ExperimentPage = (): ReactElement => {
  const router = useRouter();
  const { eid } = router.query;
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [phaseModalOpen, setPhaseModalOpen] = useState(false);
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [dataSourceModalOpen, setDataSourceModalOpen] = useState(false);
  const [metricsModalOpen, setMetricsModalOpen] = useState(false);
  const [targetingModalOpen, setTargetingModalOpen] = useState(false);
  const [instructionsModalOpen, setInstructionsModalOpen] = useState(false);

  const { apiCall } = useAuth();

  const { data, error, mutate } = useApi<{
    experiment: ExperimentInterfaceStringDates;
    idea?: IdeaInterface;
  }>(`/experiment/${eid}`);

  useSwitchOrg(data?.experiment?.organization);

  const {
    getMetricById,
    getDatasourceById,
    projects,
    project,
    getProjectById,
  } = useDefinitions();
  const { permissions } = useContext(UserContext);

  if (error) {
    return <div>There was a problem loading the experiment</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const { experiment } = data;

  const onScreenshotUpload = (variation: number, screenshot: Screenshot) => {
    const newData = clone(data);
    newData.experiment.variations[variation].screenshots.push(screenshot);
    mutate(newData);
  };

  let ctaButton = null;
  if (experiment.archived) {
    ctaButton = null;
  } else if (experiment.status === "draft") {
    ctaButton = (
      <button
        type="button"
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          setPhaseModalOpen(true);
        }}
      >
        <FaPlay /> Start
      </button>
    );
  } else if (experiment.status === "running") {
    ctaButton = (
      <>
        <button
          type="button"
          className="btn btn-primary"
          onClick={(e) => {
            e.preventDefault();
            setStopModalOpen(true);
          }}
        >
          <FaStop /> Stop Experiment
        </button>
      </>
    );
  }

  const currentPhase = experiment.phases[experiment.phases.length - 1];

  let wrapClasses = `container-fluid mt-3 experiment-details exp-vars-${experiment.variations.length}`;
  if (experiment.variations.length <= 2) {
    wrapClasses += " pagecontents";
  } else if (experiment.variations.length > 2) {
    wrapClasses += " multivariations";
  }

  const canEdit =
    experiment.status === "draft"
      ? permissions.draftExperiments
      : permissions.runExperiments;

  const datasource = getDatasourceById(experiment.datasource);

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
          experiment={experiment}
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
      {instructionsModalOpen && (
        <InstructionsModal
          close={() => setInstructionsModalOpen(false)}
          experiment={experiment}
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
      <div className="mb-2">
        <Link href="/experiments">
          <a>
            <FaAngleLeft /> All Experiments
          </a>
        </Link>
      </div>
      <div className="row align-items-center mb-3">
        <h1 className="col-auto">{experiment.name}</h1>
        <div className="col-auto">
          <StatusIndicator
            status={experiment.status}
            archived={experiment.archived}
          />
        </div>

        {experiment.status === "stopped" && experiment.results && (
          <div className="col-auto">
            <ResultsIndicator results={experiment.results} />
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          <WatchButton experiment={experiment.id} />
        </div>
        {permissions.runExperiments && ctaButton && (
          <div className="experiment-actions col-auto">{ctaButton}</div>
        )}
        {canEdit && (
          <div className="col-auto">
            <MoreMenu id="experiment-more-menu">
              <button
                className="dropdown-item"
                onClick={() => {
                  setDuplicateModalOpen(true);
                }}
              >
                <FaCopy /> duplicate
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
                  <FaArchive /> archive
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
                  <FaArchive /> unarchive
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
                  <button className="dropdown-item">
                    <FaUndo /> reset to draft
                  </button>
                </ConfirmButton>
              )}
              <button
                className="dropdown-item"
                onClick={(e) => {
                  e.preventDefault();
                  setDeleteOpen(true);
                }}
              >
                <FaTrash /> delete
              </button>
            </MoreMenu>
          </div>
        )}
      </div>
      <div className="row mb-3 align-items-center">
        {currentPhase && experiment.status === "running" && (
          <div className="col-auto mb-2">
            {permissions.runExperiments ? (
              <button
                className="btn btn-outline-secondary"
                onClick={(e) => {
                  e.preventDefault();
                  setPhaseModalOpen(true);
                }}
              >
                <span className="mr-2">{phaseSummary(currentPhase)}</span>
                <FaPencilAlt />
              </button>
            ) : (
              <span className="text-muted">{phaseSummary(currentPhase)}</span>
            )}
          </div>
        )}

        {experiment.status === "draft" ? (
          <div className="col-auto mb-2">
            <span className="statuslabel">Created: </span>{" "}
            <span className="" title={datetime(experiment.dateCreated)}>
              {ago(experiment.dateCreated)}
            </span>
          </div>
        ) : (
          <>
            <div className="col-auto mb-2">
              <span className="statuslabel">Started: </span>{" "}
              <span className="" title={datetime(currentPhase?.dateStarted)}>
                {ago(currentPhase?.dateStarted)}
              </span>
            </div>
            {experiment.status !== "running" ? (
              <div className="col-auto mb-2">
                <span className="statuslabel">Ended: </span>{" "}
                <span
                  className=""
                  title={
                    currentPhase.dateEnded
                      ? datetime(currentPhase?.dateEnded)
                      : ""
                  }
                >
                  {currentPhase?.dateEnded && ago(currentPhase?.dateEnded)}
                </span>
              </div>
            ) : (
              ""
            )}
          </>
        )}
      </div>
      <Tabs>
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
                  className="btn btn-sm btn-outline-secondary ml-2 float-right"
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
                canCreate={true}
                canEdit={false}
                className="mb-4"
              />

              <div className="mb-4">
                <h5>Hypothesis</h5>
                {experiment.hypothesis || (
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
                )}
              </div>
              <div className="mb-4">
                <h5>Variations</h5>
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
                      className="col-md border mx-3 p-3 text-center position-relative d-flex flex-column"
                      key={i}
                      style={{ maxWidth: 600 }}
                    >
                      <div>
                        <strong>{v.name}</strong>{" "}
                      </div>
                      <div className="mb-1">
                        <small className="text-muted">id: {v.key || i}</small>
                      </div>
                      {v.description && <p>{v.description}</p>}
                      {v.value && experiment.implementation !== "visual" && (
                        <Code language="json" code={v.value} />
                      )}
                      {experiment.implementation === "visual" && (
                        <VisualCode
                          dom={v.dom || []}
                          css={v.css || ""}
                          experimentId={experiment.id}
                          control={i === 0}
                        />
                      )}
                      {v.screenshots.length > 0 ? (
                        <Carousel
                          deleteImage={
                            !permissions.draftExperiments || experiment.archived
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
                              className="border bg-dark"
                              key={s.path}
                              src={s.path}
                              style={{
                                height: 300,
                                width: "100%",
                                objectFit: "scale-down",
                                objectPosition: "50% 50%",
                                background: "#444",
                              }}
                            />
                          ))}
                        </Carousel>
                      ) : (
                        ""
                      )}
                      <div style={{ flex: 1 }} />
                      {permissions.draftExperiments && !experiment.archived && (
                        <ScreenshotUpload
                          experiment={experiment.id}
                          variation={i}
                          onSuccess={onScreenshotUpload}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="col-md-3">
              {projects.length > 0 && (
                <>
                  <RightRailSection
                    title="Project"
                    open={() => setProjectModalOpen(true)}
                    canOpen={canEdit}
                  >
                    <RightRailSectionGroup empty="None" type="badge">
                      {getProjectById(experiment.project)?.name}
                    </RightRailSectionGroup>
                  </RightRailSection>
                  <hr />
                </>
              )}
              {!experiment.archived &&
                experiment.status !== "stopped" &&
                experiment.implementation !== "visual" && (
                  <>
                    <RightRailSection title="Implementation">
                      <div className="my-1">
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setInstructionsModalOpen(true);
                          }}
                        >
                          <FaCode /> Get Code
                        </a>
                      </div>
                    </RightRailSection>
                    <hr />
                  </>
                )}
              <RightRailSection
                title="Tags"
                open={() => setTagsModalOpen(true)}
                canOpen={canEdit && !experiment.archived}
              >
                <RightRailSectionGroup type="badge">
                  {experiment.tags}
                </RightRailSectionGroup>
              </RightRailSection>
              <hr />
              <RightRailSection
                title="Data Source"
                open={() => setDataSourceModalOpen(true)}
                canOpen={canEdit && !experiment.archived}
              >
                <RightRailSectionGroup title="Data Source" type="badge">
                  {experiment.datasource ? datasource?.name : "Manual"}
                </RightRailSectionGroup>
                <RightRailSectionGroup title="Tracking Key">
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
                      <Link href={`/metric/${m}`} key={m}>
                        <a className="badge badge-primary mr-2">
                          {getMetricById(m)?.name}
                        </a>
                      </Link>
                    );
                  })}
                </RightRailSectionGroup>
                {experiment.guardrails?.length > 0 && (
                  <RightRailSectionGroup title="Guardrails" type="custom">
                    {experiment.guardrails.map((m) => {
                      return (
                        <Link href={`/metric/${m}`} key={m}>
                          <a className="badge badge-primary mr-2">
                            {getMetricById(m)?.name}
                          </a>
                        </Link>
                      );
                    })}
                  </RightRailSectionGroup>
                )}
              </RightRailSection>
              <hr />
              <RightRailSection
                title="Targeting"
                open={() => setTargetingModalOpen(true)}
                canOpen={canEdit && !experiment.archived}
              >
                {datasource?.properties?.userIds && (
                  <RightRailSectionGroup title="Login State" type="badge">
                    {experiment.userIdType === "user" ? "User" : "Anonymous"}
                  </RightRailSectionGroup>
                )}
                <RightRailSectionGroup title="URL" type="code" empty="Any">
                  {experiment.targetURLRegex}
                </RightRailSectionGroup>
                {currentPhase?.groups?.length > 0 && (
                  <RightRailSectionGroup title="User Groups" type="badge">
                    {currentPhase?.groups}
                  </RightRailSectionGroup>
                )}
              </RightRailSection>
              {data.idea && <hr />}
              {data.idea && (
                <RightRailSection title="Linked Idea" canOpen={false}>
                  <div className="my-1">
                    {data.idea.impactScore && (
                      <div className="float-right text-right">
                        <div>
                          <small>Impact Score</small>
                        </div>
                        <div
                          className="badge badge-primary"
                          style={{ fontSize: "1.2em" }}
                        >
                          {data.idea.impactScore}
                          <small style={{ fontSize: "0.7em" }}>/100</small>
                        </div>
                      </div>
                    )}
                    <Link href={`/idea/${data.idea.id}`}>
                      <a>
                        <FaExternalLinkAlt /> {data.idea.text}
                      </a>
                    </Link>
                  </div>
                </RightRailSection>
              )}
            </div>
          </div>
        </Tab>
        <Tab
          display="Results"
          anchor="results"
          lazy={true}
          visible={experiment.status !== "draft"}
          padding={false}
        >
          <div className="position-relative">
            <Results
              experiment={experiment}
              editMetrics={() => setMetricsModalOpen(true)}
              editResult={() => setStopModalOpen(true)}
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
          <HistoryTable
            type="experiment"
            id={experiment.id}
            key={experiment.phases?.length}
          />
        </Tab>
      </Tabs>
    </div>
  );
};

export default ExperimentPage;
