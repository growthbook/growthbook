import { useRouter } from "next/router";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import React, { useEffect, useMemo, useState } from "react";
import {
  FaChevronRight,
  FaDraftingCompass,
  FaExchangeAlt,
  FaExclamationTriangle,
  FaLink,
  FaList,
  FaLock,
  FaTimes,
} from "react-icons/fa";
import { ago, date, datetime } from "shared/dates";
import {
  autoMerge,
  evaluatePrerequisiteState,
  getDependentExperiments,
  getDependentFeatures,
  getValidation,
  isFeatureStale,
  mergeResultHasChanges,
  mergeRevision,
  PrerequisiteStateResult,
} from "shared/util";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { MdHistory, MdRocketLaunch } from "react-icons/md";
import { FaPlusMinus } from "react-icons/fa6";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import clsx from "clsx";
import { BsClock } from "react-icons/bs";
import { BiHide, BiShow } from "react-icons/bi";
import { ImBlocked } from "react-icons/im";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { GBAddCircle, GBEdit } from "@/components/Icons";
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
  getAffectedRevisionEnvs,
  useFeaturesList,
  getPrerequisites,
} from "@/services/features";
import AssignmentTester from "@/components/Archetype/AssignmentTester";
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
import Tooltip from "@/components/Tooltip/Tooltip";
import EditSchemaModal from "@/components/Features/EditSchemaModal";
import Code from "@/components/SyntaxHighlighting/Code";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import PageHead from "@/components/Layout/PageHead";
import AuditUser from "@/components/Avatar/AuditUser";
import RevertModal from "@/components/Features/RevertModal";
import EditRevisionCommentModal from "@/components/Features/EditRevisionCommentModal";
import FixConflictsModal from "@/components/Features/FixConflictsModal";
import Revisionlog from "@/components/Features/RevisionLog";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { SimpleTooltip } from "@/components/SimpleTooltip/SimpleTooltip";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import StaleDetectionModal from "@/components/Features/StaleDetectionModal";
import useOrgSettings from "@/hooks/useOrgSettings";
import RequestReviewModal from "@/components/Features/RequestReviewModal";
import PrerequisiteModal from "@/components/Features/PrerequisiteModal";
import PrerequisiteStatusRow, {
  PrerequisiteStatesCols,
} from "@/components/Features/PrerequisiteStatusRow";
import { useExperiments } from "@/hooks/useExperiments";
import { PrerequisiteAlerts } from "@/components/Features/PrerequisiteTargetingField";

export default function FeaturePage() {
  const router = useRouter();
  const { fid } = router.query;

  const [edit, setEdit] = useState(false);
  const [editValidator, setEditValidator] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [auditModal, setAuditModal] = useState(false);
  const [reviewModal, setReviewModal] = useState(false);
  const [draftModal, setDraftModal] = useState(false);
  const [conflictModal, setConflictModal] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [logModal, setLogModal] = useState(false);
  const [staleFFModal, setStaleFFModal] = useState(false);
  const permissions = usePermissions();

  const [revertIndex, setRevertIndex] = useState(0);

  const [env, setEnv] = useEnvironmentState();

  const [ruleModal, setRuleModal] = useState<{
    i: number;
    environment: string;
    defaultType?: string;
  } | null>(null);
  const [prerequisiteModal, setPrerequisiteModal] = useState<{
    i: number;
  } | null>(null);
  const [editProjectModal, setEditProjectModal] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);
  const [editCommentModel, setEditCommentModal] = useState(false);

  const {
    getProjectById,
    project: currentProject,
    projects,
  } = useDefinitions();

  const { apiCall } = useAuth();
  const { hasCommercialFeature, organization } = useUser();

  const [version, setVersion] = useState<number | null>(null);
  const settings = useOrgSettings();
  const requireReviews = !!settings?.requireReviews;

  let extraQueryString = "";
  // Version being forced via querystring
  if ("v" in router.query) {
    const v = parseInt(router.query.v as string);
    if (v) {
      extraQueryString = `?v=${v}`;
    }
  }

  const { data, error, mutate } = useApi<{
    feature: FeatureInterface;
    revisions: FeatureRevisionInterface[];
    experiments: ExperimentInterfaceStringDates[];
  }>(`/feature/${fid}${extraQueryString}`);
  const firstFeature = router?.query && "first" in router.query;
  const [showImplementation, setShowImplementation] = useState(firstFeature);

  const [showDependents, setShowDependents] = useState(false);

  const { features } = useFeaturesList(false);
  const { experiments } = useExperiments();
  const environments = useEnvironments();
  const envs = environments.map((e) => e.id);

  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 800,
  });

  const experimentsMap = useMemo(() => {
    if (!data?.experiments) return new Map();

    return new Map<string, ExperimentInterfaceStringDates>(
      data.experiments.map((exp) => [exp.id, exp])
    );
  }, [data?.experiments]);

  useEffect(() => {
    if (!data) return;
    if (version) return;

    // Version being forced via querystring
    if ("v" in router.query) {
      const v = parseInt(router.query.v as string);
      if (v && data.revisions.some((r) => r.version === v)) {
        setVersion(v);
        return;
      }
    }

    // If there's an active draft, show that by default, otherwise show the live version
    const draft = data.revisions.find(
      (r) =>
        r.status === "draft" ||
        r.status === "approved" ||
        r.status === "changes-requested" ||
        r.status === "pending-review"
    );
    setVersion(draft ? draft.version : data.feature.version);
  }, [data, version, router.query]);

  const revision = useMemo<FeatureRevisionInterface | null>(() => {
    if (!data || !version) return null;
    const match = data.revisions.find((r) => r.version === version);
    if (match) return match;

    // If we can't find the revision, create a dummy revision just so the page can render
    // This is for old features that don't have any revision history saved
    const rules: Record<string, FeatureRule[]> = {};
    environments.forEach((env) => {
      rules[env.id] = data.feature.environmentSettings?.[env.id]?.rules || [];
    });

    return {
      baseVersion: data.feature.version,
      comment: "",
      createdBy: null,
      dateCreated: data.feature.dateCreated,
      datePublished: data.feature.dateCreated,
      dateUpdated: data.feature.dateUpdated,
      defaultValue: data.feature.defaultValue,
      featureId: data.feature.id,
      organization: data.feature.organization,
      publishedBy: null,
      rules: rules,
      prerequisites: data.feature.prerequisites || [],
      status: "published",
      version: data.feature.version,
    };
  }, [data, version, environments]);

  const feature = useMemo(() => {
    if (!revision || !data) return null;
    return revision.version !== data.feature.version
      ? mergeRevision(
          data.feature,
          revision,
          environments.map((e) => e.id)
        )
      : data.feature;
  }, [data, revision, environments]);

  const prerequisites = feature?.prerequisites || [];
  const prereqStates = useMemo(() => {
    if (!feature) return null;
    const states: Record<string, PrerequisiteStateResult> = {};
    envs.forEach((env) => {
      states[env] = evaluatePrerequisiteState(feature, features, env, true);
    });
    return states;
  }, [feature, features, envs]);

  const dependentFeatures = useMemo(() => {
    if (!feature || !features) return [];
    return getDependentFeatures(feature, features, envs);
  }, [feature, features, envs]);

  const dependentExperiments = useMemo(() => {
    if (!feature || !experiments) return [];
    return getDependentExperiments(feature, experiments);
  }, [feature, experiments]);

  const dependents = dependentFeatures.length + dependentExperiments.length;

  const hasConditionalState =
    prereqStates &&
    Object.values(prereqStates).some((s) => s.state === "conditional");

  const hasPrerequisitesCommercialFeature = hasCommercialFeature(
    "prerequisites"
  );

  const mergeResult = useMemo(() => {
    if (!data || !feature || !revision) return null;
    const baseRevision = data.revisions.find(
      (r) => r.version === revision?.baseVersion
    );
    const liveRevision = data.revisions.find(
      (r) => r.version === feature.version
    );
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevision,
      baseRevision,
      revision,
      environments.map((e) => e.id),
      {}
    );
  }, [data, revision, feature, environments]);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data || !feature || !revision) {
    return <LoadingOverlay />;
  }

  const currentVersion = version || data.feature.version;

  const { jsonSchema, validationEnabled, schemaDateUpdated } = getValidation(
    feature
  );

  const isDraft = revision?.status === "draft";
  const isPendingReview =
    revision?.status === "pending-review" ||
    revision?.status === "changes-requested";
  const approved = revision?.status === "approved";
  const isLive = revision?.version === feature.version;
  const isArchived = feature.archived;

  const revisionHasChanges =
    !!mergeResult && mergeResultHasChanges(mergeResult);

  const enabledEnvs = getEnabledEnvironments(feature, environments);
  const hasJsonValidator = hasCommercialFeature("json-validation");

  const projectId = feature.project;
  const project = getProjectById(projectId || "");
  const projectName = project?.name || null;
  const projectIsDeReferenced = projectId && !projectName;

  const schemaDescription = new Map();
  if (jsonSchema && "properties" in jsonSchema) {
    Object.keys(jsonSchema.properties).map((key) => {
      schemaDescription.set(key, { required: false, describes: true });
    });
  }
  if (jsonSchema && "required" in jsonSchema) {
    Object.values(jsonSchema.required).map((key) => {
      if (schemaDescription.has(key)) {
        schemaDescription.set(key, { required: true, describes: true });
      } else {
        schemaDescription.set(key, { required: true, describes: false });
      }
    });
  }
  const schemaDescriptionItems = [...schemaDescription.keys()];

  const hasDraftPublishPermission =
    approved ||
    (isDraft &&
      !requireReviews &&
      permissions.check(
        "publishFeatures",
        projectId,
        getAffectedRevisionEnvs(data.feature, revision, environments)
      ));

  const drafts = data.revisions.filter(
    (r) =>
      r.status === "draft" ||
      r.status === "pending-review" ||
      r.status === "changes-requested" ||
      r.status === "approved"
  );

  const isLocked =
    (revision.status === "published" || revision.status === "discarded") &&
    (!isLive || drafts.length > 0);

  const canEdit = permissions.check("manageFeatures", projectId);
  const canEditDrafts = permissions.check(
    "createFeatureDrafts",
    feature.project
  );

  const { stale, reason } = isFeatureStale(feature, data.experiments);
  const renderDraftBannerCopy = () => {
    if (isPendingReview) {
      return (
        <>
          <BsClock /> Awaiting Approval
        </>
      );
    }
    if (approved) {
      return (
        <>
          <MdRocketLaunch /> Review and Publish
        </>
      );
    }
    return (
      <>
        <MdRocketLaunch /> Request Approval to Publish
      </>
    );
  };
  return (
    <div className="contents container-fluid pagecontents">
      {edit && (
        <EditDefaultValueModal
          close={() => setEdit(false)}
          feature={feature}
          mutate={mutate}
          version={currentVersion}
          setVersion={setVersion}
        />
      )}
      {editOwnerModal && (
        <EditOwnerModal
          cancel={() => setEditOwnerModal(false)}
          owner={feature.owner}
          save={async (owner) => {
            await apiCall(`/feature/${feature.id}`, {
              method: "PUT",
              body: JSON.stringify({ owner }),
            });
            mutate();
          }}
        />
      )}
      {editValidator && (
        <EditSchemaModal
          close={() => setEditValidator(false)}
          feature={feature}
          mutate={mutate}
        />
      )}
      {ruleModal !== null && (
        <RuleModal
          feature={feature}
          close={() => setRuleModal(null)}
          i={ruleModal.i}
          environment={ruleModal.environment}
          mutate={mutate}
          defaultType={ruleModal.defaultType || ""}
          revisions={data.revisions}
          version={currentVersion}
          setVersion={setVersion}
        />
      )}
      {prerequisiteModal !== null && (
        <PrerequisiteModal
          feature={feature}
          close={() => setPrerequisiteModal(null)}
          i={prerequisiteModal.i}
          mutate={mutate}
          revisions={data.revisions}
          version={currentVersion}
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
          <HistoryTable type="feature" id={feature.id} />
        </Modal>
      )}
      {editProjectModal && (
        <EditProjectForm
          apiEndpoint={`/feature/${feature.id}`}
          cancel={() => setEditProjectModal(false)}
          mutate={mutate}
          method="PUT"
          current={feature.project}
          additionalMessage={
            feature.linkedExperiments?.length ? (
              <div className="alert alert-danger">
                Changing the project may prevent your linked Experiments from
                being sent to users.
              </div>
            ) : null
          }
        />
      )}
      {revertIndex > 0 && (
        <RevertModal
          close={() => setRevertIndex(0)}
          feature={data.feature}
          revision={
            data.revisions.find(
              (r) => r.version === revertIndex
            ) as FeatureRevisionInterface
          }
          mutate={mutate}
          setVersion={setVersion}
        />
      )}
      {logModal && revision && (
        <Modal
          open={true}
          close={() => setLogModal(false)}
          header="Revision Log"
          closeCta={"Close"}
          size="lg"
        >
          <h3>Revision {revision.version}</h3>
          <Revisionlog feature={feature} revision={revision} />
        </Modal>
      )}
      {editTagsModal && (
        <EditTagsForm
          tags={feature.tags || []}
          save={async (tags) => {
            await apiCall(`/feature/${feature.id}`, {
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
          feature={feature}
          first={firstFeature}
          close={() => {
            setShowImplementation(false);
          }}
        />
      )}
      {reviewModal && revision && (
        <RequestReviewModal
          feature={data.feature}
          revisions={data.revisions}
          version={revision.version}
          close={() => setReviewModal(false)}
          mutate={mutate}
          onDiscard={() => {
            // When discarding a draft, switch back to the live version
            setVersion(feature.version);
          }}
        />
      )}
      {draftModal && revision && (
        <DraftModal
          feature={data.feature}
          revisions={data.revisions}
          version={revision.version}
          close={() => setDraftModal(false)}
          mutate={mutate}
          onDiscard={() => {
            // When discarding a draft, switch back to the live version
            setVersion(feature.version);
          }}
        />
      )}
      {conflictModal && revision && (
        <FixConflictsModal
          feature={data.feature}
          revisions={data.revisions}
          version={revision.version}
          close={() => setConflictModal(false)}
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
          featureToDuplicate={feature}
        />
      )}
      {confirmDiscard && (
        <Modal
          open={true}
          close={() => setConfirmDiscard(false)}
          header="Discard Draft"
          cta={"Discard"}
          submitColor="danger"
          closeCta={"Cancel"}
          submit={async () => {
            try {
              await apiCall(
                `/feature/${feature.id}/${revision.version}/discard`,
                {
                  method: "POST",
                }
              );
            } catch (e) {
              await mutate();
              throw e;
            }
            await mutate();
            setVersion(feature.version);
          }}
        >
          <p>
            Are you sure you want to discard this draft? This action cannot be
            undone.
          </p>
        </Modal>
      )}
      {editCommentModel && revision && (
        <EditRevisionCommentModal
          close={() => setEditCommentModal(false)}
          feature={feature}
          mutate={mutate}
          revision={revision}
        />
      )}

      {staleFFModal && (
        <StaleDetectionModal
          close={() => setStaleFFModal(false)}
          feature={feature}
          mutate={mutate}
        />
      )}

      <PageHead
        breadcrumb={[
          { display: "Features", href: "/features" },
          { display: feature.id },
        ]}
      />

      {projectId ===
        getDemoDatasourceProjectIdForOrganization(organization.id) && (
        <div className="alert alert-info mb-3 d-flex align-items-center">
          <div className="flex-1">
            This feature is part of our sample dataset and shows how Feature
            Flags and Experiments can be linked together. You can delete this
            once you are done exploring.
          </div>
          <div style={{ width: 180 }} className="ml-2">
            <DeleteDemoDatasourceButton
              onDelete={() => router.push("/features")}
              source="feature"
            />
          </div>
        </div>
      )}

      <div className="row align-items-center mb-2">
        <div className="col-auto d-flex align-items-center">
          <h1 className="mb-0">{fid}</h1>
          {stale && (
            <div className="ml-2">
              <StaleFeatureIcon
                staleReason={reason}
                onClick={() => setStaleFFModal(true)}
              />
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
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
            {canEdit &&
              permissions.check("publishFeatures", projectId, enabledEnvs) && (
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
            {canEdit &&
              permissions.check("publishFeatures", projectId, enabledEnvs) && (
                <Tooltip
                  shouldDisplay={dependents > 0}
                  usePortal={true}
                  body={
                    <>
                      <ImBlocked className="text-danger" /> This feature has{" "}
                      <strong>
                        {dependents} dependent{dependents !== 1 && "s"}
                      </strong>
                      . This feature cannot be deleted until{" "}
                      {dependents === 1 ? "it has" : "they have"} been removed.
                    </>
                  }
                >
                  <DeleteButton
                    useIcon={false}
                    displayName="Feature"
                    onClick={async () => {
                      await apiCall(`/feature/${feature.id}`, {
                        method: "DELETE",
                      });
                      router.push("/features");
                    }}
                    className="dropdown-item"
                    text="Delete feature"
                    disabled={dependents > 0}
                  />
                </Tooltip>
              )}
            {canEdit &&
              permissions.check("publishFeatures", projectId, enabledEnvs) && (
                <Tooltip
                  shouldDisplay={dependents > 0}
                  usePortal={true}
                  body={
                    <>
                      <ImBlocked className="text-danger" /> This feature has{" "}
                      <strong>
                        {dependents} dependent{dependents !== 1 && "s"}
                      </strong>
                      . This feature cannot be archived until{" "}
                      {dependents === 1 ? "it has" : "they have"} been removed.
                    </>
                  }
                >
                  <ConfirmButton
                    onClick={async () => {
                      await apiCall(`/feature/${feature.id}/archive`, {
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
                            Are you sure you want to continue? This will make
                            the current feature active again.
                          </p>
                        </>
                      ) : (
                        <>
                          <p>
                            Are you sure you want to continue? This will make
                            the current feature inactive. It will not be
                            included in API responses or Webhook payloads.
                          </p>
                        </>
                      )
                    }
                    cta={isArchived ? "Unarchive" : "Archive"}
                    ctaColor="danger"
                    disabled={dependents > 0}
                  >
                    <button className="dropdown-item">
                      {isArchived ? "Unarchive" : "Archive"} feature
                    </button>
                  </ConfirmButton>
                </Tooltip>
              )}
            {canEdit && (
              <a
                className="dropdown-item"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setStaleFFModal(true);
                }}
              >
                {feature.neverStale
                  ? "Enable stale detection"
                  : "Disable stale detection"}
              </a>
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

      <div className="mb-2 row">
        {(projects.length > 0 || projectIsDeReferenced) && (
          <div className="col-auto">
            Project:{" "}
            {projectIsDeReferenced ? (
              <Tooltip
                body={
                  <>
                    Project <code>{projectId}</code> not found
                  </>
                }
              >
                <span className="text-danger">
                  <FaExclamationTriangle /> Invalid project
                </span>
              </Tooltip>
            ) : currentProject && currentProject !== feature.project ? (
              <Tooltip body={<>This feature is not in your current project.</>}>
                {projectId ? (
                  <strong>{projectName}</strong>
                ) : (
                  <em className="text-muted">None</em>
                )}{" "}
                <FaExclamationTriangle className="text-warning" />
              </Tooltip>
            ) : projectId ? (
              <strong>{projectName}</strong>
            ) : (
              <em className="text-muted">None</em>
            )}
            {canEdit &&
              permissions.check("publishFeatures", projectId, enabledEnvs) && (
                <Tooltip
                  shouldDisplay={dependents > 0}
                  body={
                    <>
                      <ImBlocked className="text-danger" /> This feature has{" "}
                      <strong>
                        {dependents} dependent{dependents !== 1 && "s"}
                      </strong>
                      . The project cannot be changed until{" "}
                      {dependents === 1 ? "it has" : "they have"} been removed.
                    </>
                  }
                >
                  <a
                    className="ml-2 cursor-pointer"
                    onClick={() => {
                      dependents === 0 && setEditProjectModal(true);
                    }}
                  >
                    <GBEdit />
                  </a>
                </Tooltip>
              )}
          </div>
        )}

        <div className="col-auto">
          Tags: <SortedTags tags={feature.tags || []} />
          {canEdit && (
            <a
              className="ml-1 cursor-pointer"
              onClick={() => setEditTagsModal(true)}
            >
              <GBEdit />
            </a>
          )}
        </div>

        <div className="col-auto">Type: {feature.valueType || "unknown"}</div>

        <div className="col-auto">
          Owner: {feature.owner ? feature.owner : "None"}
          {canEdit && (
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
          <WatchButton item={feature.id} itemType="feature" type="link" />
        </div>
      </div>

      <div className="mb-3">
        <div className={feature.description ? "appbox mb-4 p-3" : ""}>
          <MarkdownInlineEdit
            value={feature.description || ""}
            canEdit={canEdit}
            canCreate={canEdit}
            save={async (description) => {
              await apiCall(`/feature/${feature.id}`, {
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

      <h3 className="mt-4 mb-3">Enabled Environments</h3>

      <div className="appbox mt-2 mb-4 px-4 pt-3 pb-3">
        <div className="mb-2">
          When disabled, this feature will evaluate to <code>null</code>. The
          default value and override rules will be ignored.
        </div>
        {prerequisites.length > 0 ? (
          <table className="table border bg-white mb-2 w-100">
            <thead>
              <tr className="bg-light">
                <th
                  className="pl-3 align-bottom font-weight-bold border-right"
                  style={{ minWidth: 350 }}
                />
                {envs.map((env) => (
                  <th
                    key={env}
                    className="text-center align-bottom font-weight-bolder"
                    style={{ minWidth: 120 }}
                  >
                    {env}
                  </th>
                ))}
                <th className="w-100" />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  className="pl-3 align-bottom font-weight-bold border-right"
                  style={{ minWidth: 350 }}
                >
                  Kill Switch
                </td>
                {envs.map((env) => (
                  <td
                    key={env}
                    className="text-center align-bottom pb-2"
                    style={{ minWidth: 120 }}
                  >
                    <EnvironmentToggle
                      feature={feature}
                      environment={env}
                      mutate={() => {
                        mutate();
                      }}
                      id={`${env}_toggle`}
                      className="mr-0"
                    />
                  </td>
                ))}
                <td className="w-100" />
              </tr>
              {prerequisites.map(({ ...item }, i) => {
                const parentFeature = features.find((f) => f.id === item.id);
                return (
                  <PrerequisiteStatusRow
                    key={i}
                    i={i}
                    feature={feature}
                    features={features}
                    parentFeature={parentFeature}
                    prerequisite={item}
                    environments={environments}
                    mutate={mutate}
                    setPrerequisiteModal={setPrerequisiteModal}
                  />
                );
              })}
            </tbody>
            <tbody>
              <tr className="bg-light">
                <td className="pl-3 font-weight-bold border-right">Summary</td>
                <PrerequisiteStatesCols
                  prereqStates={prereqStates ?? undefined}
                  envs={envs}
                  isSummaryRow={true}
                />
                <td />
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="row mt-3">
            {environments.map((en) => (
              <div className="col-auto" key={en.id}>
                <label
                  className="font-weight-bold mr-2 mb-0"
                  htmlFor={`${en.id}_toggle`}
                >
                  {en.id}:{" "}
                </label>
                <EnvironmentToggle
                  feature={feature}
                  environment={en.id}
                  mutate={() => {
                    mutate();
                  }}
                  id={`${en.id}_toggle`}
                />
              </div>
            ))}
          </div>
        )}

        {hasConditionalState && (
          <PrerequisiteAlerts
            environments={envs}
            type="feature"
            project={projectId ?? ""}
          />
        )}

        {canEdit && (
          <PremiumTooltip
            commercialFeature="prerequisites"
            className="d-inline-flex align-items-center mt-3"
          >
            <button
              className="btn d-inline-block px-1 font-weight-bold link-purple"
              disabled={!hasPrerequisitesCommercialFeature}
              onClick={() => {
                setPrerequisiteModal({
                  i: getPrerequisites(feature).length,
                });
                track("Viewed prerequisite feature modal", {
                  source: "add-prerequisite",
                });
              }}
            >
              <span className="h4 pr-2 m-0 d-inline-block align-top">
                <GBAddCircle />
              </span>
              Add Prerequisite Feature
            </button>
          </PremiumTooltip>
        )}
      </div>

      {dependents > 0 && (
        <div className="appbox mt-2 mb-4 px-4 pt-3 pb-3">
          <h4>
            Dependents
            <div
              className="ml-2 d-inline-block badge-warning font-weight-bold text-center"
              style={{
                width: 24,
                height: 24,
                lineHeight: "24px",
                fontSize: "14px",
                borderRadius: 30,
              }}
            >
              {dependents}
            </div>
          </h4>
          <div className="mb-2">
            {dependents === 1
              ? `Another ${
                  dependentFeatures.length ? "feature" : "experiment"
                } depends on this feature as a prerequisite. Modifying the current feature may affect its behavior.`
              : `Other ${
                  dependentFeatures.length
                    ? dependentExperiments.length
                      ? "features and experiments"
                      : "features"
                    : "experiments"
                } depend on this feature as a prerequisite. Modifying the current feature may affect their behavior.`}
          </div>
          <hr className="mb-2" />
          {showDependents ? (
            <div className="mt-3">
              {dependentFeatures.length > 0 && (
                <>
                  <label>Dependent Features</label>
                  <ul className="pl-4">
                    {dependentFeatures.map((fid, i) => (
                      <li className="my-1" key={i}>
                        <a
                          href={`/features/${fid}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {fid}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {dependentExperiments.length > 0 && (
                <>
                  <label>Dependent Experiments</label>
                  <ul className="pl-4">
                    {dependentExperiments.map((exp, i) => (
                      <li className="my-1" key={i}>
                        <a
                          href={`/experiment/${exp.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {exp.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <a
                role="button"
                className="d-inline-block a link-purple mt-1"
                onClick={() => setShowDependents(false)}
              >
                <BiHide /> Hide details
              </a>
            </div>
          ) : (
            <>
              <a
                role="button"
                className="d-inline-block a link-purple"
                onClick={() => setShowDependents(true)}
              >
                <BiShow /> Show details
              </a>
            </>
          )}
        </div>
      )}

      {feature.valueType === "json" && (
        <div>
          <h3 className={hasJsonValidator ? "" : "mb-4"}>
            <PremiumTooltip commercialFeature="json-validation">
              {" "}
              Json Schema{" "}
            </PremiumTooltip>
            <Tooltip
              body={
                "Adding a json schema will allow you to validate json objects used in this feature."
              }
            />
            {hasJsonValidator && canEdit && (
              <>
                <a
                  className="ml-2 cursor-pointer"
                  onClick={() => setEditValidator(true)}
                >
                  <GBEdit />
                </a>
              </>
            )}
          </h3>
          {hasJsonValidator && (
            <div className="appbox mb-4 p-3 card">
              {jsonSchema ? (
                <>
                  <div className="d-flex justify-content-between">
                    {/* region Title Bar */}

                    <div className="d-flex align-items-left flex-column">
                      <div>
                        {validationEnabled ? (
                          <strong className="text-success">Enabled</strong>
                        ) : (
                          <>
                            <strong className="text-warning">Disabled</strong>
                          </>
                        )}
                        {schemaDescription && schemaDescriptionItems && (
                          <>
                            {" "}
                            Describes:
                            {schemaDescriptionItems.map((v, i) => {
                              const required = schemaDescription.has(v)
                                ? schemaDescription.get(v).required
                                : false;
                              return (
                                <strong
                                  className="ml-1"
                                  key={i}
                                  title={
                                    required ? "This field is required" : ""
                                  }
                                >
                                  {v}
                                  {required && (
                                    <span className="text-danger text-su">
                                      *
                                    </span>
                                  )}
                                  {i < schemaDescriptionItems.length - 1 && (
                                    <span>, </span>
                                  )}
                                </strong>
                              );
                            })}
                          </>
                        )}
                      </div>
                      {schemaDateUpdated && (
                        <div className="text-muted">
                          Date updated:{" "}
                          {schemaDateUpdated ? datetime(schemaDateUpdated) : ""}
                        </div>
                      )}
                    </div>

                    <div className="d-flex align-items-center">
                      <button
                        className="btn ml-3 text-dark"
                        onClick={() => setShowSchema(!showSchema)}
                      >
                        <FaChevronRight
                          style={{
                            transform: `rotate(${
                              showSchema ? "90deg" : "0deg"
                            })`,
                          }}
                        />
                      </button>
                    </div>
                  </div>
                  {showSchema && (
                    <>
                      <Code
                        language="json"
                        code={feature?.jsonSchema?.schema || "{}"}
                        className="disabled"
                      />
                    </>
                  )}
                </>
              ) : (
                "No schema defined"
              )}
            </div>
          )}
        </div>
      )}

      {revision && (
        <>
          <div className="row mb-2 align-items-center">
            <div className="col-auto">
              <h3 className="mb-0">Rules and Values</h3>
            </div>
            <div className="col-auto">
              <RevisionDropdown
                feature={feature}
                version={currentVersion}
                setVersion={setVersion}
                revisions={data.revisions || []}
              />
            </div>
            <div className="col-auto">
              <a
                title="Copy a link to this revision"
                href={`/features/${fid}?v=${version}`}
                className="position-relative"
                onClick={(e) => {
                  if (!copySupported) return;

                  e.preventDefault();
                  const url =
                    window.location.href.replace(/[?#].*/, "") +
                    `?v=${version}`;
                  performCopy(url);
                }}
              >
                <FaLink />
                {copySuccess ? (
                  <SimpleTooltip position="right">
                    Copied to clipboard!
                  </SimpleTooltip>
                ) : null}
              </a>
            </div>
          </div>
          {isLive ? (
            <div
              className="px-3 py-2 alert alert-success mb-0"
              style={{
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
              }}
            >
              <div className="d-flex align-items-center">
                <strong className="mr-3">
                  <MdRocketLaunch /> Live Revision
                </strong>
                <div className="mr-3">
                  {!isLocked ? (
                    "Changes you make below will start a new draft"
                  ) : (
                    <>
                      There is already an active draft. Switch to that to make
                      changes.
                    </>
                  )}
                </div>
                <div className="ml-auto"></div>
                {canEditDrafts && drafts.length > 0 && (
                  <div>
                    <a
                      role="button"
                      className="a font-weight-bold link-purple"
                      onClick={(e) => {
                        e.preventDefault();
                        setVersion(drafts[0].version);
                      }}
                    >
                      <FaExchangeAlt /> Switch to Draft
                    </a>
                  </div>
                )}
                {canEditDrafts && revision.version > 1 && (
                  <div className="ml-4">
                    <a
                      href="#"
                      className="font-weight-bold text-danger"
                      onClick={(e) => {
                        e.preventDefault();

                        // Get highest revision number that is published and less than the current revision
                        const previousRevision = data.revisions
                          .filter(
                            (r) =>
                              r.status === "published" &&
                              r.version < feature.version
                          )
                          .sort((a, b) => b.version - a.version)[0];

                        if (previousRevision) {
                          setRevertIndex(previousRevision.version);
                        }
                      }}
                    >
                      <MdHistory /> Revert to Previous
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : isLocked ? (
            <div
              className="px-3 py-2 alert-secondary mb-0"
              style={{
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
              }}
            >
              <div className="d-flex align-items-center">
                <strong className="mr-3">
                  <FaLock /> Revision Locked
                </strong>
                <div className="mr-2">
                  This revision is no longer active and cannot be modified.
                </div>
                <div className="ml-auto"></div>
                {canEditDrafts && (
                  <div>
                    <a
                      role="button"
                      className="a font-weight-bold link-purple"
                      onClick={(e) => {
                        e.preventDefault();
                        setRevertIndex(revision.version);
                      }}
                      title="Create a new Draft based on this revision"
                    >
                      <MdHistory /> Revert to this Revision
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : isDraft || isPendingReview || approved ? (
            <div
              className="px-3 py-2 alert alert-warning mb-0"
              style={{
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
              }}
            >
              <div className="d-flex align-items-center">
                <strong className="mr-3">
                  <FaDraftingCompass /> Draft Revision
                </strong>
                <div className="mr-3">
                  {requireReviews
                    ? "Make changes below and request review when you are ready"
                    : "Make changes below and publish when you are ready"}
                </div>
                <div className="ml-auto"></div>
                {mergeResult?.success && requireReviews && (
                  <div>
                    <Tooltip
                      body={
                        !revisionHasChanges
                          ? "Draft is identical to the live version. Make changes first before requesting review"
                          : ""
                      }
                    >
                      <a
                        href="#"
                        className={clsx(
                          "font-weight-bold",
                          !revisionHasChanges ? "text-muted" : "text-purple"
                        )}
                        onClick={(e) => {
                          e.preventDefault();
                          setReviewModal(true);
                        }}
                      >
                        {renderDraftBannerCopy()}
                      </a>
                    </Tooltip>
                  </div>
                )}
                {mergeResult?.success && !requireReviews && (
                  <div>
                    <Tooltip
                      body={
                        !revisionHasChanges
                          ? "Draft is identical to the live version. Make changes first before publishing"
                          : !hasDraftPublishPermission
                          ? "You do not have permission to publish this draft."
                          : ""
                      }
                    >
                      <a
                        role="button"
                        className={clsx(
                          "a font-weight-bold",
                          !hasDraftPublishPermission || !revisionHasChanges
                            ? "text-muted"
                            : "link-purple"
                        )}
                        onClick={(e) => {
                          e.preventDefault();
                          setDraftModal(true);
                        }}
                      >
                        <MdRocketLaunch /> Review and Publish
                      </a>
                    </Tooltip>
                  </div>
                )}
                {canEditDrafts && mergeResult && !mergeResult.success && (
                  <div>
                    <Tooltip body="There have been new conflicting changes published since this draft was created that must be resolved before you can publish">
                      <a
                        role="button"
                        className="a font-weight-bold link-purple"
                        onClick={(e) => {
                          e.preventDefault();
                          setConflictModal(true);
                        }}
                      >
                        <FaPlusMinus /> Fix Conflicts
                      </a>
                    </Tooltip>
                  </div>
                )}
                {canEditDrafts && !isPendingReview && (
                  <div className="ml-4">
                    <a
                      href="#"
                      className="font-weight-bold text-danger"
                      onClick={(e) => {
                        e.preventDefault();
                        setConfirmDiscard(true);
                      }}
                    >
                      <FaTimes /> Discard Draft
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}
      <div
        className={revision ? "appbox mb-4 px-3 pt-3" : ""}
        style={{
          borderTopRightRadius: 0,
          borderTopLeftRadius: 0,
        }}
      >
        {revision && (
          <div className="row mb-3">
            <div className="col-auto">
              <span className="text-muted">Revision created by</span>{" "}
              <AuditUser user={revision.createdBy} display="name" />{" "}
              <span className="text-muted">on</span>{" "}
              {date(revision.dateCreated)}
            </div>
            <div className="col-auto">
              <span className="text-muted">Revision Comment:</span>{" "}
              {revision.comment || <em>None</em>}
              {canEditDrafts && (
                <a
                  href="#"
                  className="ml-1"
                  onClick={(e) => {
                    e.preventDefault();
                    setEditCommentModal(true);
                  }}
                >
                  <GBEdit />
                </a>
              )}
            </div>
            <div className="ml-auto"></div>
            {revision.status === "published" && revision.datePublished && (
              <div className="col-auto">
                <span className="text-muted">Published on</span>{" "}
                {date(revision.datePublished)}
              </div>
            )}
            {revision.status === "draft" && (
              <div className="col-auto">
                <span className="text-muted">Last updated</span>{" "}
                {ago(revision.dateUpdated)}
              </div>
            )}
            <div className="col-auto">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setLogModal(true);
                }}
              >
                <FaList /> View Log
              </a>
            </div>
          </div>
        )}

        <h3>
          Default Value
          {canEdit && !isLocked && canEditDrafts && (
            <a className="ml-2 cursor-pointer" onClick={() => setEdit(true)}>
              <GBEdit />
            </a>
          )}
        </h3>
        <div className="appbox mb-4 p-3">
          <ForceSummary
            value={getFeatureDefaultValue(feature)}
            feature={feature}
          />
        </div>

        <h3>Override Rules</h3>
        <p>
          Add powerful logic on top of your feature. The first matching rule
          applies and overrides the default value.
        </p>

        <div className="mb-0">
          <ControlledTabs
            setActive={(v) => {
              setEnv(v || "");
            }}
            active={env}
            showActiveCount={true}
            newStyle={false}
            buttonsClassName="px-3 py-2 h4"
          >
            {environments.map((e) => {
              const rules = getRules(feature, e.id);
              return (
                <Tab
                  key={e.id}
                  id={e.id}
                  display={e.id}
                  count={rules.length}
                  padding={false}
                >
                  <div className="border mb-4 border-top-0">
                    {rules.length > 0 ? (
                      <RuleList
                        environment={e.id}
                        feature={feature}
                        mutate={mutate}
                        setRuleModal={setRuleModal}
                        version={currentVersion}
                        setVersion={setVersion}
                        locked={isLocked}
                        experimentsMap={experimentsMap}
                      />
                    ) : (
                      <div className="p-3 bg-white">
                        <em>No override rules for this environment yet</em>
                      </div>
                    )}
                  </div>
                </Tab>
              );
            })}
          </ControlledTabs>

          {canEditDrafts && !isLocked && <h4>Add Rules</h4>}

          {canEditDrafts && !isLocked && (
            <div className="row">
              <div className="col mb-3">
                <div
                  className="bg-white border p-3 d-flex flex-column"
                  style={{ height: "100%" }}
                >
                  <h4>Forced Value</h4>
                  <p>
                    Target groups of users and give them all the same value.
                  </p>
                  <div style={{ flex: 1 }} />
                  <div>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        setRuleModal({
                          environment: env,
                          i: getRules(feature, env).length,
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
                  <p>
                    Release to a small percent of users while you monitor logs.
                  </p>
                  <div style={{ flex: 1 }} />
                  <div>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        setRuleModal({
                          environment: env,
                          i: getRules(feature, env).length,
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
                          i: getRules(feature, env).length,
                          defaultType: "experiment-ref-new",
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
        </div>
      </div>

      <div className="mb-4">
        <h3>Test Feature Rules</h3>
        <AssignmentTester feature={feature} version={currentVersion} />
      </div>

      <div className="mb-4">
        <h3>Comments</h3>
        <DiscussionThread
          type="feature"
          id={feature.id}
          project={feature.project}
        />
      </div>
    </div>
  );
}
