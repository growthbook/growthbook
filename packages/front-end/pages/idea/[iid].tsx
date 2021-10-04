import { useRouter } from "next/router";
import { IdeaInterface } from "back-end/types/idea";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import { useState, ReactElement, useContext } from "react";
import { useAuth } from "../../services/auth";
import DeleteButton from "../../components/DeleteButton";
import {
  FaAngleLeft,
  FaArchive,
  FaChartLine,
  FaExternalLinkAlt,
} from "react-icons/fa";
import DiscussionThread from "../../components/DiscussionThread";
import useSwitchOrg from "../../services/useSwitchOrg";
import { UserContext } from "../../components/ProtectedPage";
import ImpactModal from "../../components/Ideas/ImpactModal";
import { date } from "../../services/dates";
import NewExperimentForm from "../../components/Experiment/NewExperimentForm";
import ViewQueryButton from "../../components/Metrics/ViewQueryButton";
import ImpactProjections from "../../components/Ideas/ImpactProjections";
import Link from "next/link";
import RightRailSection from "../../components/Layout/RightRailSection";
import RightRailSectionGroup from "../../components/Layout/RightRailSectionGroup";
import EditableH1 from "../../components/Forms/EditableH1";
import InlineForm from "../../components/Forms/InlineForm";
import MarkdownEditor from "../../components/Forms/MarkdownEditor";
import TagsInput from "../../components/TagsInput";
import MoreMenu from "../../components/Dropdown/MoreMenu";
import { ImpactEstimateInterface } from "back-end/types/impact-estimate";
import { useDefinitions } from "../../services/DefinitionsContext";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import StatusIndicator from "../../components/Experiment/StatusIndicator";
import { useForm } from "react-hook-form";
import { useEffect } from "react";
import Field from "../../components/Forms/Field";

const IdeaPage = (): ReactElement => {
  const router = useRouter();
  const { iid } = router.query;
  const [edit, setEdit] = useState(false);
  const [impactOpen, setImpactOpen] = useState(false);
  const [newExperiment, setNewExperiment] = useState(false);

  const {
    getMetricById,
    metrics,
    projects,
    getSegmentById,
    refreshTags,
    getProjectById,
  } = useDefinitions();

  const { permissions, getUserDisplay } = useContext(UserContext);

  const { apiCall } = useAuth();

  const { push } = useRouter();

  const { data, error: dataError, mutate } = useApi<{
    status: number;
    message: string;
    idea: IdeaInterface;
    estimate?: ImpactEstimateInterface;
    experiment?: Partial<ExperimentInterfaceStringDates>;
  }>(`/idea/${iid}`);

  useSwitchOrg(data?.idea?.organization);

  const form = useForm<{
    text: string;
    tags: string[];
    details: string;
    project: string;
  }>();
  useEffect(() => {
    if (data?.idea) {
      form.setValue("text", data.idea.text || "");
      form.setValue("tags", data.idea.tags || []);
      form.setValue("details", data.idea.details || "");
      form.setValue("project", data.idea.project || "");
    }
  }, [data]);

  if (dataError) {
    return (
      <div className="alert alert-danger">
        There was a problem loading this idea
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  // TODO: support non-binomial and manual metrics
  const canEstimateImpact =
    metrics.filter((m) => m.type === "binomial" && m.datasource).length > 0;

  const idea = data.idea;
  const estimate = data.estimate;

  return (
    <div className="container-fluid pagecontents pt-4">
      <div className="mb-2 row d-flex">
        <div className="col-auto">
          <Link href="/ideas">
            <a>
              <FaAngleLeft /> All Ideas
            </a>
          </Link>
        </div>
        {idea.archived && (
          <div className="col-auto">
            <div
              className="badge badge-secondary"
              style={{ fontSize: "1.1em" }}
            >
              Archived
            </div>
          </div>
        )}
        <div className="col"></div>
        {!idea.archived && permissions.draftExperiments && !data.experiment && (
          <div className="col-md-auto">
            <button
              className="btn btn-outline-primary mr-3"
              onClick={() => {
                setNewExperiment(true);
              }}
            >
              Convert Idea to Experiment
            </button>
          </div>
        )}
        <div className="col-auto">
          <MoreMenu id="idea-more-menu">
            <a
              href="#"
              className="dropdown-item"
              onClick={async (e) => {
                e.preventDefault();
                await apiCall(`/idea/${iid}`, {
                  method: "POST",
                  body: JSON.stringify({
                    archived: !idea.archived,
                  }),
                });
                mutate({
                  ...data,
                  idea: {
                    ...data.idea,
                    archived: !idea.archived,
                  },
                });
              }}
            >
              <FaArchive /> {idea.archived ? "Unarchive" : "Archive"}
            </a>
            <DeleteButton
              displayName="Idea"
              link={true}
              className="dropdown-item text-dark"
              text="Delete"
              onClick={async () => {
                await apiCall<{ status: number; message?: string }>(
                  `/idea/${iid}`,
                  {
                    method: "DELETE",
                    body: JSON.stringify({ id: iid }),
                  }
                );

                push("/ideas");
              }}
            />
          </MoreMenu>
        </div>
        {canEstimateImpact && <div className="col-md-3"></div>}
      </div>
      {data.experiment && (
        <div className="bg-white border border-info p-3 mb-3">
          <div className="d-flex">
            <strong className="mr-3">Linked Experiment: </strong>
            <Link href={`/experiment/${data.experiment.id}`}>
              <a className="mr-3">
                <FaExternalLinkAlt /> {data.experiment.name}
              </a>
            </Link>
            <StatusIndicator
              status={data.experiment.status}
              archived={data.experiment.archived}
            />
          </div>
        </div>
      )}
      <div className="mb-3 row">
        <div className="col">
          <InlineForm
            className="mb-4"
            editing={edit}
            onSave={form.handleSubmit(async (value) => {
              await apiCall<{ status: number; message?: string }>(
                `/idea/${idea.id}`,
                {
                  method: "POST",
                  body: JSON.stringify(value),
                }
              );
              await mutate({
                ...data,
                idea: {
                  ...data.idea,
                  ...value,
                },
              });
              refreshTags(value.tags);
              setEdit(false);
            })}
            onStartEdit={() => {
              form.setValue("text", idea.text || "");
              form.setValue("tags", idea.tags || []);
              form.setValue("details", idea.details || "");
              form.setValue("project", idea.project || "");
            }}
            setEdit={setEdit}
          >
            {({ save, cancel }) => (
              <div className="bg-white p-3 border idea-wrap">
                <div className="row">
                  <div className="col">
                    <EditableH1
                      editing={edit}
                      className="mb-0 flex-grow-1"
                      autoFocus
                      label="Idea Text"
                      save={save}
                      cancel={cancel}
                      value={form.watch("text")}
                      onChange={(e) => form.setValue("text", e.target.value)}
                    />
                  </div>
                  {!edit && (
                    <div className="col-auto">
                      <button
                        className="btn btn-outline-secondary"
                        onClick={() => {
                          setEdit(true);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>

                {edit ? (
                  <div className="py-2">
                    <div className="form-group">
                      <label>Tags</label>
                      <TagsInput
                        value={form.watch("tags")}
                        onChange={(tags) => form.setValue("tags", tags)}
                      />
                    </div>
                    {projects.length > 0 && (
                      <Field
                        label="Project"
                        {...form.register("project")}
                        options={projects.map((p) => ({
                          display: p.name,
                          value: p.id,
                        }))}
                        initialOption="None"
                      />
                    )}
                  </div>
                ) : (
                  <div className="d-flex">
                    <div className="text-muted mb-4 mr-3">
                      <small>
                        Submitted by{" "}
                        <strong className="mr-1">
                          {getUserDisplay(idea.userId) || idea.userName}
                        </strong>
                        {idea.source && idea.source !== "web" && (
                          <span className="mr-1">via {idea.source}</span>
                        )}
                        on <strong>{date(idea.dateCreated)}</strong>
                      </small>
                    </div>
                    <div className="idea-tags text-muted mr-3">
                      <small>
                        Tags:{" "}
                        {idea.tags &&
                          Object.values(idea.tags).map((col) => (
                            <span
                              className="badge badge-secondary mr-2"
                              key={col}
                            >
                              {col}
                            </span>
                          ))}
                        {!idea.tags?.length && <em>None</em>}
                      </small>
                    </div>
                    <div className="text-muted mr-3">
                      <small>
                        Project:{" "}
                        <span className="badge badge-secondary">
                          {getProjectById(idea.project)?.name || "None"}
                        </span>
                      </small>
                    </div>
                  </div>
                )}

                <MarkdownEditor
                  defaultValue={idea.details || ""}
                  editing={edit}
                  label="More Details"
                  form={form}
                  name="details"
                  save={save}
                  cancel={cancel}
                />
              </div>
            )}
          </InlineForm>

          <div className="mb-3">
            <h3>Comments</h3>
            <DiscussionThread type="idea" id={idea.id} showTitle={true} />
          </div>
        </div>

        {canEstimateImpact && (
          <div className="col-md-3 pl-0">
            <div className="mb-3 bg-white p-3 border">
              <div
                className="p-2 border bg-impact text-light text-center"
                style={{ opacity: 0.99, margin: "0 auto" }}
              >
                <h5>Impact Score</h5>
                <div className="d-flex justify-content-center align-items-center">
                  <div
                    className="mr-2"
                    style={{ fontSize: "3.6em", lineHeight: "1.1em" }}
                  >
                    {idea.impactScore || "?"}
                  </div>
                  <div className="pt-3">/ 100</div>
                </div>
              </div>

              {(!idea.estimateParams || !estimate) && (
                <div className="mt-2 text-center">
                  <button
                    className="btn btn-outline-primary"
                    onClick={() => {
                      setImpactOpen(true);
                    }}
                  >
                    <FaChartLine /> Estimate Impact
                  </button>
                </div>
              )}

              <hr />
              <ImpactProjections
                estimateParams={idea.estimateParams}
                estimate={estimate}
                length={idea.experimentLength}
              />

              {idea.estimateParams && estimate && (
                <div>
                  <hr />
                  <RightRailSection
                    title="Parameters"
                    open={() => setImpactOpen(true)}
                    canOpen={true}
                  >
                    <RightRailSectionGroup title="Metric" type="badge">
                      {getMetricById(estimate?.metric)?.name}
                    </RightRailSectionGroup>
                    <RightRailSectionGroup title="URLs" type="code">
                      {estimate?.regex || ".*"}
                    </RightRailSectionGroup>
                    <RightRailSectionGroup
                      title="Number of Variations"
                      type="code"
                    >
                      {idea?.estimateParams?.numVariations || 2}
                    </RightRailSectionGroup>
                    <RightRailSectionGroup title="User Segment" type="badge">
                      {getSegmentById(estimate?.segment)?.name || "Everyone"}
                    </RightRailSectionGroup>
                    <RightRailSectionGroup
                      title="Expected Metric Change"
                      type="code"
                    >
                      +{idea?.estimateParams?.improvement || 10}%
                    </RightRailSectionGroup>
                  </RightRailSection>
                </div>
              )}

              {estimate?.query?.length > 0 && (
                <div>
                  <hr />
                  <ViewQueryButton
                    queries={[estimate.query]}
                    language={estimate.queryLanguage}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {impactOpen && (
        <ImpactModal
          estimate={estimate}
          idea={idea}
          mutate={mutate}
          close={() => setImpactOpen(false)}
        />
      )}
      {newExperiment && (
        <NewExperimentForm
          source="idea"
          idea={idea.id}
          onClose={() => setNewExperiment(false)}
          onCreate={async (id) => {
            await apiCall(`/idea/${iid}`, {
              method: "POST",
              body: JSON.stringify({
                archived: true,
              }),
            });
            router.push(`/experiment/${id}`);
          }}
          includeDescription={!!idea.details}
          initialNumVariations={idea.estimateParams?.numVariations || 2}
          initialValue={{
            name: idea.text,
            description: idea.details,
            tags: idea.tags,
            project: idea.project || "",
            targetURLRegex: data?.estimate?.regex || "",
            datasource: data?.estimate?.metric
              ? getMetricById(data?.estimate?.metric)?.datasource
              : undefined,
            metrics: data?.estimate?.metric ? [data?.estimate?.metric] : [],
          }}
        />
      )}
    </div>
  );
};

export default IdeaPage;
