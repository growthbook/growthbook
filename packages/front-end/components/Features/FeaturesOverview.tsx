import { useRouter } from "next/router";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import React, { useEffect, useMemo, useState } from "react";
import {
  FaDraftingCompass,
  FaExchangeAlt,
  FaExclamationTriangle,
  FaLink,
  FaList,
  FaLock,
  FaTimes,
} from "react-icons/fa";
import { ago, datetime } from "shared/dates";
import {
  autoMerge,
  checkIfRevisionNeedsReview,
  evaluatePrerequisiteState,
  filterEnvironmentsByFeature,
  getValidation,
  mergeResultHasChanges,
  PrerequisiteStateResult,
} from "shared/util";
import { MdHistory, MdRocketLaunch } from "react-icons/md";
import { BiHide, BiShow } from "react-icons/bi";
import { FaPlusMinus } from "react-icons/fa6";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import clsx from "clsx";
import Link from "next/link";
import { BsClock } from "react-icons/bs";
import { PiCheckCircleFill, PiCircleDuotone, PiFileX } from "react-icons/pi";
import { GBAddCircle, GBEdit } from "@/components/Icons";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAuth } from "@/services/auth";
import RuleModal from "@/components/Features/RuleModal";
import ForceSummary from "@/components/Features/ForceSummary";
import RuleList from "@/components/Features/RuleList";
import track from "@/services/track";
import EditDefaultValueModal from "@/components/Features/EditDefaultValueModal";
import EnvironmentToggle from "@/components/Features/EnvironmentToggle";
import EditProjectForm from "@/components/Experiment/EditProjectForm";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import {
  getFeatureDefaultValue,
  getRules,
  useEnvironmentState,
  useEnvironments,
  getAffectedRevisionEnvs,
  getPrerequisites,
  useFeaturesList,
} from "@/services/features";
import AssignmentTester from "@/components/Archetype/AssignmentTester";
import Tab from "@/components/Tabs/Tab";
import Modal from "@/components/Modal";
import DraftModal from "@/components/Features/DraftModal";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import DiscussionThread from "@/components/DiscussionThread";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import EditSchemaModal from "@/components/Features/EditSchemaModal";
import Code from "@/components/SyntaxHighlighting/Code";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import EventUser from "@/components/Avatar/EventUser";
import RevertModal from "@/components/Features/RevertModal";
import EditRevisionCommentModal from "@/components/Features/EditRevisionCommentModal";
import FixConflictsModal from "@/components/Features/FixConflictsModal";
import Revisionlog from "@/components/Features/RevisionLog";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { SimpleTooltip } from "@/components/SimpleTooltip/SimpleTooltip";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CopyRuleModal from "@/components/Features/CopyRuleModal";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import PrerequisiteStatusRow, {
  PrerequisiteStatesCols,
} from "./PrerequisiteStatusRow";
import { PrerequisiteAlerts } from "./PrerequisiteTargetingField";
import PrerequisiteModal from "./PrerequisiteModal";
import RequestReviewModal from "./RequestReviewModal";
import JSONSchemaDescription from "./JSONSchemaDescription";

export default function FeaturesOverview({
  baseFeature,
  feature,
  revision,
  revisions,
  experiments,
  mutate,
  editProjectModal,
  setEditProjectModal,
  editTagsModal,
  setEditTagsModal,
  editOwnerModal,
  setEditOwnerModal,
  version,
  setVersion,
  dependents,
  dependentFeatures,
  dependentExperiments,
}: {
  baseFeature: FeatureInterface;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface | null;
  revisions: FeatureRevisionInterface[];
  experiments: ExperimentInterfaceStringDates[] | undefined;
  mutate: () => Promise<unknown>;
  editProjectModal: boolean;
  setEditProjectModal: (b: boolean) => void;
  editTagsModal: boolean;
  setEditTagsModal: (b: boolean) => void;
  editOwnerModal: boolean;
  setEditOwnerModal: (b: boolean) => void;
  version: number | null;
  setVersion: (v: number) => void;
  dependents: number;
  dependentFeatures: string[];
  dependentExperiments: ExperimentInterfaceStringDates[];
}) {
  const router = useRouter();
  const { fid } = router.query;

  const settings = useOrgSettings();
  const [edit, setEdit] = useState(false);
  const [editValidator, setEditValidator] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [draftModal, setDraftModal] = useState(false);
  const [reviewModal, setReviewModal] = useState(false);
  const [conflictModal, setConflictModal] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [logModal, setLogModal] = useState(false);
  const [prerequisiteModal, setPrerequisiteModal] = useState<{
    i: number;
  } | null>(null);
  const [showDependents, setShowDependents] = useState(false);
  const permissionsUtil = usePermissionsUtil();

  const [revertIndex, setRevertIndex] = useState(0);

  const [env, setEnv] = useEnvironmentState();

  const [ruleModal, setRuleModal] = useState<{
    i: number;
    environment: string;
    defaultType?: string;
  } | null>(null);
  const [copyRuleModal, setCopyRuleModal] = useState<{
    environment: string;
    rules: FeatureRule[];
  } | null>(null);
  const [editCommentModel, setEditCommentModal] = useState(false);

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();

  const { features } = useFeaturesList(false);
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const envs = environments.map((e) => e.id);

  // Make sure you can't access an invalid env tab, since active env tab is persisted via localStorage
  useEffect(() => {
    if (!envs?.length) return;
    if (!envs.includes(env)) {
      setEnv(envs[0]);
    }
  }, [envs, env, setEnv]);

  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 800,
  });

  const experimentsMap = useMemo(() => {
    if (!experiments) return new Map();

    return new Map<string, ExperimentInterfaceStringDates>(
      experiments.map((exp) => [exp.id, exp])
    );
  }, [experiments]);

  const mergeResult = useMemo(() => {
    if (!feature || !revision) return null;
    const baseRevision = revisions.find(
      (r) => r.version === revision?.baseVersion
    );
    const liveRevision = revisions.find((r) => r.version === feature.version);
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevision,
      baseRevision,
      revision,
      environments.map((e) => e.id),
      {}
    );
  }, [revisions, revision, feature, environments]);

  const prerequisites = feature?.prerequisites || [];
  const envsStr = JSON.stringify(envs);

  const prereqStates = useMemo(
    () => {
      if (!feature) return null;
      const states: Record<string, PrerequisiteStateResult> = {};
      const featuresMap = new Map(features.map((f) => [f.id, f]));
      envs.forEach((env) => {
        states[env] = evaluatePrerequisiteState(
          feature,
          featuresMap,
          env,
          true
        );
      });
      return states;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feature, features, envsStr]
  );

  if (!baseFeature || !feature || !revision) {
    return <LoadingOverlay />;
  }

  const hasConditionalState =
    prereqStates &&
    Object.values(prereqStates).some((s) => s.state === "conditional");

  const hasPrerequisitesCommercialFeature = hasCommercialFeature(
    "prerequisites"
  );

  const currentVersion = version || baseFeature.version;

  const { jsonSchema, validationEnabled, schemaDateUpdated } = getValidation(
    feature
  );
  const baseVersion = revision?.baseVersion || feature.version;
  const baseRevision = revisions.find((r) => r.version === baseVersion);
  let requireReviews = false;
  //dont require review when we cant find a base version to compare
  if (baseRevision) {
    requireReviews = checkIfRevisionNeedsReview({
      feature,
      baseRevision,
      revision,
      allEnvironments: environments.map((e) => e.id),
      settings,
    });
  }
  const isLive = revision?.version === feature.version;
  const isPendingReview =
    revision?.status === "pending-review" ||
    revision?.status === "changes-requested";
  const approved = revision?.status === "approved";

  const isDraft = revision?.status === "draft" || isPendingReview || approved;

  const revisionHasChanges =
    !!mergeResult && mergeResultHasChanges(mergeResult);

  const hasJsonValidator = hasCommercialFeature("json-validation");

  const projectId = feature.project;

  const hasDraftPublishPermission =
    (approved &&
      permissionsUtil.canPublishFeature(
        feature,
        getAffectedRevisionEnvs(feature, revision, environments)
      )) ||
    (isDraft &&
      !requireReviews &&
      permissionsUtil.canPublishFeature(
        feature,
        getAffectedRevisionEnvs(feature, revision, environments)
      ));

  const drafts = revisions.filter(
    (r) =>
      r.status === "draft" ||
      r.status === "pending-review" ||
      r.status === "changes-requested" ||
      r.status === "approved"
  );
  const isLocked =
    (revision.status === "published" || revision.status === "discarded") &&
    (!isLive || drafts.length > 0);

  const canEdit = permissionsUtil.canViewFeatureModal(projectId);
  const canEditDrafts = permissionsUtil.canManageFeatureDrafts(feature);

  const variables = {
    featureKey: feature.id,
    featureType: feature.valueType,
    tags: feature.tags || [],
  };

  const renderStatusCopy = () => {
    switch (revision.status) {
      case "approved":
        return (
          <span className="mr-3">
            <PiCheckCircleFill className="text-success  mr-1" /> Approved
          </span>
        );
      case "pending-review":
        return (
          <span className="mr-3">
            <PiCircleDuotone className="text-warning  mr-1" /> Pending Review
          </span>
        );
      case "changes-requested":
        return (
          <span className="mr-3">
            <PiFileX className="text-danger mr-1" />
            Changes Requested
          </span>
        );
      default:
        return;
    }
  };
  const renderDraftBannerCopy = () => {
    if (isPendingReview) {
      return (
        <>
          <BsClock /> Review and Approve
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
    <>
      <div className="contents container-fluid pagecontents">
        <div className="mt-3">
          <CustomMarkdown page={"feature"} variables={variables} />
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
                  {envs.length === 0 ? (
                    <th className="text-center align-bottom">
                      <span className="font-italic">No environments</span>
                      <Tooltip
                        className="ml-1"
                        popperClassName="text-left font-weight-normal"
                        body={
                          <>
                            <div className="text-warning-orange mb-2">
                              <FaExclamationTriangle /> This feature has no
                              associated environments
                            </div>
                            <div>
                              Ensure that this feature&apos;s project is
                              included in at least one environment to use it.
                            </div>
                          </>
                        }
                      />
                      <div
                        className="float-right small position-relative"
                        style={{ top: 5 }}
                      >
                        <Link href="/environments">Manage Environments</Link>
                      </div>
                    </th>
                  ) : (
                    <th className="w-100" />
                  )}
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
                  <td className="pl-3 font-weight-bold border-right">
                    Summary
                  </td>
                  {envs.length > 0 && (
                    <PrerequisiteStatesCols
                      prereqStates={prereqStates ?? undefined}
                      envs={envs}
                      isSummaryRow={true}
                    />
                  )}
                  <td />
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="row mt-3">
              {environments.length > 0 ? (
                environments.map((en) => (
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
                ))
              ) : (
                <div className="alert alert-warning pt-3 pb-2 w-100">
                  <div className="h4 mb-3">
                    <FaExclamationTriangle /> This feature has no associated
                    environments
                  </div>
                  <div className="mb-2">
                    Ensure that this feature&apos;s project is included in at
                    least one environment to use it.{" "}
                    <Link href="/environments">Manage Environments</Link>
                  </div>
                </div>
              )}
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
            <h3>
              JSON Validation{" "}
              <Tooltip
                body={
                  "Prevent typos and mistakes by specifying validation rules using JSON Schema or our Simple Validation Builder"
                }
              />
              <span
                className="badge badge-dark ml-2"
                style={{ fontStyle: "normal", fontSize: "0.7em" }}
              >
                ENTERPRISE
              </span>
            </h3>
            <div className="appbox mb-4 p-3 card">
              {hasJsonValidator && jsonSchema ? (
                <>
                  <div className="d-flex align-items-center">
                    <strong>
                      {validationEnabled ? "Enabled" : "Disabled"}
                    </strong>

                    {schemaDateUpdated && (
                      <div className="text-muted ml-3">
                        Updated{" "}
                        {schemaDateUpdated ? ago(schemaDateUpdated) : ""}
                      </div>
                    )}

                    {validationEnabled ? (
                      <div className="ml-auto">
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setShowSchema(!showSchema);
                          }}
                        >
                          <small>
                            {showSchema
                              ? "Hide JSON Schema"
                              : "Show JSON Schema"}
                          </small>
                        </a>
                      </div>
                    ) : null}
                  </div>
                  {validationEnabled ? (
                    <JSONSchemaDescription jsonSchema={jsonSchema} />
                  ) : null}
                  {showSchema && validationEnabled && (
                    <div className="mt-4">
                      <Code
                        language="json"
                        code={JSON.stringify(jsonSchema, null, 2)}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <em>No validation added.</em>
                </div>
              )}

              {hasJsonValidator && canEdit && (
                <div className="mt-3">
                  <a
                    href="#"
                    className="text-purple"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditValidator(true);
                    }}
                  >
                    {validationEnabled ? <GBEdit /> : <GBAddCircle />}{" "}
                    {validationEnabled ? "Edit" : "Add"} JSON Validation
                  </a>
                </div>
              )}
            </div>
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
                  revisions={revisions || []}
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
                          const previousRevision = revisions
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
            ) : isDraft ? (
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
                  {canEditDrafts && (
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
                <EventUser user={revision.createdBy} display="name" />{" "}
                <span className="text-muted">on</span>{" "}
                {datetime(revision.dateCreated)}
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
                  {datetime(revision.datePublished)}
                </div>
              )}
              {revision.status === "draft" && (
                <div className="col-auto">
                  <span className="text-muted">Last updated</span>{" "}
                  {ago(revision.dateUpdated)}
                </div>
              )}
              <div className="col-auto">
                {renderStatusCopy()}
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
              isDefault={true}
            />
          </div>

          {environments.length > 0 && (
            <>
              <h3>Override Rules</h3>
              <p>
                Add powerful logic on top of your feature. The first matching
                rule applies and overrides the default value.
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
                              setCopyRuleModal={setCopyRuleModal}
                              version={currentVersion}
                              setVersion={setVersion}
                              locked={isLocked}
                              experimentsMap={experimentsMap}
                            />
                          ) : (
                            <div className="p-3 bg-white">
                              <em>
                                No override rules for this environment yet
                              </em>
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
                          Target groups of users and give them all the same
                          value.
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
                          Release to a small percent of users while you monitor
                          logs.
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
                        <p>
                          Measure the impact of this feature on your key
                          metrics.
                        </p>
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
            </>
          )}
        </div>

        {environments.length > 0 && (
          <div className="mb-4">
            <h3>Test Feature Rules</h3>
            <AssignmentTester feature={feature} version={currentVersion} />
          </div>
        )}

        <div className="mb-4">
          <h3>Comments</h3>
          <DiscussionThread
            type="feature"
            id={feature.id}
            projects={feature.project ? [feature.project] : []}
          />
        </div>

        {/* Modals */}

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
            }}
            mutate={mutate}
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
            version={currentVersion}
            setVersion={setVersion}
            revisions={revisions}
          />
        )}
        {copyRuleModal !== null && (
          <CopyRuleModal
            feature={feature}
            environment={copyRuleModal.environment}
            version={currentVersion}
            setVersion={setVersion}
            rules={copyRuleModal.rules}
            cancel={() => setCopyRuleModal(null)}
            mutate={mutate}
          />
        )}
        {editProjectModal && (
          <EditProjectForm
            label={
              <>
                Projects{" "}
                <Tooltip
                  body={
                    "The dropdown below has been filtered to only include projects where you have permission to update Features"
                  }
                />
              </>
            }
            permissionRequired={(project) =>
              permissionsUtil.canUpdateFeature({ project }, {})
            }
            apiEndpoint={`/feature/${feature.id}`}
            cancel={() => setEditProjectModal(false)}
            mutate={mutate}
            method="PUT"
            current={feature.project}
            additionalMessage={
              <div className="alert alert-danger">
                Changing the project may prevent this Feature Flag and any
                linked Experiments from being sent to users.
              </div>
            }
          />
        )}
        {revertIndex > 0 && (
          <RevertModal
            close={() => setRevertIndex(0)}
            feature={baseFeature}
            revision={
              revisions.find(
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
        {reviewModal && revision && (
          <RequestReviewModal
            feature={baseFeature}
            revisions={revisions}
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
            feature={baseFeature}
            revisions={revisions}
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
            feature={baseFeature}
            revisions={revisions}
            version={revision.version}
            close={() => setConflictModal(false)}
            mutate={mutate}
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
        {prerequisiteModal !== null && (
          <PrerequisiteModal
            feature={feature}
            close={() => setPrerequisiteModal(null)}
            i={prerequisiteModal.i}
            mutate={mutate}
            revisions={revisions}
            version={currentVersion}
          />
        )}
      </div>
    </>
  );
}
