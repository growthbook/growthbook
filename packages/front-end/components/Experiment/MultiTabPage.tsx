import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useState, ReactElement } from "react";
import {
  FaStop,
  FaPlay,
  FaPencilAlt,
  FaPalette,
  FaExternalLinkAlt,
} from "react-icons/fa";
import Link from "next/link";
import { IdeaInterface } from "back-end/types/idea";
import { useFeature } from "@growthbook/growthbook-react";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import Tabs from "@/components/Tabs/Tabs";
import Tab from "@/components/Tabs/Tab";
import StatusIndicator from "@/components/Experiment/StatusIndicator";
import { ago, datetime } from "@/services/dates";
import { formatTrafficSplit, phaseSummary } from "@/services/utils";
import Results from "@/components/Experiment/Results";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import DiscussionThread from "@/components/DiscussionThread";
import useSwitchOrg from "@/services/useSwitchOrg";
import WatchButton from "@/components/WatchButton";
import HistoryTable from "@/components/HistoryTable";
import EditDataSourceForm from "@/components/Experiment/EditDataSourceForm";
import EditTargetingForm from "@/components/Experiment/EditTargetingForm";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import RightRailSection from "@/components/Layout/RightRailSection";
import RightRailSectionGroup from "@/components/Layout/RightRailSectionGroup";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useDefinitions } from "@/services/DefinitionsContext";
import { GBCircleArrowLeft, GBEdit } from "@/components/Icons";
import Button from "@/components/Button";
import usePermissions from "@/hooks/usePermissions";
import { getExposureQuery } from "@/services/datasources";
import { useUser } from "@/services/UserContext";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import ExperimentReportsList from "@/components/Experiment/ExperimentReportsList";
import VariationBox from "@/components/Experiment/VariationBox";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  idea?: IdeaInterface;
  mutate: () => void;
  editMetrics?: () => void;
  editResult?: () => void;
  editInfo?: () => void;
  editVariations?: () => void;
  duplicate?: () => void;
  editTags?: () => void;
  editProject?: () => void;
  newPhase?: () => void;
  editPhases?: () => void;
}

const MultiTabPage = ({
  experiment,
  idea,
  mutate,
  editMetrics,
  editResult,
  editInfo,
  editVariations,
  duplicate,
  editTags,
  editProject,
  newPhase,
  editPhases,
}: Props): ReactElement => {
  const router = useRouter();
  const [dataSourceModalOpen, setDataSourceModalOpen] = useState(false);
  const [targetingModalOpen, setTargetingModalOpen] = useState(false);

  const showTargeting = useFeature("show-experiment-targeting").on;

  const { apiCall } = useAuth();

  const watcherIds = useApi<{
    userIds: string[];
  }>(`/experiment/${experiment.id}/watchers`);

  const { users } = useUser();

  useSwitchOrg(experiment?.organization);

  const {
    getMetricById,
    getDatasourceById,
    projects,
    project,
    getProjectById,
  } = useDefinitions();
  const permissions = usePermissions();

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
          newPhase && newPhase();
        }}
      >
        <span className="h4 pr-2 m-0 d-inline-block align-top">
          <FaPlay />
        </span>{" "}
        Start
      </button>
    );
  } else if (experiment.status === "running" && editResult) {
    ctaButton = (
      <>
        <button
          type="button"
          className="btn btn-primary"
          onClick={(e) => {
            e.preventDefault();
            editResult();
          }}
        >
          <span className="h4 pr-2 m-0 d-inline-block align-top">
            <FaStop />
          </span>{" "}
          Stop Experiment
        </button>
      </>
    );
  }

  const currentPhase = experiment.phases[experiment.phases.length - 1];

  let wrapClasses = `container-fluid experiment-details exp-vars-${experiment.variations.length}`;
  if (experiment.variations.length <= 2) {
    wrapClasses += " pagecontents";
  } else if (experiment.variations.length > 2) {
    wrapClasses += " multivariations";
  }

  const canEdit = permissions.check("createAnalyses", experiment.project);

  const datasource = getDatasourceById(experiment.datasource);

  // Get name or email of all active users watching this experiment
  const usersWatching = (watcherIds?.data?.userIds || [])
    .map((id) => users.get(id))
    .filter(Boolean)
    .map((u) => u.name || u.email);

  return (
    <div className={wrapClasses}>
      {dataSourceModalOpen && (
        <EditDataSourceForm
          experiment={experiment}
          cancel={() => setDataSourceModalOpen(false)}
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
      {project && project !== experiment.project && (
        <div className="bg-secondary p-2 mb-2 text-center text-white">
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
      <div className="row mb-2">
        <div className="col-auto">
          <Link href="/experiments">
            <a>
              <GBCircleArrowLeft /> Back to all experiments
            </a>
          </Link>
        </div>
        <div style={{ flex: 1 }} />
        {canEdit && (
          <div className="col-auto">
            <MoreMenu>
              {duplicate && (
                <button className="dropdown-item" onClick={duplicate}>
                  duplicate
                </button>
              )}
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
              <DeleteButton
                className="dropdown-item"
                useIcon={false}
                text="delete"
                displayName="Experiment"
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
            </MoreMenu>
          </div>
        )}
        {permissions.check("createAnalyses", experiment.project) &&
          ctaButton && (
            <div className="experiment-actions col-auto">{ctaButton}</div>
          )}
      </div>
      <div className="row align-items-center mb-3">
        <h2 className="col-auto mb-0">
          {experiment.name}
          {editInfo && !experiment.archived && (
            <a className="ml-2 cursor-pointer" onClick={editInfo}>
              <GBEdit />
            </a>
          )}
        </h2>
        <StatusIndicator
          status={experiment.status}
          archived={experiment.archived}
          showBubble={true}
          className="mx-3 h4 mb-0"
        />
        {experiment.status === "stopped" && experiment.results && (
          <div className="col-auto">
            <ResultsIndicator results={experiment.results} />
          </div>
        )}
        <div style={{ flex: 1 }} />
        {currentPhase && experiment.status === "running" && (
          <div className="col-auto">
            {newPhase ? (
              <div
                onClick={(e) => {
                  e.preventDefault();
                  newPhase();
                }}
                className="cursor-pointer"
              >
                <span className="mr-2 purple-phase">
                  {phaseSummary(currentPhase)}
                </span>
                <FaPencilAlt />
              </div>
            ) : (
              <span className="text-muted">{phaseSummary(currentPhase)}</span>
            )}
          </div>
        )}

        {experiment.status === "draft" ? (
          <div className="col-auto">
            <span className="statuslabel">Created: </span>{" "}
            <span className="" title={datetime(experiment.dateCreated)}>
              {ago(experiment.dateCreated)}
            </span>
          </div>
        ) : (
          <>
            <div className="col-auto">
              <span className="statuslabel">Started: </span>{" "}
              <span className="" title={datetime(currentPhase?.dateStarted)}>
                {ago(currentPhase?.dateStarted)}
              </span>
            </div>
            {experiment.status !== "running" ? (
              <div className="col-auto">
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
        <div className="col-auto">
          <WatchButton item={experiment.id} itemType="experiment" type="link" />
        </div>
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
              {editInfo && !experiment.archived && (
                <button
                  className="btn btn-sm btn-outline-primary ml-2 float-right font-weight-bold"
                  onClick={editInfo}
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
                ) : editInfo ? (
                  <p>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        editInfo();
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
                <HeaderWithEdit edit={editVariations} className="h4">
                  Variations
                </HeaderWithEdit>
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
                    <VariationBox
                      key={i}
                      canEdit={canEdit && !experiment.archived}
                      experimentId={experiment.id}
                      i={i}
                      mutate={mutate}
                      v={v}
                      isVisual={experiment.implementation === "visual"}
                      className="col-md mx-2 p-0 mb-3"
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="col-md-3">
              {projects.length > 0 && (
                <>
                  <RightRailSection
                    title="Project"
                    open={() => editProject && editProject()}
                    canOpen={!!editProject}
                  >
                    <RightRailSectionGroup empty="None" type="commaList">
                      {getProjectById(experiment.project)?.name}
                    </RightRailSectionGroup>
                  </RightRailSection>
                  <hr />
                </>
              )}
              <RightRailSection
                title="Tags"
                open={() => editTags && editTags()}
                canOpen={!!editTags}
              >
                <RightRailSectionGroup type="tags">
                  {experiment.tags}
                </RightRailSectionGroup>
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
                open={() => editMetrics && editMetrics()}
                canOpen={editMetrics && !experiment.archived}
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
          visible={experiment.status !== "draft"}
          padding={false}
          key="Results"
        >
          <div className="position-relative">
            <Results
              experiment={experiment}
              editMetrics={editMetrics}
              editResult={editResult}
              editPhases={editPhases}
              mutateExperiment={mutate}
            />

            <div className="p-3">
              <ExperimentReportsList experiment={experiment} />
            </div>
          </div>
        </Tab>
        <Tab display="Discussion" anchor="discussions">
          <DiscussionThread
            type="experiment"
            id={experiment.id}
            allowNewComments={!experiment.archived}
            project={experiment.project}
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
                    {canEdit && permissions.check("runQueries", "") && (
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
  );
};

export default MultiTabPage;
