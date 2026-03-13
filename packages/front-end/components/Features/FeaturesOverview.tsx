import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useMemo, useState } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import {
  PiPlusCircleBold,
  PiArrowsLeftRightBold,
  PiShieldCheckBold,
  PiShieldSlashBold,
  PiPencilSimpleFill,
  PiCaretDownBold,
  PiPencil,
} from "react-icons/pi";
import { FaBoltLightning } from "react-icons/fa6";
import { ago, datetime } from "shared/dates";
import {
  autoMerge,
  checkIfRevisionNeedsReview,
  filterEnvironmentsByFeature,
  getDraftAffectedEnvironments,
  getReviewSetting,
  mergeResultHasChanges,
} from "shared/util";
import { MdRocketLaunch } from "react-icons/md";
import { BiHide, BiShow } from "react-icons/bi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { BsClock } from "react-icons/bs";
import { FeatureUsageLookback } from "shared/types/integrations";
import {
  Box,
  Flex,
  Heading,
  IconButton,
  Separator,
  Text,
} from "@radix-ui/themes";
import {
  SafeRolloutInterface,
  HoldoutInterface,
  MinimalFeatureRevisionInterface,
} from "shared/validators";
import Button from "@/ui/Button";
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
  getRules,
  isRuleInactive,
} from "@/services/features";
import { useFeatureDefaultValues } from "@/hooks/useFeatureDefaultValues";
import { useFeatureDependents } from "@/hooks/useFeatureDependents";
import Modal from "@/components/Modal";
import DraftModal from "@/components/Features/DraftModal";
import DiscussionThread from "@/components/DiscussionThread";
import Tooltip from "@/components/Tooltip/Tooltip";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import EventUser from "@/components/Avatar/EventUser";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import RevertModal from "@/components/Features/RevertModal";
import EditRevisionCommentModal from "@/components/Features/EditRevisionCommentModal";
import FixConflictsModal from "@/components/Features/FixConflictsModal";
import CompareRevisionsModal from "@/components/Features/CompareRevisionsModal";
import RevisionStatusBadge from "@/components/Features/RevisionStatusBadge";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Features/RevisionLabel";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import Markdown from "@/components/Markdown/Markdown";
import EditFeatureDescriptionModal from "@/components/Features/EditFeatureDescriptionModal";
import CustomFieldDisplay, {
  CustomFieldDraftInfo,
} from "@/components/CustomFields/CustomFieldDisplay";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import Switch from "@/ui/Switch";
import Link from "@/ui/Link";
import LoadingSpinner from "@/components/LoadingSpinner";
import JSONValidation from "@/components/Features/JSONValidation";
import DraftControlBadge from "@/components/Features/DraftControlBadge";
import AffectedEnvironmentsBadges from "@/components/Features/AffectedEnvironmentsBadges";
import {
  PrerequisiteStateResult,
  usePrerequisiteStates,
} from "@/hooks/usePrerequisiteStates";
import PrerequisiteStatusRow, {
  PrerequisiteStatesCols,
} from "./PrerequisiteStatusRow";
import PrerequisiteAlerts from "./PrerequisiteAlerts";
import PrerequisiteModal from "./PrerequisiteModal";
import RequestReviewModal from "./RequestReviewModal";
import { FeatureUsageContainer, useFeatureUsage } from "./FeatureUsageGraph";
import FeatureRules from "./FeatureRules";

export default function FeaturesOverview({
  baseFeature,
  feature,
  revision,
  revisionList,
  revisions,
  experiments,
  mutate,
  editProjectModal,
  setEditProjectModal,
  version,
  setVersion,
  safeRollouts,
  holdout,
}: {
  baseFeature: FeatureInterface;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface | null;
  revisionList: MinimalFeatureRevisionInterface[];
  revisions: FeatureRevisionInterface[];
  experiments: ExperimentInterfaceStringDates[] | undefined;
  safeRollouts: SafeRolloutInterface[] | undefined;
  holdout: HoldoutInterface | undefined;
  mutate: () => Promise<unknown>;
  editProjectModal: boolean;
  setEditProjectModal: (b: boolean) => void;
  version: number | null;
  setVersion: (v: number) => void;
}) {
  const settings = useOrgSettings();
  const [edit, setEdit] = useState(false);
  const [draftModal, setDraftModal] = useState(false);
  const [reviewModal, setReviewModal] = useState(false);
  const [conflictModal, setConflictModal] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmNewDraft, setConfirmNewDraft] = useState(false);
  const [newDraftTitle, setNewDraftTitle] = useState("");
  const [editingNewDraftTitle, setEditingNewDraftTitle] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [hideInactive, setHideInactive] = useLocalStorage(
    `hide-disabled-rules`,
    false,
  );
  const [prerequisiteModal, setPrerequisiteModal] = useState<{
    i: number;
  } | null>(null);
  const [showDependents, setShowDependents] = useState(false);
  const permissionsUtil = usePermissionsUtil();

  const [revertIndex, setRevertIndex] = useState(0);

  const [editCommentModel, setEditCommentModal] = useState(false);
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const [compareRevisionsModalOpen, setCompareRevisionsModalOpen] =
    useState(false);

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();

  const featureProject = feature.project;
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const envs = environments.map((e) => e.id);

  const { dependents: dependentsData } = useFeatureDependents(feature?.id);
  const dependentFeatures = dependentsData?.features ?? [];
  const dependentExperiments = dependentsData?.experiments ?? [];
  const dependents = dependentFeatures.length + dependentExperiments.length;

  const mergeResult = useMemo(() => {
    if (!feature || !revision) return null;
    const baseRevision = revisions.find(
      (r) => r.version === revision?.baseVersion,
    );
    const liveRevision = revisions.find((r) => r.version === feature.version);
    if (!revision || !baseRevision || !liveRevision) return null;

    // Revisions only record environmentsEnabled at publish time. Environments
    // added to the org afterwards won't be present in older revisions, causing
    // false-positive diffs. Fill in missing envs from baseFeature (the raw live
    // feature with no draft changes applied) — not `feature`, which is draft-merged
    // and would cause the base to reflect draft values, hiding real diffs.
    const featureEnvs: Record<string, boolean> = Object.fromEntries(
      Object.entries(baseFeature.environmentSettings ?? {}).map(
        ([env, val]) => [env, !!val.enabled],
      ),
    );
    const fillEnvs = (r: typeof liveRevision) => ({
      ...r,
      environmentsEnabled: { ...featureEnvs, ...(r.environmentsEnabled ?? {}) },
    });

    return autoMerge(
      fillEnvs(liveRevision),
      fillEnvs(baseRevision),
      revision,
      environments.map((e) => e.id),
      {},
    );
  }, [revisions, revision, feature, baseFeature, environments]);

  const prerequisites = feature?.prerequisites || [];

  const { defaultValues: prereqDefaultValues } = useFeatureDefaultValues(
    prerequisites.map((p) => p.id),
  );

  // Fetch prerequisite states from backend (handles cross-project prereqs correctly)
  // skipRootConditions: true means we skip the feature's own rules and only evaluate prerequisites
  // Pass version so the backend merges draft prerequisites/kill-switch states before evaluating
  const { states: prereqStatesRaw, loading: prereqStatesLoading } =
    usePrerequisiteStates({
      featureId: feature?.id || "",
      environments: envs,
      enabled: !!feature,
      skipRootConditions: true,
      version,
    });

  // Create a stable serialized key for kill switch states to ensure useMemo recomputes
  const killSwitchKey = envs
    .map(
      (env) =>
        `${env}:${feature?.environmentSettings?.[env]?.enabled ?? false}`,
    )
    .join(",");

  // Compute final summary states by combining prerequisite states with kill switch state
  // This allows the summary to update immediately when toggling kill switches without refetching
  const prereqStates = useMemo(() => {
    if (!prereqStatesRaw || !feature) return prereqStatesRaw;

    const finalStates: Record<string, PrerequisiteStateResult> = {};
    for (const env of envs) {
      // Check kill switch first (same logic as backend)
      if (!feature.environmentSettings?.[env]?.enabled) {
        // Kill switch is OFF - feature is not live regardless of prerequisites
        finalStates[env] = { state: "deterministic", value: null };
      } else {
        // Kill switch is ON - use prerequisite state
        finalStates[env] = prereqStatesRaw[env] || {
          state: "deterministic",
          value: null,
        };
      }
    }
    return finalStates;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prereqStatesRaw, feature, envs, killSwitchKey]);

  const experimentsMap = useMemo<
    Map<string, ExperimentInterfaceStringDates>
  >(() => {
    if (!experiments) return new Map();
    return new Map(experiments.map((exp) => [exp.id, exp]));
  }, [experiments]);

  const safeRolloutsMap = useMemo<Map<string, SafeRolloutInterface>>(() => {
    if (!safeRollouts) return new Map();
    return new Map(safeRollouts.map((rollout) => [rollout.id, rollout]));
  }, [safeRollouts]);

  const { showFeatureUsage, featureUsage, lookback, setLookback } =
    useFeatureUsage();

  const affectedEnvs = useMemo<string[] | "all" | null>(() => {
    const liveRevision = revisions.find((r) => r.version === feature.version);
    if (!revision || !liveRevision) return null;
    const allEnvIds = allEnvironments.map((e) => e.id);
    const liveFeatureEnvs = Object.fromEntries(
      Object.entries(baseFeature?.environmentSettings ?? {}).map(
        ([env, val]) => [env, !!val.enabled],
      ),
    );
    return getDraftAffectedEnvironments(
      revision,
      liveRevision,
      allEnvIds,
      liveFeatureEnvs,
    );
  }, [revision, revisions, feature.version, allEnvironments, baseFeature]);

  if (!baseFeature || !feature || !revision) return null;

  const hasConditionalState =
    prereqStates &&
    Object.values(prereqStates).some((s) => s.state === "conditional");

  const hasPrerequisitesCommercialFeature =
    hasCommercialFeature("prerequisites");

  const currentVersion = version || baseFeature.version;

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

  const projectId = feature.project;

  const hasDraftPublishPermission =
    (approved &&
      permissionsUtil.canPublishFeature(
        feature,
        getAffectedRevisionEnvs(feature, revision, environments),
      )) ||
    (isDraft &&
      !requireReviews &&
      permissionsUtil.canPublishFeature(
        feature,
        getAffectedRevisionEnvs(feature, revision, environments),
      ));

  const drafts = revisions.filter(
    (r) =>
      r.status === "draft" ||
      r.status === "pending-review" ||
      r.status === "changes-requested" ||
      r.status === "approved",
  );
  const isLocked =
    (revision.status === "published" || revision.status === "discarded") &&
    (!isLive || drafts.length > 0);

  // todo: implement multiple array entries for multiple per-project(s) approval configurations
  const featureReviewConfig = getReviewSetting(
    Array.isArray(settings?.requireReviews)
      ? settings.requireReviews
      : settings?.requireReviews === true
        ? [
            {
              requireReviewOn: true,
              resetReviewOnChange: false,
              environments: [],
              projects: [],
            },
          ]
        : [],
    feature,
  );
  const approvalsEngaged = !!featureReviewConfig?.requireReviewOn;
  const killSwitchGated =
    approvalsEngaged &&
    featureReviewConfig?.featureRequireEnvironmentReview !== false;
  const prereqGated = approvalsEngaged;

  // Mirrors RevisionDropdown's gatedEnvs — used for badge coloring in the affected-envs widget.
  const gatedEnvSet: Set<string> | "all" | "none" = (() => {
    if (!approvalsEngaged) return "none";
    const envList = featureReviewConfig?.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  })();
  const metadataReviewRequired =
    approvalsEngaged &&
    featureReviewConfig?.featureRequireMetadataReview !== false;
  const gatedEnvNames: string[] | "all" =
    gatedEnvSet === "all" || gatedEnvSet === "none"
      ? gatedEnvSet === "all"
        ? "all"
        : []
      : environments
          .filter((e) => (gatedEnvSet as Set<string>).has(e.id))
          .map((e) => e.id);

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
          </Button>,
        );
      } else if (revision.version > 1 && isLive) {
        const previousRevision = revisions
          .filter(
            (r) => r.status === "published" && r.version < feature.version,
          )
          .sort((a, b) => b.version - a.version)[0];

        if (previousRevision) {
          actions.push(
            <Button
              variant="ghost"
              color="red"
              onClick={() => {
                setRevertIndex(previousRevision.version);
              }}
              title="Create a new Draft based on this revision"
            >
              Revert to Previous
            </Button>,
          );
        }
      }

      if (drafts.length > 0 && isLocked && !isDraft) {
        // "Switch to active draft" is rendered inline in the context header instead.
      }

      if (!isDraft) {
        actions.push(
          <Button
            key="new-draft"
            loading={creatingDraft}
            onClick={() => setConfirmNewDraft(true)}
            variant="soft"
          >
            New Draft
          </Button>,
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
          </Button>,
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
              </Tooltip>,
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
                  disabled={!revisionHasChanges || !hasDraftPublishPermission}
                  onClick={() => {
                    setDraftModal(true);
                  }}
                >
                  Review &amp; Publish
                </Button>
              </Tooltip>,
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
              </Tooltip>,
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

  // Derive action bar content directly (rendered in the overview tab).
  const revisionCTA = renderRevisionCTA();
  const onCompareRevisions =
    (revisionList?.length ?? 0) >= 2
      ? () => setCompareRevisionsModalOpen(true)
      : undefined;

  const renderRevisionInfo = () => {
    return (
      <Flex direction="column" gap="1">
        <Flex align="center" justify="between">
          <Box>
            <span className="text-muted">Created by</span>{" "}
            <EventUser user={revision.createdBy} display="name" />{" "}
            <span className="text-muted">on</span>{" "}
            {datetime(revision.dateCreated)}
          </Box>
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
          </Flex>
        </Flex>
        <Flex align="center" gap="2">
          <span className="text-muted">Comment:</span>{" "}
          {revision.comment || (
            <em style={{ color: "var(--color-text-mid)" }}>none</em>
          )}
          {canEditDrafts && (
            <IconButton
              variant="ghost"
              color="violet"
              size="2"
              radius="full"
              onClick={() => setEditCommentModal(true)}
              ml="1"
            >
              <PiPencilSimpleFill />
            </IconButton>
          )}
        </Flex>
      </Flex>
    );
  };

  return (
    <>
      <Box className="contents container-fluid pagecontents">
        {revision && (
          <Frame mt="2" mb="4" px="6" py="4">
            <Flex align="start" justify="between" mb="2" wrap="wrap" gap="2">
              <Flex align="start" gap="3" style={{ marginTop: 6 }}>
                <Flex direction="column" gap="1">
                  <Flex align="center" gap="2">
                    {editingTitle ? (
                      <input
                        autoFocus
                        type="text"
                        value={titleDraft}
                        placeholder={`Revision ${revision.version}`}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          } else if (e.key === "Escape") {
                            setEditingTitle(false);
                          }
                        }}
                        onBlur={async () => {
                          setEditingTitle(false);
                          await apiCall(
                            `/feature/${feature.id}/${revision.version}/title`,
                            {
                              method: "PUT",
                              body: JSON.stringify({
                                title: titleDraft.trim(),
                              }),
                            },
                          );
                          await mutate();
                        }}
                        style={{
                          maxWidth: 250,
                          fontWeight: "bold",
                          fontSize: "var(--font-size-3)",
                          border: "none",
                          borderBottom: "2px solid var(--violet-9)",
                          outline: "none",
                          background: "transparent",
                          padding: "0 2px",
                        }}
                      />
                    ) : (
                      <Text weight="bold">
                        <OverflowText
                          maxWidth={250}
                          title={revisionLabelText(
                            revision.version,
                            revision.title,
                          )}
                        >
                          <RevisionLabel
                            version={revision.version}
                            title={revision.title}
                            numbered={false}
                          />
                        </OverflowText>
                      </Text>
                    )}
                    <RevisionStatusBadge
                      revision={revision}
                      liveVersion={feature.version}
                    />
                    {isDraft && canEditDrafts && !editingTitle && (
                      <IconButton
                        variant="ghost"
                        color="violet"
                        size="2"
                        radius="full"
                        onClick={() => {
                          setTitleDraft(revision.title || "");
                          setEditingTitle(true);
                        }}
                        ml="1"
                      >
                        <PiPencilSimpleFill />
                      </IconButton>
                    )}
                  </Flex>
                  {isDraft &&
                    baseRevision &&
                    baseRevision.version !== feature.version && (
                      <Text as="span" size="1" color="gray">
                        based on{" "}
                        <Text as="span" size="1" weight="medium">
                          Revision {baseRevision.version}
                        </Text>
                      </Text>
                    )}
                </Flex>
                {drafts.length > 0 && isLocked && !isDraft && (
                  <>
                    <Separator
                      orientation="vertical"
                      style={{ marginTop: 2 }}
                    />
                    {drafts.length === 1 ? (
                      <Link onClick={() => setVersion(drafts[0].version)}>
                        Switch to active draft
                      </Link>
                    ) : (
                      <RevisionDropdown
                        feature={feature}
                        revisions={revisionList || []}
                        version={version ?? feature.version}
                        setVersion={setVersion}
                        draftsOnly
                        menuPlacement="start"
                        customTrigger={
                          <Link>
                            Switch to active draft
                            <PiCaretDownBold
                              style={{ marginLeft: 4, verticalAlign: "middle" }}
                            />
                          </Link>
                        }
                      />
                    )}
                  </>
                )}
                {isDraft && !isLive && (
                  <>
                    <Separator
                      orientation="vertical"
                      style={{ marginTop: 2 }}
                    />
                    <Link onClick={() => setVersion(feature.version)}>
                      See live revision
                    </Link>
                  </>
                )}
                {onCompareRevisions && (
                  <>
                    <Separator
                      orientation="vertical"
                      style={{ marginTop: 2 }}
                    />
                    <Link onClick={onCompareRevisions}>
                      <PiArrowsLeftRightBold
                        style={{ marginRight: 4, verticalAlign: "middle" }}
                      />
                      Compare revisions
                    </Link>
                  </>
                )}
              </Flex>
              <Flex align="center" justify="end" gap="2" flexGrow="1">
                {revisionCTA}
              </Flex>
            </Flex>
            {affectedEnvs !== null && (
              <Flex mt="1" mb="2">
                <AffectedEnvironmentsBadges
                  affectedEnvs={affectedEnvs}
                  gatedEnvSet={gatedEnvSet}
                />
              </Flex>
            )}
            <Separator size="4" my="3" />
            {renderRevisionInfo()}
            {isLocked && !isLive ? (
              <Callout status="info" mt="2" mb="0">
                This revision has been <strong>locked</strong>. It is no longer
                live and cannot be modified.
              </Callout>
            ) : null}
            {!approvalsEngaged && (
              <Callout
                status="info"
                color="gray"
                icon={<PiShieldSlashBold size={16} />}
                mt="2"
                mb="0"
                size="sm"
              >
                Approvals are <em>not</em> required to publish changes.
              </Callout>
            )}
            {approvalsEngaged &&
              (killSwitchGated || prereqGated || metadataReviewRequired) && (
                <Callout
                  status="info"
                  icon={<PiShieldCheckBold size={16} />}
                  mt="2"
                  mb="0"
                  size="sm"
                >
                  <Flex direction="column" gap="1">
                    {approvalsEngaged && (
                      <div>
                        {killSwitchGated
                          ? "Rule, value, and kill switch changes"
                          : "Rule and value changes"}{" "}
                        require approval in{" "}
                        <strong>
                          {gatedEnvNames === "all"
                            ? "all environments"
                            : gatedEnvNames.join(", ")}
                        </strong>
                        .
                      </div>
                    )}
                    {(prereqGated || metadataReviewRequired) && (
                      <div>
                        {prereqGated && metadataReviewRequired
                          ? "Prerequisite and metadata changes"
                          : prereqGated
                            ? "Prerequisite changes"
                            : "Metadata changes"}{" "}
                        require approvals.
                      </div>
                    )}
                  </Flex>
                </Callout>
              )}
            {(approvalsEngaged ||
              killSwitchGated ||
              prereqGated ||
              metadataReviewRequired) &&
              (() => {
                const exempt = [
                  !approvalsEngaged && "rule and value",
                  !killSwitchGated && "kill switch",
                  !prereqGated && "prerequisite",
                  !metadataReviewRequired && "metadata",
                ].filter(Boolean) as string[];
                if (!exempt.length) return null;
                const label =
                  exempt.length === 1
                    ? exempt[0]
                    : exempt.slice(0, -1).join(", ") +
                      " and " +
                      exempt[exempt.length - 1];
                return (
                  <Callout
                    status="info"
                    color="gray"
                    icon={<PiShieldSlashBold size={16} />}
                    mt="2"
                    mb="0"
                    size="sm"
                  >
                    {label.charAt(0).toUpperCase() + label.slice(1)} changes do{" "}
                    <em>not</em> require approval.
                  </Callout>
                );
              })()}
          </Frame>
        )}

        <Frame mt="2" mb="4" px="6" py="4">
          <Flex align="center" justify="between" mb="2">
            <Flex align="center" gap="1">
              <Heading as="h3" size="4" mb="0">
                Description
              </Heading>
              <DraftControlBadge
                gated={metadataReviewRequired}
                approvalsEnabled={approvalsEngaged}
              />
            </Flex>
            {canEdit && canEditDrafts && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDescriptionModal(true)}
              >
                Edit
              </Button>
            )}
          </Flex>
          <Box className="mh-350px" style={{ overflowY: "auto" }}>
            {feature.description ? (
              <Markdown className="card-text">{feature.description}</Markdown>
            ) : (
              <Box as="div" className="font-italic text-muted">
                Add context about this feature for your team
              </Box>
            )}
          </Box>

          <CustomFieldDisplay
            target={feature}
            canEdit={canEdit}
            mutate={mutate}
            section={"feature"}
            mt="6"
            showApprovalBadge={approvalsEngaged}
            draftInfo={
              {
                feature,
                revisionList: revisionList || [],
                gatedEnvSet: metadataReviewRequired ? "all" : "none",
                onDraftCreated: (v) => setVersion(v),
              } satisfies CustomFieldDraftInfo
            }
          />
        </Frame>

        <Box mt="3">
          <CustomMarkdown page={"feature"} variables={variables} />

          {showFeatureUsage && (
            <Frame mt="2" mb="4" px="6" py="4">
              <Flex align="center" justify="between" mb="2">
                <Heading as="h3" size="4" mb="0">
                  Usage Analytics
                </Heading>
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
                        {o.label}
                        <Badge
                          label={
                            <>
                              <FaBoltLightning /> Live
                            </>
                          }
                          color="teal"
                          variant="solid"
                          radius="full"
                          ml="3"
                        />
                      </div>
                    );
                  }}
                />
              </Flex>
              {!featureUsage ? (
                <Flex align="center" justify="center">
                  <LoadingSpinner /> <Text ml="2">Loading...</Text>
                </Flex>
              ) : featureUsage.total === 0 ? (
                <em>No usage detected in the selected time frame</em>
              ) : (
                <FeatureUsageContainer
                  revision={revision}
                  environments={envs}
                  valueType={feature.valueType}
                />
              )}
            </Frame>
          )}
        </Box>
        <Frame mb="4" px="6" py="4">
          <Box>
            <Flex align="center" gap="1" mb="2">
              <Heading as="h3" size="4" mb="0">
                Environment Status
              </Heading>
              <DraftControlBadge
                gated={killSwitchGated}
                approvalsEnabled={approvalsEngaged}
              />
            </Flex>
            <div className="mb-4">
              When disabled, this feature will evaluate to <code>null</code>.
              The default value and rules will be ignored.
            </div>
            {prerequisites.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table className="table border mb-2 w-100">
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
                                  included in at least one environment to use
                                  it.
                                </div>
                              </>
                            }
                          />
                          <div
                            className="float-right small position-relative"
                            style={{ top: 5 }}
                          >
                            <Link href="/environments">
                              Manage Environments
                            </Link>
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
                        <td key={env} style={{ minWidth: 120 }}>
                          <Flex align="center" justify="center">
                            <EnvironmentToggle
                              feature={feature}
                              baseFeature={baseFeature}
                              environment={env}
                              mutate={mutate}
                              setVersion={setVersion}
                              currentVersion={currentVersion}
                              revisionList={revisionList || []}
                              id={`${env}_toggle`}
                              isLocked={false}
                            />
                          </Flex>
                        </td>
                      ))}
                      <td className="w-100" />
                    </tr>
                    {prerequisites.map(({ ...item }, i) => {
                      return (
                        <PrerequisiteStatusRow
                          key={i}
                          i={i}
                          feature={feature}
                          prereqDefaultValue={prereqDefaultValues[item.id]}
                          prerequisite={item}
                          environments={environments}
                          mutate={mutate}
                          setVersion={setVersion}
                          setPrerequisiteModal={setPrerequisiteModal}
                          revisionList={revisionList || []}
                          gatedEnvSet={gatedEnvSet}
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
                          loading={prereqStatesLoading}
                        />
                      )}
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <Flex
                mt="4"
                justify="start"
                align="center"
                gapX="4"
                gapY="3"
                wrap="wrap"
              >
                {environments.length > 0 ? (
                  environments.map((en) => (
                    <Flex
                      wrap="nowrap"
                      direction="row"
                      gap="2"
                      key={en.id}
                      mr="4"
                    >
                      <label
                        className="font-weight-bold mb-0"
                        htmlFor={`${en.id}_toggle`}
                      >
                        {en.id}:{" "}
                      </label>
                      <EnvironmentToggle
                        feature={feature}
                        baseFeature={baseFeature}
                        environment={en.id}
                        mutate={mutate}
                        setVersion={setVersion}
                        currentVersion={currentVersion}
                        revisionList={revisionList || []}
                        id={`${en.id}_toggle`}
                        isLocked={false}
                      />
                    </Flex>
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
              </Flex>
            )}

            {hasConditionalState && (
              <PrerequisiteAlerts
                environments={envs}
                type="feature"
                project={projectId ?? ""}
                mt="4"
                mb="0"
              />
            )}

            {canEdit && canEditDrafts && (
              <PremiumTooltip
                commercialFeature="prerequisites"
                className="d-inline-flex align-items-center mt-3"
              >
                <Link
                  onClick={() => {
                    if (!hasPrerequisitesCommercialFeature) {
                      return;
                    }
                    setPrerequisiteModal({
                      i: getPrerequisites(feature).length,
                    });
                    track("Viewed prerequisite feature modal", {
                      source: "add-prerequisite",
                    });
                  }}
                  style={{
                    opacity: !hasPrerequisitesCommercialFeature ? 0.5 : 1,
                    cursor: !hasPrerequisitesCommercialFeature
                      ? "not-allowed"
                      : "pointer",
                  }}
                >
                  <Text weight="bold">
                    <PiPlusCircleBold className="mr-1" />
                    Add prerequisite targeting
                  </Text>
                </Link>
              </PremiumTooltip>
            )}
          </Box>
        </Frame>
        {(dependents > 0 || featureProject) && (
          <Frame mb="4" px="6" py="4">
            <Flex mb="2" gap="2" align="center">
              <Heading size="4" as="h3" mb="0">
                Dependents
              </Heading>
              <Badge label={dependents + ""} color="gray" />
            </Flex>
            {dependents > 0 ? (
              <>
                <Text as="p" size="2" mb="2">
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
                </Text>
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
              </>
            ) : (
              <Text size="2">No dependents found.</Text>
            )}
          </Frame>
        )}

        {feature.valueType === "json" && (
          <Frame mb="4" px="6" py="4">
            <JSONValidation
              feature={feature}
              mutate={mutate}
              setVersion={setVersion}
              revisionList={revisionList || []}
            />
          </Frame>
        )}

        {revision && (
          <>
            <Frame mt="4" px="6" py="4">
              <Flex align="center" justify="between">
                <Flex align="center" gap="1" mb="3">
                  <Heading as="h3" size="4" mb="0">
                    Default Value
                  </Heading>
                  <DraftControlBadge
                    gated={approvalsEngaged}
                    alwaysDrafted
                    approvalsEnabled={approvalsEngaged}
                  />
                </Flex>
                {canEdit && canEditDrafts && (
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
                <Flex width="100%">
                  <Box flexGrow="1">
                    <ForceSummary
                      value={getFeatureDefaultValue(feature)}
                      feature={feature}
                    />
                  </Box>
                </Flex>
              </Box>

              <Box
                mt="6"
                pt="4"
                style={{ borderTop: "1px solid var(--gray-a4)" }}
              >
                <Flex align="center" justify="between" mb="2">
                  <Flex align="center" gap="1">
                    <Heading as="h3" size="4" mb="0">
                      Rules
                    </Heading>
                    <DraftControlBadge
                      gated={approvalsEngaged}
                      alwaysDrafted
                      approvalsEnabled={approvalsEngaged}
                    />
                  </Flex>
                  <label className="font-weight-semibold">
                    <Switch
                      disabled={!hasInactiveRules}
                      value={!hasInactiveRules ? false : !hideInactive}
                      onChange={(state) => setHideInactive(!state)}
                      label="Show inactive"
                    />
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
                      experimentsMap={experimentsMap}
                      mutate={mutate}
                      currentVersion={currentVersion}
                      setVersion={setVersion}
                      hideInactive={hideInactive}
                      isDraft={isDraft}
                      safeRolloutsMap={safeRolloutsMap}
                      holdout={holdout}
                      revisionList={revisionList || []}
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
            </Frame>
          </>
        )}

        <Frame mb="4" px="6" py="4">
          <Heading as="h3" size="4" mb="3">
            Comments
          </Heading>
          <DiscussionThread
            type="feature"
            id={feature.id}
            projects={feature.project ? [feature.project] : []}
          />
        </Frame>

        {/* Modals */}

        {showDescriptionModal && (
          <EditFeatureDescriptionModal
            close={() => setShowDescriptionModal(false)}
            feature={feature}
            revisionList={revisionList || []}
            mutate={mutate}
            setVersion={setVersion}
          />
        )}

        {edit && (
          <EditDefaultValueModal
            close={() => setEdit(false)}
            feature={feature}
            revisionList={revisionList || []}
            mutate={mutate}
            version={currentVersion}
            setVersion={setVersion}
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
                (r) => r.version === revertIndex,
              ) as FeatureRevisionInterface
            }
            mutate={mutate}
            setVersion={setVersion}
          />
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
                  },
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
        {confirmNewDraft && (
          <Modal
            trackingEventModalType="create-new-draft"
            open={true}
            close={() => {
              setConfirmNewDraft(false);
              setNewDraftTitle("");
              setEditingNewDraftTitle(false);
            }}
            header="Create New Draft"
            cta="Create Draft"
            loading={creatingDraft}
            submit={async () => {
              setCreatingDraft(true);
              try {
                const res = await apiCall<{ draftVersion: number }>(
                  `/feature/${feature.id}/draft`,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      ...(newDraftTitle.trim()
                        ? { title: newDraftTitle.trim() }
                        : {}),
                    }),
                  },
                );
                await mutate();
                setVersion(res.draftVersion);
              } finally {
                setCreatingDraft(false);
              }
            }}
          >
            <Flex direction="column" gap="2">
              <Text>You are about to create a new draft:</Text>
              <Flex align="center" gap="2">
                {editingNewDraftTitle ? (
                  <input
                    autoFocus
                    type="text"
                    value={newDraftTitle}
                    placeholder={`Revision ${Math.max(0, ...revisionList.map((r) => r.version)) + 1}`}
                    onChange={(e) => setNewDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      } else if (e.key === "Escape") {
                        setEditingNewDraftTitle(false);
                      }
                    }}
                    onBlur={() => setEditingNewDraftTitle(false)}
                    style={{
                      fontWeight: "bold",
                      fontSize: "var(--font-size-3)",
                      border: "none",
                      borderBottom: "2px solid var(--violet-9)",
                      outline: "none",
                      background: "transparent",
                      padding: "0 2px",
                      minWidth: 0,
                      flex: 1,
                    }}
                  />
                ) : (
                  <Text weight="bold">
                    {newDraftTitle.trim()
                      ? newDraftTitle.trim()
                      : `Revision ${Math.max(0, ...revisionList.map((r) => r.version)) + 1}`}
                  </Text>
                )}
                <RevisionStatusBadge
                  revision={{ status: "draft" } as FeatureRevisionInterface}
                  liveVersion={feature.version}
                />
                {!editingNewDraftTitle && (
                  <IconButton
                    variant="ghost"
                    color="violet"
                    size="2"
                    radius="full"
                    onClick={() => setEditingNewDraftTitle(true)}
                    ml="1"
                  >
                    <PiPencilSimpleFill />
                  </IconButton>
                )}
              </Flex>
              <Flex align="center" gap="2">
                <Text>Based on:</Text>
                <Text weight="medium">Revision {feature.version}</Text>
                <RevisionStatusBadge
                  revision={revisions.find(
                    (r) => r.version === feature.version,
                  )}
                  liveVersion={feature.version}
                />
              </Flex>
            </Flex>
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
            revisionList={revisionList || []}
            close={() => setPrerequisiteModal(null)}
            i={prerequisiteModal.i}
            mutate={mutate}
            setVersion={setVersion}
          />
        )}
        {compareRevisionsModalOpen && (
          <CompareRevisionsModal
            feature={feature}
            baseFeature={baseFeature}
            revisionList={revisionList || []}
            revisions={revisions}
            currentVersion={version ?? feature.version}
            onClose={() => setCompareRevisionsModalOpen(false)}
            initialPreviewDraft={isDraft ? (version ?? undefined) : undefined}
            initialMode={isLive && !isDraft ? "most-recent-live" : undefined}
          />
        )}
      </Box>
      {(isDraft || isPendingReview) && (
        <div
          style={{
            position: "fixed",
            bottom: -10,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            whiteSpace: "nowrap",
            boxShadow: "var(--shadow-3)",
            borderRadius: "var(--radius-4)",
            backgroundColor: "var(--color-panel-solid)",
          }}
        >
          <Callout status="warning" icon={<PiPencil size={18} />}>
            <Box mb="3">
              Viewing a <strong>draft</strong> —{" "}
              {isPendingReview
                ? "changes will not go live until approved and published"
                : "changes will not go live until published"}
            </Box>
          </Callout>
        </div>
      )}
    </>
  );
}
