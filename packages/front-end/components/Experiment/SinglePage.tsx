import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useDefinitions } from "../../services/DefinitionsContext";
import MoreMenu from "../Dropdown/MoreMenu";
import WatchButton from "../WatchButton";
import StatusIndicator from "./StatusIndicator";
import SortedTags from "../Tags/SortedTags";
import MarkdownInlineEdit from "../Markdown/MarkdownInlineEdit";
import { useState } from "react";
import Results from "./Results";
import DiscussionThread from "../DiscussionThread";
import usePermissions from "../../hooks/usePermissions";
import { useAuth } from "../../services/auth";
import HeaderWithEdit from "../Layout/HeaderWithEdit";
import VariationBox from "./VariationBox";
import DeleteButton from "../DeleteButton";
import { useRouter } from "next/router";
import { GBEdit } from "../Icons";
import RightRailSection from "../Layout/RightRailSection";
import AnalysisForm from "./AnalysisForm";
import RightRailSectionGroup from "../Layout/RightRailSectionGroup";
import Link from "next/link";
import ExperimentReportsList from "./ExperimentReportsList";
import { useSnapshot } from "./SnapshotProvider";
import EditExperimentNameForm from "./EditExperimentNameForm";
import Modal from "../Modal";
import HistoryTable from "../HistoryTable";
import EditStatusModal from "./EditStatusModal";
import { FaLink } from "react-icons/fa";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  editMetrics?: () => void;
  editResult?: () => void;
  editVariations?: () => void;
  duplicate?: () => void;
  editTags?: () => void;
  editProject?: () => void;
  newPhase?: () => void;
}

export default function SinglePage({
  experiment,
  mutate,
  editMetrics,
  editResult,
  editVariations,
  duplicate,
  editTags,
  editProject,
  newPhase,
}: Props) {
  const {
    getProjectById,
    getDatasourceById,
    getSegmentById,
    getMetricById,
    projects,
  } = useDefinitions();

  const router = useRouter();

  const { phase: phaseIndex } = useSnapshot();

  const [reportSettingsOpen, setReportSettingsOpen] = useState(false);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [auditModal, setAuditModal] = useState(false);
  const [statusModal, setStatusModal] = useState(false);

  const permissions = usePermissions();
  const { apiCall } = useAuth();

  const project = getProjectById(experiment.project || "");
  const datasource = getDatasourceById(experiment.datasource);
  const segment = getSegmentById(experiment.segment || "");
  const activationMetric = getMetricById(experiment.activationMetric || "");

  const exposureQueries = datasource?.settings?.queries?.exposure || [];
  const exposureQuery = exposureQueries.find(
    (q) => q.id === experiment.exposureQueryId
  );

  const canEdit = permissions.createAnalyses && !experiment.archived;

  const variationCols = experiment.variations.length % 3 == 0 ? 4 : 6;

  return (
    <div className="container-fluid experiment-details pagecontents">
      {reportSettingsOpen && (
        <AnalysisForm
          cancel={() => setReportSettingsOpen(false)}
          experiment={experiment}
          mutate={mutate}
          phase={phaseIndex}
          editDates={false}
          editVariationIds={false}
        />
      )}
      {editNameOpen && (
        <EditExperimentNameForm
          experiment={experiment}
          mutate={mutate}
          cancel={() => setEditNameOpen(false)}
        />
      )}
      {auditModal && (
        <Modal
          open={true}
          header="Audit Log"
          close={() => setAuditModal(false)}
          size="lg"
          closeCta="Close"
        >
          <HistoryTable type="experiment" id={experiment.id} />
        </Modal>
      )}
      {statusModal && (
        <EditStatusModal
          experiment={experiment}
          close={() => setStatusModal(false)}
          mutate={mutate}
        />
      )}
      <div className="row align-items-center mb-1">
        <div className="col-auto">
          <h1 className="mb-0">{experiment.name}</h1>
        </div>
        <div className="col-auto">
          <StatusIndicator
            archived={experiment.archived}
            status={experiment.status}
          />
        </div>
        <div className="col-auto ml-auto">
          <WatchButton itemType="experiment" item={experiment.id} />
        </div>
        <div className="col-auto">
          <MoreMenu id="exp-more-menu">
            {canEdit && (
              <button
                className="dropdown-item"
                onClick={() => setEditNameOpen(true)}
              >
                edit name
              </button>
            )}
            {canEdit && (
              <button
                className="dropdown-item"
                onClick={() => setStatusModal(true)}
              >
                edit status
              </button>
            )}
            <button
              className="dropdown-item"
              onClick={() => setAuditModal(true)}
            >
              view audit log
            </button>
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
            <DeleteButton
              className="dropdown-item text-danger"
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
      </div>
      <div className="row align-items-center mb-4">
        {projects.length > 0 && (
          <div className="col-auto">
            Project:{" "}
            {project ? (
              <span className="badge badge-secondary">{project.name}</span>
            ) : (
              <em>None</em>
            )}{" "}
            {editProject && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  editProject();
                }}
              >
                <GBEdit />
              </a>
            )}
          </div>
        )}
        <div className="col-auto">
          Tags:{" "}
          {experiment.tags?.length > 0 ? (
            <SortedTags tags={experiment.tags} />
          ) : (
            <em>None</em>
          )}{" "}
          {editTags && (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                editTags();
              }}
            >
              <GBEdit />
            </a>
          )}
        </div>
      </div>
      <div className="row">
        <div className="col-md-9">
          <div className="appbox p-3 mb-4">
            <MarkdownInlineEdit
              value={experiment.description || experiment.observations}
              save={async (description) => {
                await apiCall(`/experiment/${experiment.id}`, {
                  method: "POST",
                  body: JSON.stringify({ description }),
                });
                mutate();
              }}
              canCreate={canEdit}
              canEdit={canEdit}
              className="mb-4"
              header="Description"
            />
            <MarkdownInlineEdit
              value={experiment.hypothesis}
              save={async (hypothesis) => {
                await apiCall(`/experiment/${experiment.id}`, {
                  method: "POST",
                  body: JSON.stringify({ hypothesis }),
                });
                mutate();
              }}
              canCreate={canEdit}
              canEdit={canEdit}
              className="mb-4"
              label="hypothesis"
              header="Hypothesis"
            />
            <HeaderWithEdit edit={editVariations}>Variations</HeaderWithEdit>
            <div className="row">
              {experiment.variations.map((v, i) => (
                <div key={i} className={`col-md-${variationCols} mb-2`}>
                  <VariationBox
                    canEdit={canEdit}
                    experimentId={experiment.id}
                    i={i}
                    mutate={mutate}
                    v={v}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <RightRailSection
            title="Analysis Settings"
            open={() => setReportSettingsOpen(true)}
            canOpen={canEdit}
          >
            <div className="appbox p-3">
              <RightRailSectionGroup title="Data Source" type="commaList">
                {datasource?.name}
              </RightRailSectionGroup>
              <RightRailSectionGroup title="Assignment Query" type="commaList">
                {exposureQuery?.name}
              </RightRailSectionGroup>
              <RightRailSectionGroup title="Experiment Id" type="commaList">
                {experiment.trackingKey}
              </RightRailSectionGroup>
              <RightRailSectionGroup
                title="Segment"
                type="commaList"
                empty="All Users"
              >
                {segment?.name}
              </RightRailSectionGroup>
              <RightRailSectionGroup title="Activation Metric" type="commaList">
                {activationMetric?.name}
              </RightRailSectionGroup>
            </div>
          </RightRailSection>
          <div className="mb-4"></div>
          <RightRailSection
            title="Metrics"
            open={() => editMetrics && editMetrics()}
            canOpen={editMetrics && !experiment.archived}
          >
            <div className="appbox p-3">
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
            </div>
          </RightRailSection>
        </div>
      </div>
      <div className="mb-4 position-relative">
        <div style={{ position: "absolute", top: -70 }} id="results"></div>
        <h3>
          Results{" "}
          <a
            href="#results"
            className="small"
            style={{ verticalAlign: "middle" }}
          >
            <FaLink />
          </a>
        </h3>
        <div className="appbox">
          {experiment.phases?.length > 0 ? (
            <Results
              experiment={experiment}
              mutateExperiment={mutate}
              editMetrics={editMetrics}
              editResult={editResult}
              alwaysShowPhaseSelector={true}
              reportDetailsLink={false}
            />
          ) : (
            <div className="text-center my-5">
              <p>There are no experiment phases yet.</p>
              <button className="btn btn-primary btn-lg" onClick={newPhase}>
                Add a Phase
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="mb-4">
        <ExperimentReportsList experiment={experiment} />
      </div>
      <div className="pb-3">
        <h2>Discussion</h2>
        <DiscussionThread
          type="experiment"
          id={experiment.id}
          allowNewComments={!experiment.archived}
        />
      </div>
    </div>
  );
}
