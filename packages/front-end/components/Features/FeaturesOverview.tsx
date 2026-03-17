import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useMemo, useState, useEffect, useRef } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import {
  PiPlusCircleBold,
  PiPlus,
  PiArrowsLeftRightBold,
  PiPencilSimpleFill,
  PiCaretDownBold,
  PiCaretRightBold,
  PiPencil,
} from "react-icons/pi";
import { ago, datetime } from "shared/dates";
import {
  autoMerge,
  checkIfRevisionNeedsReview,
  fillRevisionFromFeature,
  liveRevisionFromFeature,
  filterEnvironmentsByFeature,
  getReviewSetting,
  draftDiffersFromLive,
} from "shared/util";
import { MdRocketLaunch } from "react-icons/md";
import { BiHide, BiShow } from "react-icons/bi";
import Collapsible from "react-collapsible";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { BsClock } from "react-icons/bs";
import { Box, Flex, Heading, IconButton, Separator } from "@radix-ui/themes";
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
import Field from "@/components/Forms/Field";
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
import {
  useCustomFields,
  filterCustomFieldsForSectionAndProject,
} from "@/hooks/useCustomFields";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useScrollPosition } from "@/hooks/useScrollPosition";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import Switch from "@/ui/Switch";
import Link from "@/ui/Link";
import JSONValidation from "@/components/Features/JSONValidation";
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
  const [newDraftTitleStash, setNewDraftTitleStash] = useState("");
  const [editingNewDraftTitle, setEditingNewDraftTitle] = useState(false);
  const [newDraftNotes, setNewDraftNotes] = useState("");
  const [showNewDraftNotes, setShowNewDraftNotes] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [hideInactive, setHideInactive] = useLocalStorage(
    `hide-disabled-rules`,
    false,
  );
  const [descriptionExpanded, setDescriptionExpanded] = useLocalStorage(
    `feature-description-expanded`,
    false,
  );
  const [prerequisiteModal, setPrerequisiteModal] = useState<{
    i: number;
  } | null>(null);
  const [showDependents, setShowDependents] = useState(false);
  const permissionsUtil = usePermissionsUtil();

  const [revertIndex, setRevertIndex] = useState(0);

  const [editCommentModel, setEditCommentModal] = useState(false);
  const [commentExpanded, setCommentExpanded] = useState(false);
  useEffect(() => {
    setCommentExpanded(false);
  }, [revision?.version]);
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const [compareRevisionsModalOpen, setCompareRevisionsModalOpen] =
    useState(false);

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();

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

    // Fill sparse revisions from baseFeature to avoid false-positive env diffs.
    const result = autoMerge(
      liveRevisionFromFeature(liveRevision, baseFeature),
      fillRevisionFromFeature(baseRevision, baseFeature),
      revision,
      environments.map((e) => e.id),
      {},
    );
    return result;
  }, [revisions, revision, feature, baseFeature, environments]);

  const prerequisites = feature?.prerequisites || [];

  const { defaultValues: prereqDefaultValues } = useFeatureDefaultValues(
    prerequisites.map((p) => p.id),
  );

  const { states: prereqStatesRaw, loading: prereqStatesLoading } =
    usePrerequisiteStates({
      featureId: feature?.id || "",
      environments: envs,
      enabled: !!feature,
      skipRootConditions: true,
      version,
    });

  const killSwitchKey = envs
    .map(
      (env) =>
        `${env}:${feature?.environmentSettings?.[env]?.enabled ?? false}`,
    )
    .join(",");

  // Combine prereq states with kill switch so toggles reflect immediately without refetching.
  const prereqStates = useMemo(() => {
    if (!prereqStatesRaw || !feature) return prereqStatesRaw;

    const finalStates: Record<string, PrerequisiteStateResult> = {};
    for (const env of envs) {
      if (!feature.environmentSettings?.[env]?.enabled) {
        finalStates[env] = { state: "deterministic", value: null };
      } else {
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

  const allCustomFields = useCustomFields();

  const revisionHasChanges = useMemo(() => {
    if (
      !revision ||
      revision.status === "published" ||
      revision.status === "discarded"
    )
      return false;
    const liveRevision = revisions.find((r) => r.version === feature.version);
    if (!liveRevision) return false;
    return draftDiffersFromLive(
      revision,
      liveRevision,
      baseFeature,
      environments.map((e) => e.id),
    );
  }, [revision, revisions, feature, baseFeature, environments]);

  const bannerRef = useRef<HTMLDivElement>(null);
  const [bannerPinned, setBannerPinned] = useState(false);
  const { scrollY } = useScrollPosition();
  useEffect(() => {
    if (!bannerRef.current) return;
    setBannerPinned(bannerRef.current.getBoundingClientRect().top <= 110);
  }, [scrollY]);

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
  if (baseRevision) {
    // Fill sparse revisions before diffing (same as autoMerge).
    const filledBaseRevision = {
      ...baseRevision,
      ...fillRevisionFromFeature(baseRevision, baseFeature),
    };
    const filledRevision = {
      ...revision,
      ...fillRevisionFromFeature(revision, baseFeature),
    };

    // If the draft has diverged, diff the merged result against live rather than the raw base.
    let effectiveRevision: typeof filledRevision = filledRevision;
    let effectiveBase: typeof filledBaseRevision = filledBaseRevision;
    const liveRevision = revisions.find((r) => r.version === feature.version);
    if (mergeResult?.success && liveRevision) {
      const filledLive = {
        ...liveRevision,
        ...liveRevisionFromFeature(liveRevision, baseFeature),
      };
      effectiveRevision = { ...filledLive, ...mergeResult.result };
      effectiveBase = filledLive;
    }

    requireReviews = checkIfRevisionNeedsReview({
      feature,
      baseRevision: effectiveBase,
      revision: effectiveRevision,
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
  const isDiscarded = revision.status === "discarded";
  // True when browsing a read-only historical snapshot: an old published revision or a discarded one.
  // Distinct from isLocked, which also fires for the live revision when active drafts exist.
  const isReadOnly =
    isDiscarded || (revision.status === "published" && !isLive);

  // TODO: support multiple per-project approval configs
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
  const gatedEnvSet: Set<string> | "all" | "none" = (() => {
    if (!approvalsEngaged) return "none";
    const envList = featureReviewConfig?.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  })();
  const metadataReviewRequired =
    approvalsEngaged &&
    featureReviewConfig?.featureRequireMetadataReview !== false;

  const canEdit = permissionsUtil.canViewFeatureModal(projectId);
  const canEditDrafts = permissionsUtil.canManageFeatureDrafts(feature);

  const featureCustomFields = filterCustomFieldsForSectionAndProject(
    allCustomFields,
    "feature",
    feature.project,
  );
  const hasCustomFields = (featureCustomFields?.length ?? 0) > 0;

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
      if (isLocked && !isLive && !isDiscarded) {
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
        const liveRevision = revisions.find(
          (r) => r.version === feature.version,
        );
        const livePublishedAt = liveRevision?.datePublished
          ? new Date(liveRevision.datePublished).getTime()
          : Infinity;
        const previousRevision = revisions
          .filter(
            (r) =>
              r.status === "published" &&
              r.version !== feature.version &&
              r.datePublished != null &&
              new Date(r.datePublished).getTime() < livePublishedAt,
          )
          .sort((a, b) => {
            const bt = b.datePublished
              ? new Date(b.datePublished).getTime()
              : 0;
            const at = a.datePublished
              ? new Date(a.datePublished).getTime()
              : 0;
            return bt - at;
          })[0];

        if (previousRevision) {
          actions.push(
            <Button
              variant="ghost"
              color="red"
              onClick={() => {
                setRevertIndex(previousRevision.version);
              }}
            >
              Revert to Previous
            </Button>,
          );
        }
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
        <Flex align="start" gap="2" style={{ width: "fit-content" }}>
          <span className="text-muted">Revision notes:</span>{" "}
          {revision.comment ? (
            <Flex align="start" gap="1">
              <Box>
                {!commentExpanded && revision.comment.length > 80
                  ? revision.comment.slice(0, 80) + "…"
                  : revision.comment}
                {revision.comment.length > 80 && !commentExpanded && (
                  <Link
                    onClick={() => setCommentExpanded((v) => !v)}
                    ml="1"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    show more
                  </Link>
                )}
                {revision.comment.length > 80 && commentExpanded && (
                  <Box mt="1">
                    <Link
                      onClick={() => setCommentExpanded((v) => !v)}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      show less
                    </Link>
                  </Box>
                )}
              </Box>
              {canEditDrafts && (
                <IconButton
                  variant="ghost"
                  color="violet"
                  size="2"
                  radius="full"
                  onClick={() => setEditCommentModal(true)}
                  style={{
                    flexShrink: 0,
                    marginTop: -2,
                    marginBottom: -2,
                    marginLeft: 4,
                    marginRight: 0,
                  }}
                >
                  <PiPencilSimpleFill />
                </IconButton>
              )}
            </Flex>
          ) : (
            <>
              <em style={{ color: "var(--color-text-mid)" }}>none</em>
              {canEditDrafts && (
                <IconButton
                  variant="ghost"
                  color="violet"
                  size="2"
                  radius="full"
                  onClick={() => setEditCommentModal(true)}
                  style={{
                    flexShrink: 0,
                    marginTop: -2,
                    marginBottom: -2,
                    marginLeft: 4,
                    marginRight: 0,
                  }}
                >
                  <PiPencilSimpleFill />
                </IconButton>
              )}
            </>
          )}
        </Flex>
      </Flex>
    );
  };

  return (
    <>
      <Box className="contents container-fluid pagecontents">
        {(isDraft || isPendingReview) && (
          <div
            ref={bannerRef}
            style={{
              position: "sticky",
              top: 110,
              zIndex: 920,
              marginBottom: 12,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "100%",
                backgroundColor: "var(--color-background)",
                borderRadius: "var(--radius-3)",
                overflow: "hidden",
                maxWidth: bannerPinned ? "580px" : "2000px",
                boxShadow: bannerPinned ? "var(--shadow-4)" : undefined,
                transition: "all 200ms ease",
              }}
            >
              <Flex
                align="center"
                justify="center"
                gap="2"
                px="4"
                py="3"
                style={{
                  color: "var(--amber-11)",
                  backgroundColor: "var(--amber-a3)",
                }}
              >
                <PiPencil size={18} />
                <span style={{ fontSize: "var(--font-size-2)" }}>
                  Viewing a <strong>draft</strong> —{" "}
                  {isPendingReview
                    ? "changes will not go live until approved and published"
                    : "changes will not go live until published"}
                </span>
              </Flex>
            </div>
          </div>
        )}
        {revision && (
          <Frame mt="2" mb="4" px="6" py="4">
            <Flex align="start" justify="between" mb="2" wrap="wrap" gap="2">
              <Flex align="start" gap="3" style={{ marginTop: 6 }}>
                <Flex direction="column" gap="1">
                  <Flex align="center" gap="2">
                    {revision.title && (
                      <span
                        style={{
                          display: "inline-block",
                          fontVariantNumeric: "tabular-nums",
                          flexShrink: 0,
                        }}
                      >
                        <Text as="span" color="text-mid" size="small">
                          {revision.version}.
                        </Text>
                      </span>
                    )}
                    {editingTitle ? (
                      <Field
                        autoFocus
                        value={titleDraft}
                        placeholder={`Revision ${revision.version}`}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            setEditingTitle(false);
                            const next = titleDraft.trim();
                            if (next !== (revision.title ?? "")) {
                              await apiCall(
                                `/feature/${feature.id}/${revision.version}/title`,
                                {
                                  method: "PUT",
                                  body: JSON.stringify({ title: next }),
                                },
                              );
                              await mutate();
                            }
                          } else if (e.key === "Escape") {
                            setEditingTitle(false);
                            setTitleDraft(revision.title || "");
                          }
                        }}
                        onBlur={async () => {
                          setEditingTitle(false);
                          const next = titleDraft.trim();
                          if (next !== (revision.title ?? "")) {
                            await apiCall(
                              `/feature/${feature.id}/${revision.version}/title`,
                              {
                                method: "PUT",
                                body: JSON.stringify({ title: next }),
                              },
                            );
                            await mutate();
                          }
                        }}
                        containerStyle={{ maxWidth: 250, marginBottom: 0 }}
                        style={{
                          border: "none",
                          borderBottom: "1px solid var(--violet-9)",
                          borderCollapse: "collapse",
                          borderRadius: 0,
                          outline: "none",
                          background: "transparent",
                          boxShadow: "none",
                          padding: "0 2px",
                          height: "auto",
                        }}
                      />
                    ) : (
                      <Text weight="semibold">
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
                        mx="1"
                      >
                        <PiPencilSimpleFill />
                      </IconButton>
                    )}
                    <RevisionStatusBadge
                      revision={revision}
                      liveVersion={feature.version}
                    />
                  </Flex>
                  {isDraft &&
                    baseRevision &&
                    baseRevision.version !== feature.version && (
                      <Text as="span" size="small" color="text-low">
                        based on{" "}
                        <Text as="span" size="small" weight="medium">
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
                {((isDraft && !isLive) ||
                  (isLocked && !isDraft && drafts.length === 0 && !isLive)) && (
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
            <Separator size="4" my="3" />
            {renderRevisionInfo()}
          </Frame>
        )}

        <Frame mt="2" mb="4" px="0" py="0" style={{ overflow: "hidden" }}>
          <Collapsible
            open={descriptionExpanded}
            handleTriggerClick={() =>
              setDescriptionExpanded(!descriptionExpanded)
            }
            transitionTime={100}
            trigger={
              <Flex
                align="center"
                justify="between"
                px="6"
                py="2"
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                <Flex align="center" gap="1">
                  <Heading as="h4" size="3" mb="0">
                    {hasCustomFields && !descriptionExpanded
                      ? "Description & Additional Fields"
                      : "Description"}
                  </Heading>
                </Flex>
                <Flex align="center" gap="2">
                  {canEdit && canEditDrafts && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async (e) => {
                        e?.stopPropagation();
                        setShowDescriptionModal(true);
                      }}
                    >
                      Edit
                    </Button>
                  )}
                  <PiCaretRightBold
                    className="chevron-right"
                    style={{ flexShrink: 0 }}
                  />
                </Flex>
              </Flex>
            }
          >
            <Box px="6" pb="4">
              <Box className="mh-350px" style={{ overflowY: "auto" }} mb="2">
                {feature.description ? (
                  <Markdown className="card-text">
                    {feature.description}
                  </Markdown>
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
                mt="4"
                draftInfo={
                  {
                    feature,
                    revisionList: revisionList || [],
                    gatedEnvSet: metadataReviewRequired ? "all" : "none",
                    onDraftCreated: (v) => setVersion(v),
                  } satisfies CustomFieldDraftInfo
                }
              />
            </Box>
          </Collapsible>
        </Frame>

        <Box mt="3">
          <CustomMarkdown page={"feature"} variables={variables} />
        </Box>
        <Frame mb="4" px="6" py="4">
          <Box>
            <Flex align="center" gap="1" mb="2">
              <Heading as="h4" size="3" mb="0">
                Environment Status
              </Heading>
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
                              isLocked={isReadOnly}
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
                          isLocked={isReadOnly}
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
                        isLocked={isReadOnly}
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

            {canEdit && canEditDrafts && !isReadOnly && (
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
                  <Text weight="semibold">
                    <PiPlusCircleBold className="mr-1" />
                    Add prerequisite targeting
                  </Text>
                </Link>
              </PremiumTooltip>
            )}
          </Box>
        </Frame>
        {dependents > 0 && (
          <Frame mb="4" px="6" py="4">
            <Flex mb="2" gap="2" align="center">
              <Heading size="3" as="h4" mb="0">
                Dependents
              </Heading>
              <Badge label={dependents + ""} color="gray" />
            </Flex>
            {dependents > 0 && (
              <>
                <Text as="p" mb="2">
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
                  <Heading as="h4" size="3" mb="0">
                    Default Value
                  </Heading>
                </Flex>
                {canEdit && canEditDrafts && !isReadOnly && (
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
                    <Heading as="h4" size="3" mb="0">
                      Rules
                    </Heading>
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
                      baseFeature={baseFeature}
                      isLocked={isReadOnly}
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
          <Heading as="h4" size="3" mb="3">
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
            allRevisions={revisions}
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
            useRadixButton={true}
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
              setNewDraftTitleStash("");
              setEditingNewDraftTitle(false);
              setNewDraftNotes("");
              setShowNewDraftNotes(false);
            }}
            header="Create New Draft"
            cta="Create Draft"
            loading={creatingDraft}
            useRadixButton={true}
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
                      ...(newDraftNotes.trim()
                        ? { comment: newDraftNotes.trim() }
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
              <Text>
                Creating a <Text weight="semibold">new draft</Text> based on{" "}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    whiteSpace: "nowrap",
                    backgroundColor: "var(--gray-a2)",
                    padding: "1px 4px",
                    margin: "2px",
                    borderRadius: "var(--radius-2)",
                  }}
                >
                  <Text
                    as="span"
                    size="medium"
                    weight="semibold"
                    color="text-high"
                  >
                    <OverflowText
                      maxWidth={200}
                      title={revisionLabelText(
                        feature.version,
                        revisions.find((r) => r.version === feature.version)
                          ?.title,
                      )}
                    >
                      <RevisionLabel
                        version={feature.version}
                        title={
                          revisions.find((r) => r.version === feature.version)
                            ?.title
                        }
                      />
                    </OverflowText>
                  </Text>
                  <RevisionStatusBadge
                    revision={revisions.find(
                      (r) => r.version === feature.version,
                    )}
                    liveVersion={feature.version}
                  />
                </span>
              </Text>
              <Box my="3">
                <Flex align="center" gap="2">
                  {newDraftTitle.trim() && !editingNewDraftTitle && (
                    <span
                      style={{
                        display: "inline-block",
                        fontVariantNumeric: "tabular-nums",
                        flexShrink: 0,
                      }}
                    >
                      <Text as="span" color="text-mid" size="small">
                        {Math.max(0, ...revisionList.map((r) => r.version)) + 1}
                        .
                      </Text>
                    </span>
                  )}
                  {editingNewDraftTitle ? (
                    <Field
                      autoFocus
                      value={newDraftTitle}
                      placeholder={`Revision ${Math.max(0, ...revisionList.map((r) => r.version)) + 1}`}
                      onChange={(e) => setNewDraftTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          setEditingNewDraftTitle(false);
                        } else if (e.key === "Escape") {
                          setNewDraftTitle(newDraftTitleStash);
                          setEditingNewDraftTitle(false);
                        }
                      }}
                      onBlur={() => setEditingNewDraftTitle(false)}
                      containerStyle={{ maxWidth: 250, marginBottom: 0 }}
                      style={{
                        border: "none",
                        borderBottom: "1px solid var(--violet-9)",
                        borderRadius: 0,
                        outline: "none",
                        background: "transparent",
                        boxShadow: "none",
                        padding: "0 2px",
                        height: "auto",
                      }}
                    />
                  ) : (
                    <Text weight="semibold">
                      <RevisionLabel
                        version={
                          Math.max(0, ...revisionList.map((r) => r.version)) + 1
                        }
                        title={newDraftTitle.trim() || null}
                        numbered={false}
                      />
                    </Text>
                  )}
                  {!editingNewDraftTitle && (
                    <IconButton
                      variant="ghost"
                      color="violet"
                      size="2"
                      radius="full"
                      onClick={() => {
                        setNewDraftTitleStash(newDraftTitle);
                        setEditingNewDraftTitle(true);
                      }}
                      mx="1"
                    >
                      <PiPencilSimpleFill />
                    </IconButton>
                  )}
                </Flex>
              </Box>
              {showNewDraftNotes ? (
                <Field
                  label="Notes"
                  labelClassName="font-weight-bold"
                  textarea
                  value={newDraftNotes}
                  onChange={(e) => setNewDraftNotes(e.target.value)}
                />
              ) : (
                <Link
                  onClick={(e) => {
                    e.preventDefault();
                    setShowNewDraftNotes(true);
                  }}
                >
                  <Flex align="center" gap="1" mb="3">
                    <PiPlus />
                    <Text weight="medium">Add notes</Text>
                  </Flex>
                </Link>
              )}
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
    </>
  );
}
