import dynamic from "next/dynamic";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { FaCircleCheck, FaCircleXmark } from "react-icons/fa6";
import {
  PiPlusCircleBold,
  PiCaretRightBold,
  PiCaretDownBold,
  PiPencil,
  PiLockSimple,
  PiProhibit,
  PiClockFill,
} from "react-icons/pi";
import { datetime } from "shared/dates";
import {
  filterEnvironmentsByFeature,
  getMalformedPrereqConditionError,
  getReviewSetting,
} from "shared/util";
import {
  isScheduledPublishPending,
  isScheduledPublishLockActive,
  isRevisionEditLockedBySchedule,
} from "shared/enterprise";
import { BiHide, BiShow } from "react-icons/bi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  ACTIVE_DRAFT_STATUSES,
  SafeRolloutInterface,
  HoldoutInterface,
  MinimalFeatureRevisionInterface,
  RampScheduleInterface,
} from "shared/validators";
import Button from "@/ui/Button";
import { FeatureBadge } from "@/components/Features/FeatureBadge";
import Callout from "@/ui/Callout";
import ForceSummary from "@/components/Features/ForceSummary";
import track from "@/services/track";
import EditDefaultValueModal from "@/components/Features/EditDefaultValueModal";
import KillSwitchModal from "@/components/Features/KillSwitchModal";
import {
  getFeatureDefaultValue,
  useEnvironments,
  getPrerequisites,
  getRules,
  useFeatureRulesEnv,
} from "@/services/features";
import { useFeatureDefaultValues } from "@/hooks/useFeatureDefaultValues";
import { useFeatureDependents } from "@/hooks/useFeatureDependents";
import Tooltip from "@/components/Tooltip/Tooltip";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import {
  FeatureUsageSparkline,
  useFeatureUsage,
} from "@/components/Features/FeatureUsageGraph";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import {
  PrerequisiteStateResult,
  usePrerequisiteStates,
} from "@/hooks/usePrerequisiteStates";
import PrerequisiteAlerts from "./PrerequisiteAlerts";
import PrerequisiteModal from "./PrerequisiteModal";
import FeatureRules from "./FeatureRules";
import cornerStyles from "./CornerActions.module.scss";

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
    <Text as="div" size="sm" color="text-high">
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
        <Text as="div" mt="2" size="sm" color="text-high">
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
  version: number | null;
  setVersion: (v: number) => void;
}) {
  const settings = useOrgSettings();
  const [edit, setEdit] = useState(false);
  const [showInvalidPrereqs, setShowInvalidPrereqs] = useState(false);
  const [prerequisiteModal, setPrerequisiteModal] = useState<{
    i: number;
  } | null>(null);
  const [showDependents, setShowDependents] = useState(false);
  const permissionsUtil = usePermissionsUtil();

  const [killSwitchTarget, setKillSwitchTarget] = useState<{
    envId?: string;
    desiredState?: boolean;
  } | null>(null);
  const showKillSwitchManager = killSwitchTarget !== null;

  const { hasCommercialFeature } = useUser();

  const { showFeatureUsage } = useFeatureUsage();

  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const envs = environments.map((e) => e.id);
  // Selected rules env tab, lifted here so the Default Value display resolves a
  // config-backed value for the same environment the rules are filtered to.
  // null = "All environments".
  const [rulesEnv, setRulesEnv] = useFeatureRulesEnv();

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
    // Live until the page settles on a version, so landing on live asks once
    version: version ?? feature?.version,
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
  // out of the viewport (above the 118px sticky offset), the banner is
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

  // Judged on the LIVE flag, like the toggle endpoint — `feature` is the draft
  // projection, so a draft staging a project move judged the wrong project.
  const canEditDrafts = permissionsUtil.canEditFeatureDrafts(baseFeature);
  // An env change can be staged in a draft or published straight out. Offer the
  // control when either route is open; the modal narrows it to the ones that are.
  const canChangeEnvironments =
    canEditDrafts ||
    envs.some((envId) =>
      permissionsUtil.canPublishFeature(baseFeature, [envId]),
    );

  let hasRules = false;
  const invalidPrereqs: {
    key: string;
    ruleId: string | null;
    where: string;
    id: string;
    error: string;
  }[] = [];
  prerequisites.forEach((p, i) => {
    const error = getMalformedPrereqConditionError(p.condition);
    if (error) {
      invalidPrereqs.push({
        key: `flag-${i}`,
        ruleId: null,
        where: "this Feature Flag",
        id: p.id,
        error,
      });
    }
  });
  const seenRuleIds = new Set<string>();
  const ruleNumberOffset = holdout ? 2 : 1;
  environments?.forEach((e) => {
    const r = getRules(feature, e.id) || [];
    if (r.length > 0) hasRules = true;
    r.forEach((rule) => {
      if (rule.enabled === false || seenRuleIds.has(rule.id)) return;
      seenRuleIds.add(rule.id);
      (rule.prerequisites ?? []).forEach((p, j) => {
        const error = getMalformedPrereqConditionError(p.condition);
        if (error) {
          invalidPrereqs.push({
            key: `${rule.id}-${j}`,
            ruleId: rule.id,
            where: rule.description
              ? `rule "${rule.description}"`
              : `Rule #${(feature.rules ?? []).findIndex((fr) => fr.id === rule.id) + ruleNumberOffset}`,
            id: p.id,
            error,
          });
        }
      });
    });
  });
  const invalidRuleCount = new Set(
    invalidPrereqs.map((p) => p.ruleId).filter((id) => id !== null),
  ).size;
  const invalidPrereqBlocking = `An invalid prerequisite condition is blocking ${[
    invalidPrereqs.some((p) => p.ruleId === null) ? "this Feature Flag" : null,
    invalidRuleCount === 1
      ? "a rule"
      : invalidRuleCount > 1
        ? `${invalidRuleCount} rules`
        : null,
  ]
    .filter((part) => part !== null)
    .join(" and ")}`;

  const variables = {
    featureKey: feature.id,
    featureType: feature.valueType,
    tags: feature.tags || [],
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
                    backgroundColor: "var(--color-panel-solid)",
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
                    <span />
                  </Box>
                </div>
              </div>
            </>
          );
        })()}
        {invalidPrereqs.length > 0 && (
          <Callout status="error" mt="2" mb="3">
            <Button
              variant="ghost"
              color="inherit"
              size="sm"
              aria-expanded={showInvalidPrereqs}
              onClick={() => setShowInvalidPrereqs((v) => !v)}
              icon={
                showInvalidPrereqs ? <PiCaretDownBold /> : <PiCaretRightBold />
              }
              iconPosition="right"
            >
              {invalidPrereqBlocking}
            </Button>
            {showInvalidPrereqs && (
              <Flex direction="column" gap="1" mt="2">
                {invalidPrereqs.map((p) => (
                  <Flex key={p.key} align="center" gap="1" wrap="wrap">
                    <Text>Blocking {p.where}: prerequisite</Text>
                    <FeatureBadge featureId={p.id} />
                    <Text>— {p.error}</Text>
                  </Flex>
                ))}
                <Text>Edit the prerequisite to fix it.</Text>
              </Flex>
            )}
          </Callout>
        )}

        <Box mt="3">
          <CustomMarkdown page={"feature"} variables={variables} />
        </Box>
        <Frame mb="4" px="6" py="4">
          <Flex align="center" justify="between" gap="2" mb="2">
            <Heading as="h4" size="sm" mb="0">
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
              {!isReadOnly && canChangeEnvironments && (
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
                    size="md"
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
                                !isReadOnly && canChangeEnvironments,
                                envAndSummaryTooltipNonLiveDisclaimer,
                              )}
                            >
                              {!isReadOnly && canChangeEnvironments ? (
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
              {canEditDrafts && !isReadOnly && (
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
                {!isReadOnly && canChangeEnvironments && (
                  <Button
                    variant="ghost"
                    size="md"
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
                            !isReadOnly && canChangeEnvironments,
                            envAndSummaryTooltipNonLiveDisclaimer,
                          )}
                        >
                          {!isReadOnly && canChangeEnvironments ? (
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
              {canEditDrafts && !isReadOnly && (
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
              <Heading size="sm" as="h4" mb="0">
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
              {/* Its copy and fullscreen buttons show while it's hovered, as a
                  rule's do. */}
              <div className={cornerStyles.hoverActions}>
                <Flex align="center" justify="between">
                  <Flex align="center" gap="1" mb="3">
                    <Heading as="h4" size="sm" mb="0">
                      Default Value
                    </Heading>
                  </Flex>
                  {canEditDrafts && !isReadOnly && (
                    <Button
                      variant="ghost"
                      size="md"
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
                        isDefault={true}
                        // Match FeatureRules' tab: ignore a stored env that isn't
                        // one of this feature's environments (falls back to base).
                        environment={
                          rulesEnv !== null && envs.includes(rulesEnv)
                            ? rulesEnv
                            : undefined
                        }
                      />
                    </Box>
                  </Flex>
                </Box>
              </div>

              <Box
                mt="6"
                pt="4"
                style={{ borderTop: "1px solid var(--gray-a4)" }}
              >
                <Heading as="h4" size="sm" mb="2">
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
                      rulesEnv={rulesEnv}
                      setRulesEnv={setRulesEnv}
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

        {/* Modals */}

        {edit && (
          <EditDefaultValueModal
            close={() => setEdit(false)}
            feature={feature}
            revisionList={revisionList || []}
            mutate={mutate}
            setVersion={setVersion}
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
