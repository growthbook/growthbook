import { useRouter } from "next/router";
import { FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import React, { useMemo, useState } from "react";
import { FaExclamationTriangle, FaLink } from "react-icons/fa";
import { FaBoltLightning } from "react-icons/fa6";
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
import { MdRocketLaunch } from "react-icons/md";
import { BiHide, BiShow } from "react-icons/bi";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Link from "next/link";
import { BsClock } from "react-icons/bs";
import { PiCheckCircleFill, PiCircleDuotone, PiFileX } from "react-icons/pi";
import { FeatureUsageLookback } from "back-end/src/types/Integration";
import { Box, Flex, Heading, Switch, Text } from "@radix-ui/themes";
import { RxListBullet } from "react-icons/rx";
import Button from "@/components/Radix/Button";
import { GBAddCircle, GBEdit } from "@/components/Icons";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAuth } from "@/services/auth";
import ForceSummary from "@/components/Features/ForceSummary";
import track from "@/services/track";
import EditDefaultValueModal from "@/components/Features/EditDefaultValueModal";
import EnvironmentToggle from "@/components/Features/EnvironmentToggle";
import EditProjectForm from "@/components/Experiment/EditProjectForm";
import {
  getFeatureDefaultValue,
  useEnvironments,
  getAffectedRevisionEnvs,
  getPrerequisites,
  useFeaturesList,
  getRules,
  isRuleInactive,
} from "@/services/features";
import Modal from "@/components/Modal";
import DraftModal from "@/components/Features/DraftModal";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import DiscussionThread from "@/components/DiscussionThread";
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
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import SelectField from "@/components/Forms/SelectField";
import BarChart100 from "@/components/Features/BarChart100";
import Callout from "@/components/Radix/Callout";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Badge from "@/components/Radix/Badge";
import Frame from "@/components/Radix/Frame";
import LoadingSpinner from "@/components/LoadingSpinner";
import PrerequisiteStatusRow, {
  PrerequisiteStatesCols,
} from "./PrerequisiteStatusRow";
import { PrerequisiteAlerts } from "./PrerequisiteTargetingField";
import PrerequisiteModal from "./PrerequisiteModal";
import RequestReviewModal from "./RequestReviewModal";
import JSONSchemaDescription from "./JSONSchemaDescription";
import FeatureUsageGraph, { useFeatureUsage } from "./FeatureUsageGraph";
import FeatureRules from "./FeatureRules";

export default function FeaturesOverview({
  baseFeature,
  feature,
  revision,
  revisions,
  experiments,
  mutate,
  editProjectModal,
  setEditProjectModal,
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
  const [hideInactive, setHideInactive] = useLocalStorage(
    `hide-disabled-rules`,
    false
  );
  const [logModal, setLogModal] = useState(false);
  const [prerequisiteModal, setPrerequisiteModal] = useState<{
    i: number;
  } | null>(null);
  const [showDependents, setShowDependents] = useState(false);
  const permissionsUtil = usePermissionsUtil();

  const [revertIndex, setRevertIndex] = useState(0);

  const [editCommentModel, setEditCommentModal] = useState(false);

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();

  const { features } = useFeaturesList(false);
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const envs = environments.map((e) => e.id);

  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 800,
  });

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

  const experimentsMap = useMemo<
    Map<string, ExperimentInterfaceStringDates>
  >(() => {
    if (!experiments) return new Map();
    return new Map(experiments.map((exp) => [exp.id, exp]));
  }, [experiments]);

  const {
    showFeatureUsage,
    featureUsage,
    lookback,
    setLookback,
  } = useFeatureUsage();

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
  const canManageCustomFields = permissionsUtil.canManageCustomFields();

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

  // loop through each environment and see if there are any rules or disabled rules
  let hasRules = false;
  let hasInactiveRules = false;
  environments?.forEach((e) => {
    const r = getRules(feature, e.id) || [];
    if (r.length > 0) hasRules = true;
    if (r.some((r) => isRuleInactive(r, experimentsMap))) {
      hasInactiveRules = true;
    }
  });

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

  const renderRevisionCTA = () => {
    const actions: JSX.Element[] = [];

    if (canEditDrafts) {
      if (isLocked && !isLive) {
        actions.push(
          <Button
            variant="ghost"
            color="red"
            onClick={() => setRevertIndex(revision.version)}
            title="Create a new Draft based on this revision"
          >
            Revert to this version
          </Button>
        );
      } else if (revision.version > 1 && isLive) {
        actions.push(
          <Button
            variant="ghost"
            color="red"
            onClick={() => {
              const previousRevision = revisions
                .filter(
                  (r) => r.status === "published" && r.version < feature.version
                )
                .sort((a, b) => b.version - a.version)[0];
              if (previousRevision) {
                setRevertIndex(previousRevision.version);
              }
            }}
            title="Create a new Draft based on this revision"
          >
            Revert to Previous
          </Button>
        );
      }

      if (drafts.length > 0 && isLocked && !isDraft) {
        actions.push(
          <Button
            variant="outline"
            onClick={() => {
              setVersion(drafts[0].version);
            }}
          >
            View active draft
          </Button>
        );
      }

      if (isDraft) {
        actions.push(
          <Button
            variant="ghost"
            color="red"
            onClick={() => {
              setConfirmDiscard(true);
            }}
          >
            Discard draft
          </Button>
        );

        if (mergeResult?.success) {
          if (requireReviews) {
            // requires a review
            actions.push(
              <Tooltip
                body={
                  !revisionHasChanges
                    ? "Draft is identical to the live version. Make changes first before requesting review"
                    : ""
                }
              >
                <Button
                  disabled={!revisionHasChanges}
                  onClick={() => {
                    setReviewModal(true);
                  }}
                >
                  {renderDraftBannerCopy()}
                </Button>
              </Tooltip>
            );
          } else {
            // no review is required
            actions.push(
              <Tooltip
                body={
                  !revisionHasChanges
                    ? "Draft is identical to the live version. Make changes first before publishing"
                    : !hasDraftPublishPermission
                    ? "You do not have permission to publish this draft."
                    : ""
                }
              >
                <Button
                  disabled={!revisionHasChanges}
                  onClick={() => {
                    setDraftModal(true);
                  }}
                >
                  Review &amp; Publish
                </Button>
              </Tooltip>
            );
          }
        } else {
          // merging was not a success (!mergeResult.success)
          if (mergeResult) {
            actions.push(
              <Tooltip body="There have been new conflicting changes published since this draft was created that must be resolved before you can publish">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setConflictModal(true);
                  }}
                >
                  Fix conflicts
                </Button>
              </Tooltip>
            );
          }
        }
      }
    }

    return (
      <>
        {actions.map((el, i) => (
          <Box key={"cta-" + i}>{el}</Box>
        ))}
      </>
    );
  };

  const renderRevisionInfo = () => {
    return (
      <Flex align="center" justify="between">
        <Flex align="center" gap="3">
          <Box>
            <span className="text-muted">
              {isDraft ? "Draft r" : "R"}evision created by
            </span>{" "}
            <EventUser user={revision.createdBy} display="name" />{" "}
            <span className="text-muted">on</span>{" "}
            {datetime(revision.dateCreated)}
          </Box>
          <Flex align="center" gap="2">
            <span className="text-muted">Revision Comment:</span>{" "}
            {revision.comment || <em>None</em>}
            {canEditDrafts && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditCommentModal(true);
                }}
              >
                <GBEdit />
              </Button>
            )}
          </Flex>
        </Flex>
        <Flex align="center" justify="between" gap="3">
          {revision.status === "published" && revision.datePublished && (
            <Box>
              <span className="text-muted">Published on</span>{" "}
              {datetime(revision.datePublished)}
            </Box>
          )}
          {revision.status === "draft" && (
            <Box>
              <span className="text-muted">Last updated</span>{" "}
              {ago(revision.dateUpdated)}
            </Box>
          )}
          <Box>
            {renderStatusCopy()}
            <Button
              title="View log"
              variant="ghost"
              onClick={() => {
                setLogModal(true);
              }}
            >
              <RxListBullet />
            </Button>
          </Box>
        </Flex>
      </Flex>
    );
  };

  return (
    <>
      <Box className="contents container-fluid pagecontents">
        <Heading mb="3" size="5" as="h2">
          Overview
        </Heading>

        <Frame>
          <div className="mh-350px" style={{ overflowY: "auto" }}>
            <MarkdownInlineEdit
              value={feature.description || ""}
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
              canCreate={canEdit}
              canEdit={canEdit}
              label="description"
              header="Description"
              headerClassName="h4"
              containerClassName="mb-1"
            />
          </div>
        </Frame>
        <Box>
          <CustomFieldDisplay
            target={feature}
            canEdit={canManageCustomFields}
            mutate={mutate}
            section={"feature"}
          />
        </Box>
        <Box mt="3">
          <CustomMarkdown page={"feature"} variables={variables} />

          {showFeatureUsage && (
            <div>
              <div className="row align-items-center">
                <div className="col-auto">
                  <h3 className="mb-0">Usage Analytics</h3>
                </div>
                <div className="col-auto">
                  <SelectField
                    value={lookback}
                    onChange={(lookback) => {
                      setLookback(lookback as FeatureUsageLookback);
                    }}
                    options={[
                      { value: "15minute", label: "Past 15 Minutes" },
                      { value: "hour", label: "Past Hour" },
                      { value: "day", label: "Past Day" },
                      { value: "week", label: "Past Week" },
                    ]}
                    sort={false}
                    formatOptionLabel={(o) => {
                      if (o.value !== "15minute") return o.label;
                      return (
                        <div>
                          <span className="badge badge-success mr-1">
                            <FaBoltLightning /> Live
                          </span>
                          {o.label}
                        </div>
                      );
                    }}
                  />
                </div>
              </div>
              <div className="appbox mt-2 mb-4 px-4 pt-3 pb-3">
                {!featureUsage ? (
                  <Flex align="center" justify="center">
                    <LoadingSpinner /> <Text ml="2">Loading...</Text>
                  </Flex>
                ) : featureUsage.overall.total === 0 ? (
                  <em>No usage detected in the selected time frame</em>
                ) : (
                  <div className="row">
                    <div className="col-12 col-md-4">
                      <strong>Assigned Values</strong>
                      <BarChart100 data={featureUsage.values} max={3} />
                    </div>
                    <div className="col-12 col-md-4">
                      <strong>Sources</strong>
                      <BarChart100 data={featureUsage.sources} max={3} />
                    </div>
                    <div className="col-12 col-md-4">
                      <div className="mb-1">
                        <strong>Usage Over Time</strong>
                      </div>
                      <FeatureUsageGraph
                        data={featureUsage.overall}
                        width="auto"
                        height={80}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </Box>
        <Heading size="4" as="h3" mt="4">
          Enabled Environments
        </Heading>
        <Frame mb="4">
          <Box>
            <div className="mb-2">
              When disabled, this feature will evaluate to <code>null</code>.
              The default value and rules will be ignored.
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
                    const parentFeature = features.find(
                      (f) => f.id === item.id
                    );
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
                <Button
                  variant="ghost"
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
                </Button>
              </PremiumTooltip>
            )}
          </Box>
        </Frame>
        {dependents > 0 && (
          <Frame mb="4">
            <Box>
              <Flex mb="3" gap="3" align="center">
                <Heading size="4" as="h4" mb="0">
                  Dependents
                </Heading>
                <Badge label={dependents + ""} color="gray" radius="medium" />
              </Flex>
              <Box mb="2">
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
              </Box>
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
            </Box>
          </Frame>
        )}

        {feature.valueType === "json" && (
          <Box mb="4">
            <Heading as="h3" size="4">
              JSON Validation{" "}
              <Tooltip
                body={
                  "Prevent typos and mistakes by specifying validation rules using JSON Schema or our Simple Validation Builder"
                }
              />
            </Heading>
            <Frame>
              <Box>
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
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditValidator(true);
                      }}
                    >
                      <span className="h4 pr-2 m-0 d-inline-block align-top">
                        {validationEnabled ? <GBEdit /> : <GBAddCircle />}
                      </span>
                      {validationEnabled ? "Edit" : "Add"} JSON Validation
                    </Button>
                  </div>
                )}
              </Box>
            </Frame>
          </Box>
        )}

        {revision && (
          <>
            <Box>
              <Heading as="h3" size="5" mb="3">
                Rules &amp; Values
              </Heading>
              <Flex
                gap="4"
                align={{ initial: "center" }}
                direction={{ initial: "column", xs: "row" }}
                justify="between"
              >
                <Flex
                  align="center"
                  justify="between"
                  width={{ initial: "98%", sm: "70%", md: "60%", lg: "50%" }}
                >
                  <Box width="100%">
                    <RevisionDropdown
                      feature={feature}
                      version={currentVersion}
                      setVersion={setVersion}
                      revisions={revisions || []}
                    />
                  </Box>
                  <Box mx="6">
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
                  </Box>
                </Flex>
                <Flex
                  align={{ initial: "center", xs: "center", sm: "start" }}
                  justify="end"
                  flexShrink="0"
                  direction={{ initial: "row", xs: "column", sm: "row" }}
                  style={{ whiteSpace: "nowrap" }}
                  gap="4"
                >
                  {renderRevisionCTA()}
                </Flex>
              </Flex>
            </Box>
            <Box className="appbox nobg" mt="4" p="4">
              {isPendingReview ? (
                <Box>
                  <Callout status="warning" mb="3">
                    You are viewing a <strong>draft</strong>. The changes below
                    will not go live until they are approved and published.
                  </Callout>
                </Box>
              ) : isDraft ? (
                <Box>
                  <Callout status="warning" mb="3">
                    You are viewing a <strong>draft</strong>. The changes below
                    will not go live until you review and publish them.
                  </Callout>
                </Box>
              ) : isLocked && !isLive ? (
                <Box>
                  <Callout status="info" mb="3">
                    This revision has been <strong>locked</strong>. It is no
                    longer live and cannot be modified.
                  </Callout>
                </Box>
              ) : null}

              {renderRevisionInfo()}

              <Box className="appbox" mt="4" p="5" pl="6" pr="5">
                <Flex align="center" justify="between">
                  <Heading as="h3" size="4" mb="0">
                    Default Value
                  </Heading>
                  {canEdit && !isLocked && canEditDrafts && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEdit(true)}
                    >
                      Edit
                    </Button>
                  )}
                </Flex>
                <Box mt="2" mb="1">
                  <div className="d-flex">
                    <div>
                      <ForceSummary
                        value={getFeatureDefaultValue(feature)}
                        feature={feature}
                      />
                    </div>
                    {featureUsage && (
                      <div className="ml-auto">
                        <FeatureUsageGraph data={featureUsage?.defaultValue} />
                      </div>
                    )}
                  </div>
                </Box>
              </Box>
              <Box className="appbox" mt="4" p="5" px="6">
                <Flex align="center" justify="between" mb="2">
                  <Flex>
                    <Heading as="h3" size="4" mb="0" mr="1">
                      Rules
                    </Heading>
                    <Tooltip
                      body="Add powerful logic on top of your feature. The first rule
                      that matches will be applied and override the Default
                      Value."
                    />
                  </Flex>
                  <label className="font-weight-semibold">
                    <Switch
                      mr="1"
                      disabled={!hasInactiveRules}
                      checked={!hideInactive}
                      onCheckedChange={(state) => setHideInactive(!state)}
                    />{" "}
                    Show inactive
                  </label>
                </Flex>
                {environments.length > 0 ? (
                  <>
                    {!hasRules && (
                      <p>
                        Add powerful logic on top of your feature. The first
                        rule that matches will be applied and override the
                        Default Value.
                      </p>
                    )}

                    <FeatureRules
                      environments={environments}
                      feature={feature}
                      isLocked={isLocked}
                      canEditDrafts={canEditDrafts}
                      revisions={revisions}
                      experimentsMap={experimentsMap}
                      mutate={mutate}
                      currentVersion={currentVersion}
                      setVersion={setVersion}
                      hideInactive={hideInactive}
                      isDraft={isDraft}
                    />
                  </>
                ) : (
                  <p>
                    You need at least one environment to add rules. Add powerful
                    logic on top of your feature. The first rule that matches
                    will be applied and override the Default Value.
                  </p>
                )}
              </Box>
            </Box>
          </>
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
        {editValidator && (
          <EditSchemaModal
            close={() => setEditValidator(false)}
            feature={feature}
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
            trackingEventModalType=""
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
        {reviewModal && revision && (
          <RequestReviewModal
            feature={baseFeature}
            revisions={revisions}
            version={revision.version}
            close={() => setReviewModal(false)}
            mutate={mutate}
            experimentsMap={experimentsMap}
          />
        )}
        {draftModal && revision && (
          <DraftModal
            feature={baseFeature}
            revisions={revisions}
            version={revision.version}
            close={() => setDraftModal(false)}
            mutate={mutate}
            experimentsMap={experimentsMap}
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
            trackingEventModalType=""
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
      </Box>
    </>
  );
}
