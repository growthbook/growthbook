import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import { FaArrowRight } from "react-icons/fa";
import { FaCircleCheck, FaCircleXmark } from "react-icons/fa6";
import {
  PiPlusCircleBold,
  PiPlus,
  PiPencilSimpleFill,
  PiCaretRightBold,
  PiPencil,
  PiLockSimple,
  PiProhibit,
  PiClockFill,
} from "react-icons/pi";
import { ago, datetime } from "shared/dates";
import {
  filterEnvironmentsByFeature,
  getReviewSetting,
  isScheduledPublishPending,
  isScheduledPublishLockActive,
  isRevisionEditLockedBySchedule,
} from "shared/util";
import { BiHide, BiShow } from "react-icons/bi";
import Collapsible from "react-collapsible";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import {
  ACTIVE_DRAFT_STATUSES,
  SafeRolloutInterface,
  HoldoutInterface,
  MinimalFeatureRevisionInterface,
  RampScheduleInterface,
} from "shared/validators";
import EventUser from "@/components/Avatar/EventUser";
import CoAuthors from "@/components/Reviews/Feature/CoAuthors";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import { useAuth } from "@/services/auth";
import ForceSummary from "@/components/Features/ForceSummary";
import track from "@/services/track";
import EditDefaultValueModal from "@/components/Features/EditDefaultValueModal";
import KillSwitchModal from "@/components/Features/KillSwitchModal";
import EditProjectForm from "@/components/Experiment/EditProjectForm";
import {
  getFeatureDefaultValue,
  useEnvironments,
  getPrerequisites,
  getRules,
} from "@/services/features";
import { useFeatureDefaultValues } from "@/hooks/useFeatureDefaultValues";
import { useFeatureDependents } from "@/hooks/useFeatureDependents";
// eslint-disable-next-line no-restricted-imports -- legacy Modal still backs the new-draft modal; migrate to @/ui/Modal in a follow-up
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import DiscussionThread from "@/components/DiscussionThread";
import Tooltip from "@/components/Tooltip/Tooltip";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import {
  FeatureUsageSparkline,
  useFeatureUsage,
} from "@/components/Features/FeatureUsageGraph";
import EditRevisionDescriptionModal from "@/components/Reviews/EditRevisionDescriptionModal";
import InlineRevisionDescription from "@/components/Reviews/InlineRevisionDescription";
import RevisionStatusBadge from "@/components/Reviews/RevisionStatusBadge";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Reviews/RevisionLabel";
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
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import { FeatureTab } from "@/pages/features/[fid]";
import {
  PrerequisiteStateResult,
  usePrerequisiteStates,
} from "@/hooks/usePrerequisiteStates";
import PrerequisiteAlerts from "./PrerequisiteAlerts";
import PrerequisiteModal from "./PrerequisiteModal";
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
  setTab,
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
  setTab: (tab: FeatureTab) => void;
}) {
  const settings = useOrgSettings();
  const [edit, setEdit] = useState(false);
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
  const [descriptionExpanded, setDescriptionExpanded] = useLocalStorage(
    `feature-description-expanded`,
    false,
  );
  const [prerequisiteModal, setPrerequisiteModal] = useState<{
    i: number;
  } | null>(null);
  const [showDependents, setShowDependents] = useState(false);
  const permissionsUtil = usePermissionsUtil();

  const [editCommentModel, setEditCommentModal] = useState(false);
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
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
  // Watch a sentinel just above the sticky banner. When the sentinel scrolls
  // out of the viewport (above the 110px sticky offset), the banner is
  // genuinely pinned — a more reliable signal than getBoundingClientRect math,
  // which falsely reports "pinned" whenever the banner's natural position
  // already sits near the top of the page.
  //
  // Use a ref callback (not useRef + useEffect[]) so the observer re-attaches
  // when the sentinel later mounts — e.g. when a user creates a draft on a
  // page that initially had no banner.
  const bannerSentinelObserver = useRef<IntersectionObserver | null>(null);
  const bannerSentinelRef = useCallback((el: HTMLDivElement | null) => {
    if (bannerSentinelObserver.current) {
      bannerSentinelObserver.current.disconnect();
      bannerSentinelObserver.current = null;
    }
    if (!el) {
      setBannerPinned(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setBannerPinned(!entry.isIntersecting),
      { rootMargin: "-110px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(el);
    bannerSentinelObserver.current = observer;
  }, []);

  // Slot refs for the draft CTA portal ("Open review" navigation).
  // The portal host migrates between the revision card slot and the sticky banner
  // slot so the same DOM node is reused without duplicating handler logic.
  const ctaSlotRef = useRef<HTMLDivElement>(null);
  const bannerCtaSlotRef = useRef<HTMLDivElement>(null);
  const [draftCtaPortalHost] = useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const div = document.createElement("div");
    div.style.display = "contents";
    return div;
  });
  // No deps array: the effect must re-run on every render because ctaSlotRef
  // isn't a stable dep — it starts null while the component's early return
  // fires (props loading), then becomes populated once the full JSX renders.
  // useLayoutEffect ensures refs are set before the effect runs, so appendChild
  // always sees the correct target. The call is idempotent when the portal host
  // is already in the right slot.
  useLayoutEffect(() => {
    if (!draftCtaPortalHost) return;
    const target = bannerPinned ? bannerCtaSlotRef.current : ctaSlotRef.current;
    if (target) target.appendChild(draftCtaPortalHost);
  });

  // Per-modal acknowledgment of the soft draft cap: creating past the cap
  // requires ticking the checkbox in the warning callout. Resets whenever the
  // modal closes.
  const [draftCapAcknowledged, setDraftCapAcknowledged] = useState(false);

  if (!baseFeature || !feature || !revision) return null;

  const hasConditionalState =
    prereqStates &&
    Object.values(prereqStates).some((s) => s.state === "conditional");

  const hasPrerequisitesCommercialFeature =
    hasCommercialFeature("prerequisites");

  const currentVersion = version || baseFeature.version;

  const baseVersion = revision?.baseVersion || feature.version;
  const baseRevision = revisions.find((r) => r.version === baseVersion);
  const isLive = revision?.version === feature.version;
  const isPendingReview =
    revision?.status === "pending-review" ||
    revision?.status === "changes-requested";

  const isDraft =
    !!revision &&
    (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(revision.status);

  // Soft per-feature draft cap (org setting). Purely advisory in the UI:
  // a warning dot + tooltip on "New Draft" and a callout in the confirm
  // modal — creating the draft is never blocked.
  const activeDraftCount = revisions.filter((r) =>
    (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
  ).length;
  const maxDrafts = settings.maxConcurrentDrafts || 0;
  const atDraftCap = maxDrafts > 0 && activeDraftCount >= maxDrafts;

  const projectId = feature.project;

  const isDiscarded = revision.status === "discarded";
  // Draft frozen by a pending scheduled publish with "lock edits" (parallel to a
  // ramp lockdown). Rebase is still allowed via the publish modal.
  const editLockedBySchedule =
    isDraft && isRevisionEditLockedBySchedule(revision);
  const scheduledPublishPending = isScheduledPublishPending(revision);
  const isReadOnly =
    isDiscarded ||
    (revision.status === "published" && !isLive) ||
    editLockedBySchedule;

  const envAndSummaryTooltipNonLiveDisclaimer = !isLive
    ? isDraft
      ? ("draft" as const)
      : ("inactive" as const)
    : false;

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
  environments?.forEach((e) => {
    const r = getRules(feature, e.id) || [];
    if (r.length > 0) hasRules = true;
  });

  const variables = {
    featureKey: feature.id,
    featureType: feature.valueType,
    tags: feature.tags || [],
  };

  // Draft CTA — defined once and rendered via a stable portal host moved
  // between the revision card and sticky banner. Just a navigation affordance:
  // all lifecycle actions (review, publish, fix conflicts, discard) live on the
  // review tab, which evaluates the full policy matrix. Shown to everyone.
  const draftCtaGroup = isDraft ? (
    <Box>
      <Button
        icon={<FaArrowRight />}
        iconPosition="right"
        onClick={() => setTab("review")}
        style={{ whiteSpace: "nowrap" as const }}
      >
        Review and Publish
      </Button>
    </Box>
  ) : null;

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
        <InlineRevisionDescription
          comment={revision.comment}
          canEdit={canEditDrafts}
          onEdit={() => setEditCommentModal(true)}
        />
      </Flex>
    );
  };

  return (
    <>
      <Box className="contents container-fluid pagecontents">
        {(() => {
          const bannerProps =
            isDraft || isPendingReview
              ? scheduledPublishPending
                ? (() => {
                    // Mirrors a ramp lockdown, naming the target date. Locks
                    // engage only once approved; while in review we say "once
                    // approved" and omit the lock clauses (editing stays open).
                    const lockActive = isScheduledPublishLockActive(revision);
                    const awaitingApproval =
                      revision.status === "pending-review" ||
                      revision.status === "changes-requested";
                    const lockOthersActive =
                      lockActive && !!revision.scheduledPublishLockOthers;
                    const lockClauses = [
                      editLockedBySchedule ? "edits are locked" : null,
                      lockOthersActive
                        ? "publishing other drafts is locked"
                        : null,
                    ].filter((c): c is string => c !== null);
                    return {
                      icon: lockClauses.length ? (
                        <PiLockSimple size={18} />
                      ) : (
                        <PiClockFill size={18} />
                      ),
                      color: "var(--amber-11)",
                      bgColor: "var(--amber-a3)",
                      message: (
                        <>
                          This <strong>draft</strong> is scheduled to publish on{" "}
                          <strong>
                            {datetime(revision.scheduledPublishAt as Date)}
                          </strong>
                          {awaitingApproval ? " once approved" : ""}
                          {lockClauses.length
                            ? ` — ${lockClauses.join(" and ")}`
                            : ""}
                        </>
                      ),
                    };
                  })()
                : {
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
            <>
              <div ref={bannerSentinelRef} aria-hidden style={{ height: 0 }} />
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
                    maxWidth: bannerPinned ? 1280 : 1500,
                    boxShadow: bannerPinned ? "var(--shadow-3)" : undefined,
                    transition: "all 200ms ease",
                    pointerEvents: "auto",
                  }}
                >
                  <Box
                    px="4"
                    py="3"
                    style={{
                      color: bannerProps.color,
                      backgroundColor: bannerProps.bgColor,
                      display: "grid",
                      gridTemplateColumns: "1fr auto 1fr",
                      alignItems: "center",
                      gap: "12px",
                    }}
                  >
                    <span />
                    <Flex
                      align="center"
                      justify="center"
                      gap="2"
                      style={{ gridColumn: 2 }}
                    >
                      <span
                        style={{
                          display: "flex",
                          flexGrow: 0,
                          flexShrink: 0,
                        }}
                      >
                        {bannerProps.icon}
                      </span>
                      <span style={{ fontSize: "var(--font-size-2)" }}>
                        {bannerProps.message}
                      </span>
                    </Flex>
                    <Flex
                      align="center"
                      gap="2"
                      justify="end"
                      style={{ flexShrink: 0, gridColumn: 3 }}
                    >
                      {/* Slot: draftCtaGroup portal mounts here when banner is pinned */}
                      <div ref={bannerCtaSlotRef} />
                    </Flex>
                  </Box>
                </div>
              </div>
            </>
          );
        })()}
        {revision && (
          <Frame mt="2" mb="4" px="6" py="4">
            <Flex align="start" justify="between" mb="2" wrap="wrap" gap="2">
              <Flex align="start" gap="4" style={{ marginTop: 5 }}>
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
              </Flex>

              <Flex align="center" justify="end" gap="4" flexGrow="1">
                {/* Lifecycle actions (revert, discard, publish) live in the
                    Review and Publish tab — the card only offers "New Draft"
                    and navigation into the review surface. */}
                {canEditDrafts && !isDraft && (
                  <Box position="relative">
                    <Tooltip
                      shouldDisplay={atDraftCap}
                      body={`This feature has ${activeDraftCount} active draft${
                        activeDraftCount === 1 ? "" : "s"
                      }, at your organization's cap of ${maxDrafts} per feature. You can still create one after acknowledging the cap.`}
                    >
                      <Button
                        loading={creatingDraft}
                        onClick={() => setConfirmNewDraft(true)}
                        variant="soft"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        New Draft
                      </Button>
                      {atDraftCap && (
                        <span
                          style={{
                            position: "absolute",
                            top: -3,
                            right: -3,
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            backgroundColor: "var(--amber-9)",
                            border: "2px solid var(--color-panel-solid)",
                            pointerEvents: "none",
                          }}
                        />
                      )}
                    </Tooltip>
                  </Box>
                )}
                {/* Slot: draftCtaGroup portal mounts here when not scrolled
                    past the revision card */}
                {isDraft && <div ref={ctaSlotRef} />}
              </Flex>
            </Flex>
            <Separator size="4" my="3" />
            {renderRevisionInfo()}
          </Frame>
        )}
        {/* Portal: renders draftCtaGroup into whichever slot is active (ctaSlotRef or bannerCtaSlotRef) */}
        {draftCtaPortalHost && createPortal(draftCtaGroup, draftCtaPortalHost)}

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
              <FeatureUsageSparkline valueType={feature.valueType} />
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
                        : 8,
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
              <Flex
                mt="3"
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
                  <Box width="100%">
                    <Callout status="warning">
                      <strong>
                        This feature has no associated environments.
                      </strong>{" "}
                      Ensure that this feature&apos;s project is included in at
                      least one environment to use it.{" "}
                      <Link href="/environments">Manage Environments</Link>
                    </Callout>
                  </Box>
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
                <Heading as="h4" size="small" mb="2">
                  Rules
                </Heading>
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
                      lockedBySchedule={editLockedBySchedule}
                      canEditDrafts={canEditDrafts}
                      experimentsMap={experimentsMap}
                      mutate={mutate}
                      currentVersion={currentVersion}
                      setVersion={setVersion}
                      isDraft={isDraft}
                      safeRolloutsMap={safeRolloutsMap}
                      holdout={holdout}
                      revisionList={revisionList || []}
                      rampSchedules={rampSchedules}
                      draftRevision={revision}
                      baseRevision={baseRevision}
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
              <Callout status="error" mb="3">
                Changing the project may prevent this Feature and any linked
                Experiments from being sent to users.
              </Callout>
            }
          />
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
              setDraftCapAcknowledged(false);
            }}
            header="Create New Draft"
            cta="Create Draft"
            ctaEnabled={!atDraftCap || draftCapAcknowledged}
            disabledMessage="Acknowledge the draft cap warning to continue"
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
              {atDraftCap && (
                <Callout status="warning" mb="2">
                  <Flex direction="column" gap="2" align="start">
                    <Text>
                      This feature already has {activeDraftCount} active draft
                      {activeDraftCount === 1 ? "" : "s"} — your organization
                      recommends keeping it to {maxDrafts} per feature.
                    </Text>
                    <Checkbox
                      id="acknowledge-draft-cap"
                      label="Acknowledge and override"
                      weight="regular"
                      value={draftCapAcknowledged}
                      setValue={setDraftCapAcknowledged}
                    />
                  </Flex>
                </Callout>
              )}
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
                        minWidth={0}
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
                  label="Description"
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
                    <Text weight="medium">Add description</Text>
                  </Flex>
                </Link>
              )}
            </Flex>
          </Modal>
        )}
        {editCommentModel && revision && (
          <EditRevisionDescriptionModal
            close={() => setEditCommentModal(false)}
            initialValue={revision.comment || ""}
            trackingEventModalType=""
            onSubmit={async (comment) => {
              await apiCall(
                `/feature/${feature.id}/${revision.version}/comment`,
                {
                  method: "PUT",
                  body: JSON.stringify({ comment }),
                },
              );
              mutate();
            }}
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
