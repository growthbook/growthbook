import Link from "next/link";
import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import React, { useState } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { GBAddCircle, GBCircleArrowLeft, GBEdit } from "@/components/Icons";
import LoadingOverlay from "@/components/LoadingOverlay";
import useApi from "@/hooks/useApi";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import RuleModal from "@/components/Features/RuleModal";
import ForceSummary from "@/components/Features/ForceSummary";
import RuleList from "@/components/Features/RuleList";
import track from "@/services/track";
import EditDefaultValueModal from "@/components/Features/EditDefaultValueModal";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import EnvironmentToggle from "@/components/Features/EnvironmentToggle";
import { useDefinitions } from "@/services/DefinitionsContext";
import EditProjectForm from "@/components/Experiment/EditProjectForm";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import WatchButton from "@/components/WatchButton";
import {
  getFeatureDefaultValue,
  getRules,
  useEnvironmentState,
  useEnvironments,
  getEnabledEnvironments,
  getAffectedEnvs,
} from "@/services/features";
import Tab from "@/components/Tabs/Tab";
import FeatureImplementationModal from "@/components/Features/FeatureImplementationModal";
import SortedTags from "@/components/Tags/SortedTags";
import Modal from "@/components/Modal";
import HistoryTable from "@/components/HistoryTable";
import DraftModal from "@/components/Features/DraftModal";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import usePermissions from "@/hooks/usePermissions";
import DiscussionThread from "@/components/DiscussionThread";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import FeatureModal from "@/components/Features/FeatureModal";

export default function FeaturePage() {
  const router = useRouter();
  const { fid } = router.query;

  const [edit, setEdit] = useState(false);
  const [auditModal, setAuditModal] = useState(false);
  const [draftModal, setDraftModal] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState(false);
  const permissions = usePermissions();

  const [env, setEnv] = useEnvironmentState();

  const [ruleModal, setRuleModal] = useState<{
    i: number;
    environment: string;
    defaultType?: string;
  } | null>(null);
  const [editProjectModal, setEditProjectModal] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);

  const { getProjectById, projects } = useDefinitions();

  const { apiCall } = useAuth();

  const { data, error, mutate } = useApi<{
    feature: FeatureInterface;
    experiments: { [key: string]: ExperimentInterfaceStringDates };
    revisions: FeatureRevisionInterface[];
  }>(`/feature/${fid}`);
  const firstFeature = router?.query && "first" in router.query;
  const [showImplementation, setShowImplementation] = useState(firstFeature);
  const environments = useEnvironments();

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const type = data.feature.valueType;

  const isDraft = !!data.feature.draft?.active;
  const isArchived = data.feature.archived;

  const enabledEnvs = getEnabledEnvironments(data.feature);

  const project = data.feature.project;

  const hasDraftPublishPermission =
    isDraft &&
    permissions.check(
      "publishFeatures",
      project,
      "defaultValue" in data.feature.draft
        ? getEnabledEnvironments(data.feature)
        : getAffectedEnvs(
            data.feature,
            Object.keys(data.feature.draft?.rules || {})
          )
    );

  return (
    <div className="contents container-fluid pagecontents">
      {edit && (
        <EditDefaultValueModal
          close={() => setEdit(false)}
          feature={data.feature}
          mutate={mutate}
        />
      )}
      {editOwnerModal && (
        <EditOwnerModal
          cancel={() => setEditOwnerModal(false)}
          owner={data.feature.owner}
          save={async (owner) => {
            await apiCall(`/feature/${data.feature.id}`, {
              method: "PUT",
              body: JSON.stringify({ owner }),
            });
            mutate();
          }}
        />
      )}
      {ruleModal !== null && (
        <RuleModal
          feature={data.feature}
          close={() => setRuleModal(null)}
          i={ruleModal.i}
          environment={ruleModal.environment}
          mutate={mutate}
          defaultType={ruleModal.defaultType || ""}
        />
      )}
      {auditModal && (
        <Modal
          open={true}
          header="Audit Log"
          close={() => setAuditModal(false)}
          size="max"
          closeCta="Close"
        >
          <HistoryTable type="feature" id={data.feature.id} />
        </Modal>
      )}
      {editProjectModal && (
        <EditProjectForm
          apiEndpoint={`/feature/${data.feature.id}`}
          cancel={() => setEditProjectModal(false)}
          mutate={mutate}
          method="PUT"
          current={data.feature.project}
        />
      )}
      {editTagsModal && (
        <EditTagsForm
          tags={data.feature?.tags}
          save={async (tags) => {
            await apiCall(`/feature/${data.feature.id}`, {
              method: "PUT",
              body: JSON.stringify({ tags }),
            });
          }}
          cancel={() => setEditTagsModal(false)}
          mutate={mutate}
        />
      )}
      {showImplementation && (
        <FeatureImplementationModal
          feature={data.feature}
          first={firstFeature}
          close={() => {
            setShowImplementation(false);
          }}
        />
      )}
      {draftModal && (
        <DraftModal
          feature={data.feature}
          close={() => setDraftModal(false)}
          mutate={mutate}
        />
      )}
      {duplicateModal && (
        <FeatureModal
          cta={"Duplicate"}
          close={() => setDuplicateModal(false)}
          onSuccess={async (feature) => {
            const url = `/features/${feature.id}`;
            router.push(url);
          }}
          featureToDuplicate={data.feature}
        />
      )}

      {isDraft && (
        <div
          className="alert alert-warning mb-3 text-center shadow-sm"
          style={{ top: 65, position: "sticky", zIndex: 900 }}
        >
          <FaExclamationTriangle className="text-warning" /> This feature has
          unpublished changes.
          <button
            className="btn btn-primary ml-3 btn-sm"
            onClick={(e) => {
              e.preventDefault();
              setDraftModal(true);
            }}
          >
            Review{hasDraftPublishPermission && " and Publish"}
          </button>
        </div>
      )}

      <div className="row align-items-center mb-2">
        <div className="col-auto">
          <Link href="/features">
            <a>
              <GBCircleArrowLeft /> Back to all features
            </a>
          </Link>
        </div>
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          <RevisionDropdown
            feature={data.feature}
            revisions={data.revisions || []}
            publish={() => {
              setDraftModal(true);
            }}
            mutate={mutate}
          />
        </div>
        <div className="col-auto">
          <MoreMenu>
            <a
              className="dropdown-item"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setShowImplementation(true);
              }}
            >
              Show implementation
            </a>
            {permissions.check("manageFeatures", project) &&
              permissions.check("publishFeatures", project, enabledEnvs) && (
                <a
                  className="dropdown-item"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setDuplicateModal(true);
                  }}
                >
                  Duplicate feature
                </a>
              )}
            {permissions.check("manageFeatures", project) &&
              permissions.check("publishFeatures", project, enabledEnvs) && (
                <DeleteButton
                  useIcon={false}
                  displayName="Feature"
                  onClick={async () => {
                    await apiCall(`/feature/${data.feature.id}`, {
                      method: "DELETE",
                    });
                    router.push("/features");
                  }}
                  className="dropdown-item"
                  text="Delete feature"
                />
              )}
            {permissions.check("manageFeatures", project) &&
              permissions.check("publishFeatures", project, enabledEnvs) && (
                <ConfirmButton
                  onClick={async () => {
                    await apiCall(`/feature/${data.feature.id}/archive`, {
                      method: "POST",
                    });
                    mutate();
                  }}
                  modalHeader={
                    isArchived ? "Unarchive Feature" : "Archive Feature"
                  }
                  confirmationText={
                    isArchived ? (
                      <>
                        <p>
                          Are you sure you want to continue? This will make the
                          current feature active again.
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          Are you sure you want to continue? This will make the
                          current feature inactive. It will not be included in
                          API responses or Webhook payloads.
                        </p>
                      </>
                    )
                  }
                  cta={isArchived ? "Unarchive" : "Archive"}
                  ctaColor="danger"
                >
                  <button className="dropdown-item">
                    {isArchived ? "Unarchive" : "Archive"} feature
                  </button>
                </ConfirmButton>
              )}
          </MoreMenu>
        </div>
      </div>

      <div>
        {isArchived && (
          <div className="alert alert-secondary mb-2">
            <strong>This feature is archived.</strong> It will not be included
            in SDK Endpoints or Webhook payloads.
          </div>
        )}
      </div>

      <div className="row align-items-center mb-2">
        <h1 className="col-auto mb-0">{fid}</h1>
      </div>

      <div className="mb-2 row" style={{ fontSize: "0.8em" }}>
        {projects.length > 0 && (
          <div className="col-auto">
            Project:{" "}
            {data.feature.project ? (
              <span className="badge badge-secondary">
                {getProjectById(data.feature.project)?.name || "unknown"}
              </span>
            ) : (
              <em className="text-muted">none</em>
            )}
            {permissions.check("manageFeatures", project) &&
              permissions.check("publishFeatures", project, enabledEnvs) && (
                <a
                  className="ml-2 cursor-pointer"
                  onClick={() => setEditProjectModal(true)}
                >
                  <GBEdit />
                </a>
              )}
          </div>
        )}

        <div className="col-auto">
          Tags: <SortedTags tags={data.feature?.tags || []} />
          {permissions.check("manageFeatures", project) && (
            <a
              className="ml-1 cursor-pointer"
              onClick={() => setEditTagsModal(true)}
            >
              <GBEdit />
            </a>
          )}
        </div>

        <div className="col-auto">
          Type: {data.feature.valueType || "unknown"}
        </div>

        <div className="col-auto">
          Owner: {data.feature.owner ? data.feature.owner : "None"}
          {permissions.check("manageFeatures", project) && (
            <a
              className="ml-1 cursor-pointer"
              onClick={() => setEditOwnerModal(true)}
            >
              <GBEdit />
            </a>
          )}
        </div>

        <div className="col-auto ml-auto">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setAuditModal(true);
            }}
          >
            View Audit Log
          </a>
        </div>
        <div className="col-auto">
          <WatchButton item={data.feature.id} itemType="feature" type="link" />
        </div>
      </div>

      <div className="mb-3">
        <div className={data.feature.description ? "appbox mb-4 p-3" : ""}>
          <MarkdownInlineEdit
            value={data.feature.description}
            canEdit={permissions.check("manageFeatures", project)}
            canCreate={permissions.check("manageFeatures", project)}
            save={async (description) => {
              await apiCall(`/feature/${data.feature.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  description,
                }),
              });
              track("Update Feature Description");
              mutate();
            }}
          />
        </div>
      </div>

      <h3>Enabled Environments</h3>
      <div className="appbox mb-4 p-3">
        <div className="row mb-2">
          {environments.map((en) => (
            <div className="col-auto" key={en.id}>
              <label
                className="font-weight-bold mr-2"
                htmlFor={`${en.id}_toggle`}
              >
                {en.id}:{" "}
              </label>
              <EnvironmentToggle
                feature={data.feature}
                environment={en.id}
                mutate={mutate}
                id={`${en.id}_toggle`}
              />
            </div>
          ))}
        </div>
        <div>
          In a disabled environment, the feature will always evaluate to{" "}
          <code>null</code>. The default value and override rules will be
          ignored.
        </div>
      </div>

      <h3>
        Default Value
        {permissions.check("createFeatureDrafts", project) && (
          <a className="ml-2 cursor-pointer" onClick={() => setEdit(true)}>
            <GBEdit />
          </a>
        )}
      </h3>
      <div className="appbox mb-4 p-3">
        <ForceSummary
          type={type}
          value={getFeatureDefaultValue(data.feature)}
        />
      </div>

      <h3>Override Rules</h3>
      <p>
        Add powerful logic on top of your feature. The first matching rule
        applies and overrides the default value.
      </p>

      <ControlledTabs
        setActive={setEnv}
        active={env}
        showActiveCount={true}
        newStyle={false}
        buttonsClassName="px-3 py-2 h4"
      >
        {environments.map((e) => {
          const rules = getRules(data.feature, e.id);
          return (
            <Tab
              key={e.id}
              id={e.id}
              display={e.id}
              count={rules.length}
              padding={false}
            >
              <div className="appbox mb-4 border-top-0">
                {rules.length > 0 ? (
                  <RuleList
                    environment={e.id}
                    feature={data.feature}
                    experiments={data.experiments || {}}
                    mutate={mutate}
                    setRuleModal={setRuleModal}
                  />
                ) : (
                  <div className="p-3">
                    <em>No override rules for this environment yet</em>
                  </div>
                )}
              </div>
            </Tab>
          );
        })}
      </ControlledTabs>

      {permissions.check("createFeatureDrafts", project) && (
        <div className="row">
          <div className="col mb-3">
            <div
              className="bg-white border p-3 d-flex flex-column"
              style={{ height: "100%" }}
            >
              <h4>Forced Value</h4>
              <p>Target groups of users and give them all the same value.</p>
              <div style={{ flex: 1 }} />
              <div>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setRuleModal({
                      environment: env,
                      i: getRules(data.feature, env).length,
                      defaultType: "force",
                    });
                    track("Viewed Rule Modal", {
                      source: "add-rule",
                      type: "force",
                    });
                  }}
                >
                  <span className="h4 pr-2 m-0 d-inline-block align-top">
                    <GBAddCircle />
                  </span>
                  Add Forced Rule
                </button>
              </div>
            </div>
          </div>
          <div className="col mb-3">
            <div
              className="bg-white border p-3 d-flex flex-column"
              style={{ height: "100%" }}
            >
              <h4>Percentage Rollout</h4>
              <p>Release to a small percent of users while you monitor logs.</p>
              <div style={{ flex: 1 }} />
              <div>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setRuleModal({
                      environment: env,
                      i: getRules(data.feature, env).length,
                      defaultType: "rollout",
                    });
                    track("Viewed Rule Modal", {
                      source: "add-rule",
                      type: "rollout",
                    });
                  }}
                >
                  <span className="h4 pr-2 m-0 d-inline-block align-top">
                    <GBAddCircle />
                  </span>
                  Add Rollout Rule
                </button>
              </div>
            </div>
          </div>
          <div className="col mb-3">
            <div
              className="bg-white border p-3 d-flex flex-column"
              style={{ height: "100%" }}
            >
              <h4>A/B Experiment</h4>
              <p>Measure the impact of this feature on your key metrics.</p>
              <div style={{ flex: 1 }} />
              <div>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setRuleModal({
                      environment: env,
                      i: getRules(data.feature, env).length,
                      defaultType: "experiment",
                    });
                    track("Viewed Rule Modal", {
                      source: "add-rule",
                      type: "experiment",
                    });
                  }}
                >
                  <span className="h4 pr-2 m-0 d-inline-block align-top">
                    <GBAddCircle />
                  </span>
                  Add Experiment Rule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4">
        <h3>Comments</h3>
        <DiscussionThread
          type="feature"
          id={data.feature.id}
          project={data.feature.project}
        />
      </div>
    </div>
  );
}
