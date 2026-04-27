import dynamic from "next/dynamic";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { FaCircleCheck, FaCircleXmark } from "react-icons/fa6";
import {
  PiPlusCircleBold,
  PiPlus,
  PiArrowsLeftRightBold,
  PiPencilSimpleFill,
  PiCaretRightBold,
  PiPencil,
  PiLockSimple,
  PiProhibit,
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
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import {
  SafeRolloutInterface,
  HoldoutInterface,
  MinimalFeatureRevisionInterface,
  RampScheduleInterface,
} from "shared/validators";
import EventUser from "@/components/Avatar/EventUser";
import CoAuthors from "@/components/Features/CoAuthors";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { useAuth } from "@/services/auth";
import ForceSummary from "@/components/Features/ForceSummary";
import track from "@/services/track";
import EditDefaultValueModal from "@/components/Features/EditDefaultValueModal";
import KillSwitchModal from "@/components/Features/KillSwitchModal";
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
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import RevertModal from "@/components/Features/RevertModal";
import {
  FeatureUsageSparkline,
  useFeatureUsage,
} from "@/components/Features/FeatureUsageGraph";
import EditRevisionCommentModal from "@/components/Features/EditRevisionCommentModal";
import FixConflictsModal from "@/components/Features/FixConflictsModal";
import CompareRevisionsModal from "@/components/Features/CompareRevisionsModal";
import RevisionStatusBadge from "@/components/Features/RevisionStatusBadge";
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
import Heading from "@/ui/Heading";
import Metadata from "@/ui/Metadata";
import Switch from "@/ui/Switch";
import Link from "@/ui/Link";
import JSONValidation from "@/components/Features/JSONValidation";
import {
  PrerequisiteStateResult,
  usePrerequisiteStates,
} from "@/hooks/usePrerequisiteStates";
import PrerequisiteAlerts from "./PrerequisiteAlerts";
import PrerequisiteModal from "./PrerequisiteModal";
import RequestReviewModal from "./RequestReviewModal";
import FeatureRules from "./FeatureRules";

export const featureStatusColors = {
  on: "var(--green-10)",
  off: "var(--red-11)",
  offMuted: "var(--color-text-low)",
  warning: "var(--amber-11)",
  danger: "var(--red-9)",
} as const;

export function NonLiveRevisionTooltipNote({
  kind,
}: {
  kind: "draft" | "inactive";
}) {
  return (
    <Callout status="warning" size="sm" mt="2">
      You are viewing a{" "}
      <strong>{kind === "draft" ? "draft" : "inactive revision"}</strong>; it
      may not reflect the actual state of the feature.
    </Callout>
  );
}

const PrerequisiteStatusRow = dynamic(() => import("./PrerequisiteStatusRow"));
const PrerequisiteStatesCols = dynamic(() =>
  import("./PrerequisiteStatusRow").then((mod) => mod.PrerequisiteStatesCols),
);

function environmentKillSwitchTooltipBody(
  enabled: boolean,
  showChangeHint: boolean,
  nonLiveDisclaimer: false | "draft" | "inactive",
): JSX.Element {
  const context =
    nonLiveDisclaimer === "draft"
      ? "in this draft"
      : nonLiveDisclaimer === "inactive"
        ? "in this revision"
        : "in this environment";
  return (
    <Text as="div" size="small" color="text-high">
      {enabled ? (
        <>
          The current feature is{" "}
          <strong style={{ color: featureStatusColors.on }}>
            {nonLiveDisclaimer ? "enabled" : "live"}
          </strong>{" "}
          {context}.
          {!nonLiveDisclaimer && (
            <>
              {" "}
              Traffic is{" "}
              <strong style={{ color: featureStatusColors.on }}>on</strong>.
            </>
          )}
        </>
      ) : (
        <>
          The current feature is{" "}
          <strong style={{ color: featureStatusColors.off }}>
            {nonLiveDisclaimer ? "disabled" : "not live"}
          </strong>{" "}
          {context}.
          {!nonLiveDisclaimer && (
            <>
              {" "}
              Traffic is{" "}
              <strong style={{ color: featureStatusColors.off }}>off</strong>.
              It will evaluate to <code>null</code>.
            </>
          )}
        </>
      )}
      {showChangeHint && (
        <Text as="div" mt="2" size="small" color="text-high">
          Click <strong>Change</strong> to turn traffic on or off for each
          environment.
        </Text>
      )}
      {nonLiveDisclaimer !== false && (
        <NonLiveRevisionTooltipNote kind={nonLiveDisclaimer} />
      )}
    </Text>
  );
}

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
  rampSchedules,
}: {
  baseFeature: FeatureInterface;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface | null;
  revisionList: MinimalFeatureRevisionInterface[];
  revisions: FeatureRevisionInterface[];
  experiments: ExperimentInterfaceStringDates[] | undefined;
  safeRollouts: SafeRolloutInterface[] | undefined;
  holdout: HoldoutInterface | undefined;
  rampSchedules: RampScheduleInterface[] | undefined;
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
  // Always reflects the current live version — used in async callbacks to avoid
  // stale closure captures when ramp actions auto-publish new revisions.
  const liveVersionRef = useRef(feature.version);
  liveVersionRef.current = feature.version;
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
  const [killSwitchTarget, setKillSwitchTarget] = useState<{
    envId?: string;
    desiredState?: boolean;
  } | null>(null);
  const showKillSwitchManager = killSwitchTarget !== null;

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();

  const commitTitleEdit = useCallback(async () => {
    if (!revision) return;
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (next !== (revision.title ?? "")) {
      await apiCall(`/feature/${feature.id}/${revision.version}/title`, {
        method: "PUT",
        body: JSON.stringify({ title: next }),
      });
      await mutate();
    }
  }, [titleDraft, revision, feature.id, apiCall, mutate]);
  const { showFeatureUsage } = useFeatureUsage();

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

  const {
    states: prereqStatesRaw,
    loading: prereqStatesLoading,
    mutate: mutatePrereqStates,
  } = usePrerequisiteStates({
    featureId: feature?.id || "",
    environments: envs,
    enabled: !!feature,
    skipRootConditions: true,
    version,
  });

  const prerequisitesSignature = useMemo(
    () =>
      JSON.stringify(
        (feature?.prerequisites ?? []).map((p) => ({
          id: p.id,
          condition: p.condition,
        })),
      ),
    [feature?.prerequisites],
  );

  const prereqStatesInvalidateRef = useRef<{
    featureId: string;
    signature: string;
  } | null>(null);

  useEffect(() => {
    if (!feature?.id) return;
    const prev = prereqStatesInvalidateRef.current;
    if (!prev || prev.featureId !== feature.id) {
      prereqStatesInvalidateRef.current = {
        featureId: feature.id,
        signature: prerequisitesSignature,
      };
      return;
    }
    if (prev.signature !== prerequisitesSignature) {
      prereqStatesInvalidateRef.current = {
        featureId: feature.id,
        signature: prerequisitesSignature,
      };
      void mutatePrereqStates();
    }
  }, [feature?.id, prerequisitesSignature, mutatePrereqStates]);

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
    if (
      draftDiffersFromLive(
        revision,
        liveRevision,
        baseFeature,
        environments.map((e) => e.id),
      )
    )
      return true;
    // A draft that only activates a ramp schedule (no feature content changes)
    // still has meaningful changes and should be publishable.
    const hasLinkedRamp = rampSchedules?.some((rs) =>
      rs.targets.some((t) => t.activatingRevisionVersion === revision.version),
    );
    if (hasLinkedRamp) return true;

    // Also check for pending ramp actions in the draft (create/detach)
    const hasPendingRampActions =
      revision.rampActions && revision.rampActions.length > 0;
    return !!hasPendingRampActions;
  }, [revision, revisions, feature, baseFeature, environments, rampSchedules]);

  const bannerRef = useRef<HTMLDivElement>(null);
  const [bannerPinned, setBannerPinned] = useState(false);

  const [envGridWidth, setEnvGridWidth] = useState(0);
  const envGridRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setEnvGridWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => {
      setEnvGridWidth(entry.contentRect.width);
    });
    ro.observe(el);
  }, []);
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
      effectiveRevision = {
        ...filledLive,
        ...mergeResult.result,
        // Merge rules per-environment so that environments absent from the
        // sparse mergeResult.result (e.g. production when only dev/staging
        // changed) inherit their live rules rather than defaulting to [].
        // Without this, getDraftAffectedEnvironments incorrectly detects a
        // diff in untouched environments and over-triggers review requirements.
        rules: {
          ...filledLive.rules,
          ...(mergeResult.result.rules ?? {}),
        },
      };
      effectiveBase = filledLive;
    }

    requireReviews = checkIfRevisionNeedsReview({
      feature: baseFeature,
      baseRevision: effectiveBase,
      revision: effectiveRevision,
      allEnvironments: environments.map((e) => e.id),
      settings,
      requireApprovalsLicensed: hasCommercialFeature("require-approvals"),
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

  const envAndSummaryTooltipNonLiveDisclaimer = !isLive
    ? isDraft
      ? ("draft" as const)
      : ("inactive" as const)
    : false;

  const enabledEnvsSubtext =
    isDraft || isPendingReview
      ? "in this draft"
      : !isLive
        ? "in this revision"
        : null;

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

  const onCompareRevisions =
    (revisionList?.length ?? 0) >= 2
      ? () => setCompareRevisionsModalOpen(true)
      : undefined;

  const renderRevisionInfo = () => {
    return (
      <Flex direction="column">
        {/* Revised by (left) + Created/Published (right) — side by side on wide, stacked on narrow */}
        <Flex
          align="center"
          justify="between"
          wrap="wrap"
          style={{ rowGap: "var(--space-1)", columnGap: "var(--space-4)" }}
        >
          {(() => {
            const cb = revision.createdBy;
            if (cb?.type === "dashboard" || cb?.type === "api_key") {
              return (
                <Metadata
                  label="Revised by"
                  value={
                    <Flex align="center" gap="2" wrap="wrap">
                      <EventUser
                        user={cb}
                        display="avatar-name-email"
                        size="sm"
                      />
                    </Flex>
                  }
                />
              );
            }
            if (cb?.type === "system") {
              return (
                <Metadata
                  label="Generated by"
                  value={
                    <em>
                      {cb.subtype === "ramp-schedule"
                        ? "ramp schedule"
                        : "system"}
                    </em>
                  }
                />
              );
            }
            return null;
          })()}
          <Flex align="center" gap="4" wrap="wrap">
            <Metadata label="Created" value={datetime(revision.dateCreated)} />
            {revision.status === "published" && revision.datePublished && (
              <Metadata
                label="Published"
                value={datetime(revision.datePublished)}
              />
            )}
            {revision.status === "draft" && (
              <Metadata label="Last update" value={ago(revision.dateUpdated)} />
            )}
          </Flex>
        </Flex>
        <CoAuthors rev={revision} mt="3" mb="3" />
        <Flex align="start" gap="2" style={{ width: "fit-content" }}>
          <Text weight="semibold" color="text-high">
            Revision notes:
          </Text>{" "}
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
        {(() => {
          const bannerProps =
            isDraft || isPendingReview
              ? {
                  icon: <PiPencil size={18} />,
                  color: "var(--amber-11)",
                  bgColor: "var(--amber-a3)",
                  message: (
                    <>
                      Viewing a <strong>draft</strong> —{" "}
                      {isPendingReview
                        ? "changes will not go live until approved and published"
                        : "changes will not go live until published"}
                    </>
                  ),
                }
              : isDiscarded
                ? {
                    icon: <PiProhibit size={18} />,
                    color: "var(--gray-11)",
                    bgColor: "var(--gray-a3)",
                    message: (
                      <>
                        Viewing a <strong>discarded</strong> revision — this was
                        never published
                      </>
                    ),
                  }
                : isReadOnly
                  ? {
                      icon: <PiLockSimple size={18} />,
                      color: "var(--gray-11)",
                      bgColor: "var(--gray-a3)",
                      message: (
                        <>
                          Viewing a previously <strong>published</strong>{" "}
                          revision.{" "}
                          <Link onClick={() => setVersion(feature.version)}>
                            <strong>Switch to live</strong>
                          </Link>
                        </>
                      ),
                    }
                  : isLive
                    ? (() => {
                        const activeDrafts = (revisionList ?? []).filter(
                          (r) =>
                            !(
                              r.createdBy?.type === "system" &&
                              r.createdBy.subtype === "ramp-schedule"
                            ) &&
                            (r.status === "draft" ||
                              r.status === "approved" ||
                              r.status === "changes-requested" ||
                              r.status === "pending-review"),
                        );
                        if (activeDrafts.length === 0) return null;
                        return {
                          icon: <PiPencil size={18} />,
                          color: "var(--gray-11)",
                          bgColor: "var(--gray-a3)",
                          message: (
                            <>
                              This feature has{" "}
                              <strong>
                                {activeDrafts.length === 1
                                  ? "a draft revision"
                                  : `${activeDrafts.length} draft revisions`}
                              </strong>
                              {activeDrafts.length === 1 && (
                                <>
                                  {". "}
                                  <Link
                                    onClick={() =>
                                      setVersion(activeDrafts[0].version)
                                    }
                                  >
                                    <strong>Switch to draft</strong>
                                  </Link>
                                </>
                              )}
                            </>
                          ),
                        };
                      })()
                    : null;

          if (!bannerProps) return null;
          return (
            <div
              ref={bannerRef}
              style={{
                position: "sticky",
                top: 110,
                zIndex: 920,
                marginBottom: 12,
                display: "flex",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  width: "100%",
                  backgroundColor: "var(--color-background)",
                  borderRadius: "var(--radius-3)",
                  overflow: "hidden",
                  maxWidth: bannerPinned ? "580px" : "2000px",
                  boxShadow: bannerPinned ? "var(--shadow-3)" : undefined,
                  transition: "all 200ms ease",
                  pointerEvents: "auto",
                }}
              >
                <Flex
                  align="center"
                  justify="center"
                  gap="2"
                  px="4"
                  py="3"
                  style={{
                    color: bannerProps.color,
                    backgroundColor: bannerProps.bgColor,
                  }}
                >
                  {bannerProps.icon}
                  <span style={{ fontSize: "var(--font-size-2)" }}>
                    {bannerProps.message}
                  </span>
                </Flex>
              </div>
            </div>
          );
        })()}
        {revision && (
          <Frame mt="2" mb="4" px="6" py="4">
            <Flex align="start" justify="between" mb="2" wrap="wrap" gap="2">
              <Flex align="start" gap="4" style={{ marginTop: 6 }}>
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
                        <Text as="span" color="text-mid" size="medium">
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
                            await commitTitleEdit();
                          } else if (e.key === "Escape") {
                            setEditingTitle(false);
                            setTitleDraft(revision.title || "");
                          }
                        }}
                        onBlur={commitTitleEdit}
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
                          fontSize: "var(--font-size-3)",
                          fontWeight: 700,
                        }}
                      />
                    ) : (
                      <Text weight="semibold" size="large">
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

              <Flex align="center" justify="end" gap="4" flexGrow="1">
                {renderRevisionCTA()}
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
                <Heading as="h4" size="small" mb="0">
                  {hasCustomFields && !descriptionExpanded
                    ? "Description & Additional Fields"
                    : "Description"}
                </Heading>
                <Flex align="center" gap="2">
                  {canEdit && canEditDrafts && !isReadOnly && (
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
                canEdit={canEdit && !isReadOnly}
                mutate={mutate}
                section={"feature"}
                mt="4"
                draftInfo={
                  !isReadOnly
                    ? ({
                        feature,
                        revisionList: revisionList || [],
                        gatedEnvSet: metadataReviewRequired ? "all" : "none",
                        onDraftCreated: (v) => setVersion(v),
                      } satisfies CustomFieldDraftInfo)
                    : undefined
                }
              />
            </Box>
          </Collapsible>
        </Frame>

        <Box mt="3">
          <CustomMarkdown page={"feature"} variables={variables} />
        </Box>
        <Frame mb="4" px="6" py="4">
          <Flex align="center" justify="between" gap="2" mb="2">
            <Heading as="h4" size="small" mb="0">
              Environment Status
            </Heading>
            {showFeatureUsage && (
              <FeatureUsageSparkline
                valueType={feature.valueType}
                environments={envs}
              />
            )}
          </Flex>
          <div className="mb-4">
            When disabled, this feature will evaluate to <code>null</code>. The
            default value and rules will be ignored.
          </div>
          {prerequisites.length > 0 ? (
            /* Grid layout: env icons column-aligned with prereq rows */
            <>
              {!isReadOnly && (
                <Flex
                  justify="end"
                  style={{
                    marginBottom:
                      envGridWidth > 0 &&
                      200 + envs.length * 120 < envGridWidth - 80
                        ? -26 // align to the env grid's labels' baseline
                        : undefined,
                  }}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setKillSwitchTarget({})}
                    style={{ position: "relative", zIndex: 1 }}
                  >
                    Change
                  </Button>
                </Flex>
              )}
              <div
                ref={envGridRef}
                style={{ overflowX: "auto", marginBottom: "var(--space-2)" }}
              >
                <Flex direction="column" style={{ width: "max-content" }}>
                  {/* Header row: label in 200px area, env names in columns, top-aligned */}
                  <Flex align="start" pb="1">
                    <Box style={{ width: 200, flexShrink: 0 }}>
                      <span className="font-weight-bold">
                        Enabled Environments
                      </span>
                      {enabledEnvsSubtext ? (
                        <div style={{ marginBottom: -20 }}>
                          <Text as="div" size="small" color="text-mid">
                            {enabledEnvsSubtext}
                          </Text>
                        </div>
                      ) : null}
                    </Box>
                    {envs.map((env) => (
                      <Box
                        key={env}
                        style={{
                          width: 120,
                          flexShrink: 0,
                          textAlign: "center",
                        }}
                      >
                        <Text weight="semibold" color="text-mid">
                          <OverflowText maxWidth={120}>{env}</OverflowText>
                        </Text>
                      </Box>
                    ))}
                  </Flex>

                  {/* Env icon row */}
                  <Flex align="center">
                    <Box style={{ width: 200, flexShrink: 0 }} />
                    {environments.map((en) => {
                      const enabled =
                        feature.environmentSettings?.[en.id]?.enabled ?? false;
                      return (
                        <Box key={en.id} style={{ width: 120, flexShrink: 0 }}>
                          <Flex align="center" justify="center" py="1">
                            <Tooltip
                              popperClassName="text-left"
                              flipTheme={false}
                              body={environmentKillSwitchTooltipBody(
                                enabled,
                                !isReadOnly,
                                envAndSummaryTooltipNonLiveDisclaimer,
                              )}
                            >
                              {!isReadOnly ? (
                                <IconButton
                                  variant="ghost"
                                  radius="full"
                                  aria-label={
                                    enabled
                                      ? "Disable environment"
                                      : "Enable environment"
                                  }
                                  onClick={() =>
                                    setKillSwitchTarget({
                                      envId: en.id,
                                      desiredState: !enabled,
                                    })
                                  }
                                >
                                  {enabled ? (
                                    <FaCircleCheck
                                      size={20}
                                      style={{ color: featureStatusColors.on }}
                                    />
                                  ) : (
                                    <FaCircleXmark
                                      size={20}
                                      style={{
                                        color: featureStatusColors.offMuted,
                                      }}
                                    />
                                  )}
                                </IconButton>
                              ) : enabled ? (
                                <FaCircleCheck
                                  size={20}
                                  style={{ color: featureStatusColors.on }}
                                />
                              ) : (
                                <FaCircleXmark
                                  size={20}
                                  style={{
                                    color: featureStatusColors.offMuted,
                                  }}
                                />
                              )}
                            </Tooltip>
                          </Flex>
                        </Box>
                      );
                    })}
                  </Flex>

                  {/* Prerequisites section heading */}
                  <Flex align="center" mt="1" pb="2">
                    <Box style={{ width: 200, flexShrink: 0 }}>
                      <span className="font-weight-bold">Prerequisites</span>
                    </Box>
                  </Flex>

                  {/* Prerequisite rows */}
                  {prerequisites.map(({ ...item }, i) => (
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
                      labelWidth={200}
                      colWidth={120}
                    />
                  ))}

                  {/* Summary row */}
                  <Flex
                    pt="1"
                    align="center"
                    style={{ borderTop: "2px solid var(--gray-4)" }}
                  >
                    <Box py="2" style={{ width: 200, flexShrink: 0 }}>
                      <span className="font-weight-bold">Net Status</span>
                    </Box>
                    {envs.length > 0 && (
                      <PrerequisiteStatesCols
                        prereqStates={prereqStates ?? undefined}
                        envs={envs}
                        isSummaryRow={true}
                        loading={prereqStatesLoading}
                        tooltipBodyWrapper={
                          envAndSummaryTooltipNonLiveDisclaimer
                            ? (body) => (
                                <>
                                  {body}
                                  <NonLiveRevisionTooltipNote
                                    kind={envAndSummaryTooltipNonLiveDisclaimer}
                                  />
                                </>
                              )
                            : undefined
                        }
                        colWidth={120}
                      />
                    )}
                  </Flex>
                </Flex>
              </div>
              {canEdit && canEditDrafts && !isReadOnly && (
                <PremiumTooltip
                  commercialFeature="prerequisites"
                  className="d-inline-flex align-items-center mt-2"
                >
                  <Link
                    onClick={() => {
                      if (!hasPrerequisitesCommercialFeature) return;
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
                      Add prerequisite
                    </Text>
                  </Link>
                </PremiumTooltip>
              )}
            </>
          ) : (
            /* Pill layout: simple env name + icon pairs, no grid needed */
            <Box>
              <Flex align="center" justify="between" mb="2">
                <span>
                  <span className="font-weight-bold">Enabled Environments</span>
                  {enabledEnvsSubtext ? (
                    <Text as="div" size="small" color="text-mid">
                      {enabledEnvsSubtext}
                    </Text>
                  ) : null}
                </span>
                {!isReadOnly && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setKillSwitchTarget({})}
                  >
                    Change
                  </Button>
                )}
              </Flex>
              <Separator size="4" mt="1" mb="3" />
              <Flex
                mb="4"
                justify="start"
                align="center"
                gapX="4"
                gapY="3"
                wrap="wrap"
              >
                {environments.length > 0 ? (
                  environments.map((en) => {
                    const enabled =
                      feature.environmentSettings?.[en.id]?.enabled ?? false;
                    return (
                      <Flex
                        key={en.id}
                        wrap="nowrap"
                        direction="row"
                        gap="2"
                        align="center"
                        mr="2"
                      >
                        <span className="font-weight-bold">{en.id}:</span>
                        <Tooltip
                          popperClassName="text-left"
                          flipTheme={false}
                          body={environmentKillSwitchTooltipBody(
                            enabled,
                            !isReadOnly,
                            envAndSummaryTooltipNonLiveDisclaimer,
                          )}
                        >
                          {!isReadOnly ? (
                            <IconButton
                              variant="ghost"
                              radius="full"
                              aria-label={
                                enabled
                                  ? "Disable environment"
                                  : "Enable environment"
                              }
                              onClick={() =>
                                setKillSwitchTarget({
                                  envId: en.id,
                                  desiredState: !enabled,
                                })
                              }
                            >
                              {enabled ? (
                                <FaCircleCheck
                                  size={20}
                                  style={{ color: featureStatusColors.on }}
                                />
                              ) : (
                                <FaCircleXmark
                                  size={20}
                                  style={{
                                    color: featureStatusColors.offMuted,
                                  }}
                                />
                              )}
                            </IconButton>
                          ) : enabled ? (
                            <FaCircleCheck
                              size={20}
                              style={{ color: featureStatusColors.on }}
                            />
                          ) : (
                            <FaCircleXmark
                              size={20}
                              style={{ color: featureStatusColors.offMuted }}
                            />
                          )}
                        </Tooltip>
                      </Flex>
                    );
                  })
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
              {canEdit && canEditDrafts && !isReadOnly && (
                <PremiumTooltip
                  commercialFeature="prerequisites"
                  className="d-inline-flex align-items-center mt-2"
                >
                  <Link
                    onClick={() => {
                      if (!hasPrerequisitesCommercialFeature) return;
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
        </Frame>
        {dependents > 0 && (
          <Frame mb="4" px="6" py="4">
            <Flex mb="2" gap="2" align="center">
              <Heading size="small" as="h4" mb="0">
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
                  <Heading as="h4" size="small" mb="0">
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
                  <Heading as="h4" size="small" mb="0">
                    Rules
                  </Heading>
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
                      rampSchedules={rampSchedules}
                      draftRevision={revision}
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
          <Heading as="h4" size="small" mb="3">
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
                Changing the project may prevent this Feature and any linked
                Experiments from being sent to users.
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
            revisionList={revisionList}
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
            onPublish={() => {
              setVersion(revision.version);
              setTimeout(() => setVersion(liveVersionRef.current), 300);
            }}
            experimentsMap={experimentsMap}
            rampSchedules={rampSchedules}
          />
        )}
        {draftModal && revision && (
          <DraftModal
            feature={baseFeature}
            revisions={revisions}
            version={revision.version}
            close={() => setDraftModal(false)}
            mutate={mutate}
            onPublish={() => {
              setVersion(revision.version);
              // Ramp steps fire synchronously on the backend and may publish
              // additional revisions. After React processes the mutate response,
              // snap to whatever is actually live now.
              setTimeout(() => setVersion(liveVersionRef.current), 300);
            }}
            experimentsMap={experimentsMap}
            rampSchedules={rampSchedules}
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
            rampSchedules={rampSchedules}
          />
        )}
        {showKillSwitchManager && (
          <KillSwitchModal
            feature={feature}
            baseFeature={baseFeature}
            environment={killSwitchTarget?.envId}
            desiredState={killSwitchTarget?.desiredState}
            currentVersion={currentVersion}
            revisionList={revisionList || []}
            mutate={mutate}
            setVersion={setVersion}
            close={() => setKillSwitchTarget(null)}
          />
        )}
      </Box>
    </>
  );
}
