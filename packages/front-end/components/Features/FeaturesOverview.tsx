import dynamic from "next/dynamic";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useMemo, useState, useEffect, useRef } from "react";
import { FaCircleCheck, FaCircleXmark } from "react-icons/fa6";
import {
  PiPlus,
  PiCaretRightBold,
  PiCaretDownBold,
  PiInfo,
} from "react-icons/pi";
import {
  filterEnvironmentsByFeature,
  getMalformedPrereqConditionError,
  getReviewSetting,
} from "shared/util";
import { isRevisionEditLockedBySchedule } from "shared/enterprise";
import { canOfferEnvironmentToggle } from "shared/permissions";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box, Flex } from "@radix-ui/themes";
import {
  isActiveDraftStatus,
  SafeRolloutInterface,
  HoldoutInterface,
  MinimalFeatureRevisionInterface,
  RampScheduleInterface,
} from "shared/validators";
import Button from "@/ui/Button";
import Switch from "@/ui/Switch";
import { FeatureBadge } from "@/components/Features/FeatureBadge";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import ForceSummary from "@/components/Features/ForceSummary";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
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
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import UITooltip from "@/ui/Tooltip";
import { SCHEDULE_EDIT_LOCK_REASON } from "@/components/Features/ScheduleLock";
import {
  PrerequisiteStateResult,
  usePrerequisiteStates,
} from "@/hooks/usePrerequisiteStates";
import SectionFrame from "@/components/SectionFrame";
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

// A changeable environment's switch, its state named after it. In a grid
// column the switch centres and its label hangs off to the right.
function EnvironmentSwitch({
  environment,
  enabled,
  onToggle,
  disabled = false,
  changed = false,
  labelOverhangs = false,
}: {
  environment: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  disabled?: boolean;
  // Differs from live, in a draft: ringed in amber.
  changed?: boolean;
  labelOverhangs?: boolean;
}) {
  return (
    <Flex
      align="center"
      gap="2"
      style={labelOverhangs ? { position: "relative" } : undefined}
    >
      <span
        style={{
          display: "inline-flex",
          borderRadius: "var(--radius-thumb)",
          boxShadow: changed ? "0 0 0 2px var(--amber-9)" : undefined,
        }}
      >
        <Switch
          color="green"
          size="lg"
          ariaLabel={environment}
          value={enabled}
          onChange={onToggle}
          disabled={disabled}
        />
      </span>
      <span
        style={{
          color: enabled
            ? featureStatusColors.on
            : featureStatusColors.offMuted,
          ...(labelOverhangs && {
            position: "absolute",
            left: "100%",
            marginLeft: "var(--space-2)",
          }),
        }}
      >
        <Text size="sm" weight="medium">
          {enabled ? "On" : "Off"}
        </Text>
      </span>
    </Flex>
  );
}

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

// What an environment's state is, and how it compares with live.
function environmentKillSwitchTooltipBody(
  enabled: boolean,
  liveEnabled: boolean,
  view: false | "draft" | "inactive",
  // Why the switch is disabled.
  blockedReason: string | null = null,
): JSX.Element {
  const state = (on: boolean, midSentence = false) => (
    <strong
      style={{
        color: on ? featureStatusColors.on : featureStatusColors.offMuted,
      }}
    >
      {midSentence ? (on ? "on" : "off") : on ? "On" : "Off"}
    </strong>
  );
  const where = view === "draft" ? "this draft" : "this revision";
  return (
    <Text as="div" size="sm" color="text-high">
      {!view ? (
        enabled ? (
          <>{state(true)}: traffic is on in this environment.</>
        ) : (
          <>
            {state(false)}: it evaluates to <code>null</code> in this
            environment.
          </>
        )
      ) : enabled === liveEnabled ? (
        <>
          {state(enabled)} in {where}, the same as live.
        </>
      ) : view === "draft" ? (
        <>
          {state(enabled)} in this draft.
          <Callout status="warning" size="sm" mt="2">
            Changed from live, where it&apos;s {state(liveEnabled, true)}. Takes
            effect when this draft is published.
          </Callout>
        </>
      ) : (
        <>
          {state(enabled)} in {where}. It&apos;s {state(liveEnabled, true)}{" "}
          live.
        </>
      )}
      {blockedReason ? (
        <Text as="div" mt="2" size="sm" color="text-mid">
          {blockedReason}
        </Text>
      ) : null}
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
  stickyTop,
}: {
  baseFeature: FeatureInterface;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  revisions: FeatureRevisionInterface[];
  experiments: ExperimentInterfaceStringDates[] | undefined;
  safeRollouts: SafeRolloutInterface[] | undefined;
  holdout: HoldoutInterface | undefined;
  rampSchedules: RampScheduleInterface[] | undefined;
  mutate: () => Promise<unknown>;
  version: number | null;
  setVersion: (v: number) => void;
  // Where headers stick: under the page's tabs and their status bar.
  stickyTop: number;
}) {
  const settings = useOrgSettings();
  const [edit, setEdit] = useState(false);
  const [showInvalidPrereqs, setShowInvalidPrereqs] = useState(false);
  const [prerequisiteModal, setPrerequisiteModal] = useState<{
    i: number;
  } | null>(null);
  const permissionsUtil = usePermissionsUtil();

  const [killSwitchTarget, setKillSwitchTarget] = useState<{
    envId: string;
    desiredState: boolean;
  } | null>(null);
  // The environment whose switch is saving to the draft. Every switch waits
  // on it: each save writes the draft's whole environment map, so two at once
  // would drop one.
  const [savingEnv, setSavingEnv] = useState<string | null>(null);
  // A switch's save the server refused, on the revision it was made on.
  const [envError, setEnvError] = useState<{
    envId: string;
    on: boolean;
    message: string;
  } | null>(null);
  useEffect(() => {
    setEnvError(null);
  }, [revision.version]);
  const { apiCall } = useAuth();

  const { hasCommercialFeature } = useUser();

  const { showFeatureUsage } = useFeatureUsage();

  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const envs = environments.map((e) => e.id);
  // Selected rules env tab, lifted here so the Default Value display resolves a
  // config-backed value for the same environment the rules are filtered to.
  // null = "All Environments".
  const [rulesEnv, setRulesEnv] = useFeatureRulesEnv();

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

  if (!baseFeature || !feature || !revision) return null;

  const hasConditionalState =
    prereqStates &&
    Object.values(prereqStates).some((s) => s.state === "conditional");

  const hasPrerequisitesCommercialFeature =
    hasCommercialFeature("prerequisites");

  const currentVersion = version || baseFeature.version;

  const baseVersion = revision.baseVersion || feature.version;
  const baseRevision = revisions.find((r) => r.version === baseVersion);
  const isLive = revision.version === feature.version;
  const isDraft = isActiveDraftStatus(revision.status);

  const projectId = feature.project;

  const isDiscarded = revision.status === "discarded";
  // Draft frozen by a pending scheduled publish with "lock edits" (parallel to a
  // ramp lockdown). Rebase is still allowed via the publish modal.
  const editLockedBySchedule =
    isDraft && isRevisionEditLockedBySchedule(revision);
  const isReadOnly =
    isDiscarded ||
    (revision.status === "published" && !isLive) ||
    editLockedBySchedule;
  // Past revisions show no controls; a locked draft shows them disabled.
  const showsControls = !isReadOnly || editLockedBySchedule;
  const lockReason = editLockedBySchedule ? SCHEDULE_EDIT_LOCK_REASON : null;

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

  const canToggleEnvironment = (envId: string) =>
    canOfferEnvironmentToggle(permissionsUtil, baseFeature, envId);
  const envBlockedReason = (envId: string) =>
    lockReason ??
    (canToggleEnvironment(envId)
      ? null
      : "You don't have permission to publish this environment.");
  const liveEnabled = (envId: string) =>
    baseFeature.environmentSettings?.[envId]?.enabled ?? false;
  // A draft that turns environments on or off, before it's published.
  const draftChangesEnvironments =
    isDraft &&
    environments.some(
      (en) =>
        (feature.environmentSettings?.[en.id]?.enabled ?? false) !==
        liveEnabled(en.id),
    );

  // On a draft, a switch saves to it; on live, it asks which draft to use.
  // A stale switch can't conflict: whoever flipped it first flipped it the
  // same way. Any refusal is shown on the card.
  const toggleEnvironment = async (envId: string, on: boolean) => {
    setEnvError(null);
    if (!isDraft || !canEditDrafts) {
      setKillSwitchTarget({ envId, desiredState: on });
      return;
    }
    setSavingEnv(envId);
    try {
      await apiCall(`/feature/${feature.id}/toggle`, {
        method: "POST",
        body: JSON.stringify({
          environments: { [envId]: on },
          draftVersion: revision.version,
        }),
      });
      track("Feature Environment Toggle", {
        environments: { [envId]: on },
        autoPublish: false,
      });
      await mutate();
    } catch (e) {
      setEnvError({
        envId,
        on,
        message: e instanceof Error ? e.message : "There was an error",
      });
      // The draft may have been published, discarded or locked meanwhile.
      await mutate();
    } finally {
      setSavingEnv(null);
    }
  };
  // Switches show when any environment can change; each one is disabled where
  // it can't.
  const canChangeEnvironments = envs.some(canToggleEnvironment);
  const addPrerequisiteLabel = (
    <Flex align="center" gap="1">
      <PiPlus />
      Add prerequisite
    </Flex>
  );

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
        <SectionFrame
          title="Environments"
          mb="5"
          footnote={
            <>
              Disabled environments evaluate to <code>null</code>
            </>
          }
          titleAddon={
            showFeatureUsage ? (
              <FeatureUsageSparkline valueType={feature.valueType} />
            ) : null
          }
          actions={
            <>
              {canEditDrafts && showsControls ? (
                lockReason ? (
                  <UITooltip content={lockReason}>
                    <Link style={{ opacity: 0.5, cursor: "not-allowed" }}>
                      {addPrerequisiteLabel}
                    </Link>
                  </UITooltip>
                ) : (
                  <PremiumTooltip commercialFeature="prerequisites">
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
                      style={
                        hasPrerequisitesCommercialFeature
                          ? undefined
                          : { opacity: 0.5, cursor: "not-allowed" }
                      }
                    >
                      {addPrerequisiteLabel}
                    </Link>
                  </PremiumTooltip>
                )
              ) : null}
            </>
          }
        >
          {prerequisites.length > 0 ? (
            /* Grid layout: env icons column-aligned with prereq rows */
            <>
              <div style={{ overflowX: "auto" }}>
                <Flex direction="column" style={{ width: "max-content" }}>
                  {/* Header row: env names in columns past the 200px label column */}
                  <Flex align="start" pb="1">
                    <Box style={{ width: 200, flexShrink: 0 }} />
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
                          <Flex align="center" justify="center" pt="1">
                            <Tooltip
                              popperClassName="text-left"
                              flipTheme={false}
                              body={environmentKillSwitchTooltipBody(
                                enabled,
                                liveEnabled(en.id),
                                envAndSummaryTooltipNonLiveDisclaimer,
                                showsControls && canChangeEnvironments
                                  ? envBlockedReason(en.id)
                                  : null,
                              )}
                            >
                              {showsControls && canChangeEnvironments ? (
                                <EnvironmentSwitch
                                  environment={en.id}
                                  enabled={enabled}
                                  onToggle={(on) =>
                                    toggleEnvironment(en.id, on)
                                  }
                                  disabled={
                                    savingEnv !== null ||
                                    !!envBlockedReason(en.id)
                                  }
                                  changed={
                                    isDraft && enabled !== liveEnabled(en.id)
                                  }
                                  labelOverhangs
                                />
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
                  <Flex align="center" pb="2">
                    <Box style={{ width: 200, flexShrink: 0 }}>
                      {/* A row label: regular weight, a step back from the values. */}
                      <Text weight="regular" color="text-mid">
                        Prerequisites
                      </Text>
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
                      lockedBySchedule={editLockedBySchedule}
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
                      <Text weight="regular" color="text-mid">
                        Net status
                      </Text>
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
            </>
          ) : (
            /* Pill layout: simple env name + icon pairs, no grid needed */
            <Box>
              <Flex
                justify="start"
                align="center"
                gapX="6"
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
                      >
                        {/* Labelled as the prerequisites grid labels them. */}
                        <Text
                          weight="semibold"
                          color={enabled ? "text-mid" : "text-low"}
                        >
                          <OverflowText maxWidth={120}>{en.id}</OverflowText>
                        </Text>
                        <Tooltip
                          popperClassName="text-left"
                          flipTheme={false}
                          body={environmentKillSwitchTooltipBody(
                            enabled,
                            liveEnabled(en.id),
                            envAndSummaryTooltipNonLiveDisclaimer,
                            showsControls && canChangeEnvironments
                              ? envBlockedReason(en.id)
                              : null,
                          )}
                        >
                          {showsControls && canChangeEnvironments ? (
                            <EnvironmentSwitch
                              environment={en.id}
                              enabled={enabled}
                              onToggle={(on) => toggleEnvironment(en.id, on)}
                              disabled={
                                savingEnv !== null || !!envBlockedReason(en.id)
                              }
                              changed={
                                isDraft && enabled !== liveEnabled(en.id)
                              }
                            />
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
                      <Link href="/environments">Manage environments</Link>
                    </Callout>
                  </Box>
                )}
              </Flex>
            </Box>
          )}

          {envError ? (
            <HelperText status="error" size="sm" mt="3">
              Couldn&apos;t turn {envError.envId} {envError.on ? "on" : "off"}:{" "}
              {/* Several validation hooks' messages arrive one per line. */}
              <span style={{ whiteSpace: "pre-line" }}>{envError.message}</span>
            </HelperText>
          ) : null}
          {draftChangesEnvironments ? (
            // Amber because it's about the draft, not a warning.
            <HelperText
              status="warning"
              size="sm"
              mt="3"
              icon={<PiInfo size={13} />}
            >
              Environment changes go live after this draft is published.
            </HelperText>
          ) : null}
          {hasConditionalState && (
            <PrerequisiteAlerts
              environments={envs}
              type="feature"
              project={projectId ?? ""}
              mt="4"
              mb="0"
            />
          )}
        </SectionFrame>

        <SectionFrame
          title="Default Value"
          mt="5"
          // Its copy and fullscreen buttons show while it's hovered, as a
          // rule's do.
          className={cornerStyles.hoverActions}
          actions={
            canEditDrafts && showsControls ? (
              <UITooltip content={lockReason} enabled={!!lockReason}>
                <Button
                  variant="ghost"
                  size="md"
                  disabled={!!lockReason}
                  onClick={() => setEdit(true)}
                >
                  Edit
                </Button>
              </UITooltip>
            ) : null
          }
        >
          <ForceSummary
            // The section's title already says what it is.
            label={null}
            value={getFeatureDefaultValue(feature)}
            feature={feature}
            isDefault={true}
            // Match FeatureRules' tab: ignore a stored env that isn't one
            // of this feature's environments (falls back to base).
            environment={
              rulesEnv !== null && envs.includes(rulesEnv)
                ? rulesEnv
                : undefined
            }
          />
        </SectionFrame>

        {environments.length > 0 ? (
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
            stickyHeaderTop={stickyTop}
          />
        ) : (
          <SectionFrame title="Rules" mt="5">
            <p>
              You need at least one environment to add rules. Add powerful logic
              on top of your feature. The first rule that matches will be
              applied and override the Default Value.
            </p>
          </SectionFrame>
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
        {killSwitchTarget && (
          <KillSwitchModal
            feature={feature}
            baseFeature={baseFeature}
            environment={killSwitchTarget.envId}
            desiredState={killSwitchTarget.desiredState}
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
