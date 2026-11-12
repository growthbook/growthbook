import {
  FeatureInterface,
  FeaturePrerequisite,
  FeatureRule,
} from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { PiCaretRightBold, PiCaretDownBold } from "react-icons/pi";
import {
  evalDeterministicPrereqValue,
  filterEnvironmentsByFeature,
  getMalformedPrereqConditionError,
  getFeatureBaseConfigKey,
  getReviewSetting,
  getTargetingProjectIds,
  namespacesToMap,
  sdkValueResolver,
} from "shared/util";
import { isRevisionEditLockedBySchedule } from "shared/enterprise";
import { canOfferEnvironmentToggle } from "shared/permissions";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box, Flex } from "@radix-ui/themes";
import {
  CONFIG_REF_PATTERN,
  CONSTANT_REF_PATTERN,
  isActiveDraftStatus,
  SafeRolloutInterface,
  HoldoutInterface,
  MinimalFeatureRevisionInterface,
  RampScheduleInterface,
} from "shared/validators";
import {
  buildConstantValueMap,
  ConstantValueMap,
  resolveConstantRefs,
} from "shared/sdk-versioning";
import Button from "@/ui/Button";
import Switch from "@/ui/Switch";
import { FeatureBadge } from "@/components/Features/FeatureBadge";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import ForceSummary from "@/components/Features/ForceSummary";
import track, { entityTrackingHash } from "@/services/track";
import { useAuth } from "@/services/auth";
import EditDefaultValueModal from "@/components/Features/EditDefaultValueModal";
import KillSwitchModal from "@/components/Features/KillSwitchModalNew";
import {
  getFeatureDefaultValue,
  getKillSwitchGatedEnvs,
  useEnvironments,
  getPrerequisites,
  getRules,
  isRuleInactive,
  useFeatureRulesEnv,
} from "@/services/features";
import {
  getEnvironmentStatus,
  holdoutTrafficStep,
  PrerequisiteResult,
  ruleProjectReach,
  sdkValueText,
  ruleTrafficStep,
  TrafficStep,
} from "@/services/environmentStatus";
import { ResolvableInput } from "@/services/configBackedValue";
import useApi from "@/hooks/useApi";
import { useContextualBandits } from "@/hooks/useContextualBandits";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
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
import {
  PrerequisiteStateResult,
  useBatchPrerequisiteStates,
  usePrerequisiteStates,
} from "@/hooks/usePrerequisiteStates";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import {
  LockedRowMenu,
  SCHEDULE_EDIT_LOCK_REASON,
} from "@/components/Features/ScheduleLock";
import SectionFrame from "@/components/SectionFrame";
import { useHoldouts } from "@/hooks/useHoldouts";
import { EnvironmentToggleChange } from "@/components/Features/FeatureDiffRenders";
import EnvironmentStatusCards, {
  PrerequisiteList,
  EnvironmentCard,
} from "./EnvironmentStatusCards";
import { DraftChangeMark } from "./DraftChangesPopover";
import {
  DeletePrerequisiteModal,
  PrerequisiteStatesCols,
} from "./PrerequisiteStatusRow";
import { isRuleSkipped } from "./Rule";
import PrerequisiteAlerts from "./PrerequisiteAlerts";
import PrerequisiteModal from "./PrerequisiteModal";
import { featureStatusColors } from "./FeaturesOverview";
import FeatureRules from "./FeatureRulesNew";
import cornerStyles from "./CornerActions.module.scss";

// A changeable environment's switch, its state named after it.
function EnvironmentSwitch({
  environment,
  enabled,
  onToggle,
  disabled = false,
  changed = false,
}: {
  environment: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  disabled?: boolean;
  // Differs from live, in a draft: ringed in amber.
  changed?: boolean;
}) {
  return (
    <Flex align="center" gap="2">
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
        }}
      >
        <Text size="sm" weight="medium">
          {enabled ? "On" : "Off"}
        </Text>
      </span>
    </Flex>
  );
}

export default function FeaturesOverviewNew({
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
  const namespaces = settings?.namespaces;
  const [edit, setEdit] = useState(false);
  const [showInvalidPrereqs, setShowInvalidPrereqs] = useState(false);
  const [prerequisiteModal, setPrerequisiteModal] = useState<{
    i: number;
  } | null>(null);
  const permissionsUtil = usePermissionsUtil();

  const [killSwitchTarget, setKillSwitchTarget] = useState<{
    desiredStates: Record<string, boolean>;
    header: string;
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
  const environments = useMemo(
    () => filterEnvironmentsByFeature(allEnvironments, feature),
    [allEnvironments, feature],
  );
  const envs = useMemo(() => environments.map((e) => e.id), [environments]);
  // Selected rules env tab, lifted here so the Default Value display resolves a
  // config-backed value for the same environment the rules are filtered to.
  // null = "All Environments".
  const [rulesEnv, setRulesEnv] = useFeatureRulesEnv();
  const prerequisites = feature?.prerequisites || [];

  const { states: prereqStatesRaw, mutate: mutatePrereqStates } =
    usePrerequisiteStates({
      featureId: feature.id,
      environments: envs,
      enabled: !!feature,
      skipRootConditions: true,
      // Live until the page settles on a version, so landing on live asks once
      version: version ?? feature?.version,
    });

  // Each prerequisite's own state per environment, for what its condition
  // makes of it.
  // Live's too, to compare a past revision against what's served now.
  // And the ones gating its rules, which the payload settles the same way.
  const rulePrerequisites = (f: FeatureInterface) =>
    envs
      .flatMap((env) => getRules(f, env))
      .flatMap((rule) => [
        ...(rule.prerequisites ?? []),
        ...(rule.type === "experiment-ref"
          ? (experiments?.find((e) => e.id === rule.experimentId)?.phases.at(-1)
              ?.prerequisites ?? [])
          : []),
      ]);
  const prerequisiteIds = [
    ...new Set(
      [
        ...prerequisites,
        ...(baseFeature.prerequisites ?? []),
        ...rulePrerequisites(feature),
        ...rulePrerequisites(baseFeature),
      ].map((p) => p.id),
    ),
  ];
  const {
    results: parentStates,
    loading: parentStatesLoading,
    error: parentStatesError,
    mutate: retryParentStates,
  } = useBatchPrerequisiteStates({
    baseFeatureId: feature.id,
    featureIds: prerequisiteIds,
    environments: envs,
    enabled: prerequisiteIds.length > 0,
  });
  // The constants and configs the flag's values name, its own config among
  // them; the server adds what those reach, as the payload resolves them.
  const resolvableKeys = useMemo(() => {
    const text = JSON.stringify([
      feature.defaultValue,
      feature.rules,
      feature.holdout,
    ]);
    const keys = (pattern: string, extra: string[] = []) =>
      [
        ...new Set([
          ...[...text.matchAll(new RegExp(pattern, "g"))].map((m) => m[1]),
          ...extra,
        ]),
      ]
        .sort()
        .join(",");
    const baseConfig = getFeatureBaseConfigKey(feature);
    return {
      constants: keys(CONSTANT_REF_PATTERN),
      configs: keys(CONFIG_REF_PATTERN, baseConfig ? [baseConfig] : []),
    };
  }, [feature]);
  const needsResolvables = !!(
    resolvableKeys.constants || resolvableKeys.configs
  );
  const { data: resolvables, error: resolvablesError } = useApi<{
    constants: ResolvableInput[];
  }>(
    `/constants-resolvables?project=${feature.project || ""}&constants=${
      resolvableKeys.constants
    }&configs=${resolvableKeys.configs}`,
    { shouldRun: () => needsResolvables },
  );
  // The holdout's own experiment says how much of the traffic it holds back.
  const { experimentsMap: holdoutExperiments, loading: holdoutsLoading } =
    useHoldouts(undefined, false, {
      enabled: !!holdout,
    });
  // To leave out contextual bandit rules the SDK skips, as the rule list does.
  const { contextualBanditsMap } = useContextualBandits();
  const [deletingPrerequisite, setDeletingPrerequisite] = useState<{
    i: number;
    baseline: FeaturePrerequisite[];
  } | null>(null);

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
  }, [prereqStatesRaw, feature, envs]);

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
  // Without draft rights, publishing is the only route, which review closes.
  const killSwitchGated = getKillSwitchGatedEnvs(
    settings?.requireReviews,
    baseFeature,
  );
  const needsDraftToFlip = (envId: string) =>
    !canEditDrafts &&
    !permissionsUtil.canBypassFlagApprovalChecks(baseFeature, "feature") &&
    (killSwitchGated === "all" ||
      (killSwitchGated !== "none" && killSwitchGated.has(envId)));
  const envBlockedReason = (envId: string) =>
    lockReason ??
    (!canToggleEnvironment(envId)
      ? "You don't have permission to publish this environment."
      : needsDraftToFlip(envId)
        ? "This change needs review before it can be published, and you don't have permission to put it in a draft."
        : null);
  const liveEnabled = (envId: string) =>
    baseFeature.environmentSettings?.[envId]?.enabled ?? false;

  // On a draft, a switch saves to it; on live, it asks which draft to use.
  // A stale switch can't conflict: whoever flipped it first flipped it the
  // same way. Any refusal is shown on the card.
  const toggleEnvironment = async (envId: string, on: boolean) => {
    setEnvError(null);
    if (!isDraft || !canEditDrafts) {
      setKillSwitchTarget({
        desiredStates: { [envId]: on },
        header: `${on ? "Enable" : "Disable"} ${envId}`,
      });
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
        entity_id_hash: entityTrackingHash(feature.id),
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

  const prerequisiteResult = useCallback(
    (
      prerequisite: FeaturePrerequisite,
      env: string,
    ): PrerequisiteResult | null => {
      if (prereqStates?.[env]?.state === "cyclic") return "cycle";
      // Unknown until they load, or if they don't.
      if (!parentStates) return null;
      // A parent the states don't include (archived, deleted, or out of view)
      // reaches the SDK as an unknown feature: null.
      const parent = parentStates[prerequisite.id]?.states[env] ?? {
        state: "deterministic" as const,
        value: null,
      };
      if (parent.state === "cyclic") return "cycle";
      if (parent.state === "conditional") return "varies";
      return evalDeterministicPrereqValue(
        parent.value ?? null,
        prerequisite.condition,
      ) === "pass"
        ? "met"
        : "unmet";
    },
    [prereqStates, parentStates],
  );
  const prerequisiteState = (
    prerequisiteId: string,
    env: string,
    { inScrollArea = false, inline = false } = {},
  ) => {
    // A parent the states don't include reaches the SDK as an unknown
    // feature, null, as prerequisiteResult counts it.
    const states = parentStates
      ? (parentStates[prerequisiteId]?.states ?? {
          [env]: { state: "deterministic" as const, value: null },
        })
      : undefined;
    // A boolean parent serving false reads as off, not merely live.
    const served = states?.[env];
    const defaultValues =
      served?.state === "deterministic" && typeof served.value === "boolean"
        ? { [env]: String(served.value) }
        : undefined;
    return (
      <PrerequisiteStatesCols
        prereqStates={states}
        defaultValues={defaultValues}
        envs={[env]}
        loading={parentStatesLoading}
        colWidth={inline ? 12 : 20}
        compact
        iconSize={inline ? 12 : undefined}
        usePortal={inScrollArea}
      />
    );
  };
  const sameJson = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const livePrerequisites = baseFeature.prerequisites ?? [];
  const prerequisiteChange = (p: FeaturePrerequisite) => {
    if (!isDraft) return null;
    const live = livePrerequisites.find((l) => l.id === p.id);
    if (!live) return "added" as const;
    return sameJson(live, p) ? null : ("edited" as const);
  };
  const removedPrerequisites = isDraft
    ? livePrerequisites
        .filter((live) => !prerequisites.some((p) => p.id === live.id))
        .map((live) => live.id)
    : [];
  // Each prerequisite the draft adds, edits or removes.
  const prerequisiteChangeRows = [
    ...prerequisites.flatMap((p) => {
      const change = prerequisiteChange(p);
      if (!change) return [];
      return [
        {
          label: <DraftChangeMark change={change} />,
          value: p.id,
          text: `${change} ${p.id}`,
        },
      ];
    }),
    ...removedPrerequisites.map((id) => ({
      label: <DraftChangeMark change="removed" />,
      value: id,
      text: `removed ${id}`,
    })),
  ];
  // What the flag serves in each environment, worked out again only when
  // something it depends on changes; null until its prerequisites' states,
  // constants and holdouts load.
  const environmentStatuses = useMemo(() => {
    // The rules the rule list doesn't mark inactive or skipped.
    const liveRules = (env: string): FeatureRule[] =>
      getRules(feature, env).filter(
        (rule) =>
          !isRuleInactive(rule, experimentsMap) &&
          !isRuleSkipped({
            rule,
            linkedExperiment:
              rule.type === "experiment-ref"
                ? experimentsMap.get(rule.experimentId)
                : undefined,
            linkedContextualBandit:
              rule.type === "contextual-bandit-ref"
                ? contextualBanditsMap.get(rule.contextualBanditId)
                : undefined,
          }),
      );
    // A value as the SDK receives it in an environment. A config-backed flag's
    // object values are patches over its config (or the descendant config they
    // name), resolved per environment; a rule's lands on the resolved default.
    // One resolver per environment, as the payload builds it, so the default
    // is parsed and resolved once.
    const inputs = resolvables?.constants;
    const resolvers = new Map<string, ReturnType<typeof sdkValueResolver>>();
    const servedValue = (
      value: string,
      env: string,
      { sparse = false, arm = false } = {},
    ): string => {
      let resolver = resolvers.get(env);
      if (!resolver) {
        let map: ConstantValueMap | undefined;
        resolver = sdkValueResolver({
          valueType: feature.valueType,
          baseConfig: feature.baseConfig,
          defaultValue: feature.defaultValue,
          resolveRefs: inputs
            ? (v) =>
                resolveConstantRefs(
                  v,
                  (map ??= buildConstantValueMap(inputs, env)),
                  undefined,
                  undefined,
                  feature.project || "",
                  env,
                )
            : undefined,
        });
        resolvers.set(env, resolver);
      }
      // As the payload decides it: a rule's value is a patch when the rule
      // says so or the flag is config-backed; a safe rollout's or holdout's
      // never is.
      return sdkValueText(
        feature.valueType,
        resolver.serve(value, arm && (sparse || resolver.configBacked)),
      );
    };
    // The holdout's control group, then the live rules.
    // The payload holds back traffic only while the holdout's experiment runs.
    const holdoutExperiment = holdout
      ? holdoutExperiments.get(holdout.experimentId)
      : undefined;
    const holdoutRunning =
      holdoutExperiment?.status === "running" && !holdoutExperiment.archived;
    const namespaceDefinitions = namespacesToMap(namespaces);
    const trafficSteps = (env: string): TrafficStep[] => [
      ...(holdout &&
      holdoutRunning &&
      feature.holdout?.id === holdout.id &&
      holdout.environmentSettings?.[env]?.enabled
        ? [
            holdoutTrafficStep(
              servedValue(feature.holdout.value, env),
              holdoutExperiment,
            ),
          ]
        : []),
      ...liveRules(env).flatMap((rule) => {
        // Dropped for connections outside the rule's own projects.
        const reach = ruleProjectReach(rule, getTargetingProjectIds(feature));
        if (reach === "none") return [];
        const experiment =
          rule.type === "experiment-ref"
            ? experimentsMap.get(rule.experimentId)
            : undefined;
        const phase = experiment?.phases.at(-1);
        // As the payload settles a deterministic gate: met, it's dropped;
        // unmet or circular, the rule is. One that varies stays as targeting.
        const gates = [
          ...(rule.prerequisites ?? []),
          ...(phase?.prerequisites ?? []),
        ];
        const blocked = gates.some((p) => {
          const result = prerequisiteResult(p, env);
          return result === "unmet" || result === "cycle";
        });
        const unsettled = (list?: FeaturePrerequisite[]) =>
          list?.filter((p) => prerequisiteResult(p, env) !== "met");
        const step = ruleTrafficStep(
          { ...rule, prerequisites: unsettled(rule.prerequisites) },
          {
            namespaces: namespaceDefinitions,
            resolveValue: (value, options) => servedValue(value, env, options),
            experiment:
              experiment && phase
                ? {
                    ...experiment,
                    phases: [
                      ...experiment.phases.slice(0, -1),
                      {
                        ...phase,
                        prerequisites: unsettled(phase.prerequisites),
                      },
                    ],
                  }
                : experiment,
            safeRollout:
              rule.type === "safe-rollout"
                ? safeRolloutsMap.get(rule.safeRolloutId)
                : undefined,
          },
        );
        if (blocked) {
          return [
            {
              ...step,
              traffic: { participation: 0, shares: step.traffic?.shares ?? [] },
            },
          ];
        }
        // Served to only some connections, what it serves depends on which.
        return [{ ...step, targeted: step.targeted || reach === "some" }];
      }),
    ];
    const environmentStatus = (env: string) => {
      const results = (feature.prerequisites ?? []).map((p) => ({
        id: p.id,
        result: prerequisiteResult(p, env),
      }));
      if (results.some((p) => !p.result)) return null;
      // Values aren't known until their constants and configs load; if that
      // fails, they show as stored.
      if (needsResolvables && !resolvables && !resolvablesError) return null;
      // Nor whether a holdout runs until the holdouts load.
      if (feature.holdout && holdoutsLoading) return null;
      return getEnvironmentStatus({
        enabled: feature.environmentSettings?.[env]?.enabled ?? false,
        archived: !!feature.archived,
        prerequisites: results.flatMap((p) =>
          p.result ? [{ id: p.id, result: p.result }] : [],
        ),
        steps: trafficSteps(env),
        defaultValue: servedValue(feature.defaultValue, env),
        isBoolean: feature.valueType === "boolean",
      });
    };
    return new Map(environments.map((en) => [en.id, environmentStatus(en.id)]));
  }, [
    feature,
    environments,
    experimentsMap,
    contextualBanditsMap,
    safeRolloutsMap,
    holdout,
    holdoutExperiments,
    holdoutsLoading,
    namespaces,
    prerequisiteResult,
    needsResolvables,
    resolvables,
    resolvablesError,
  ]);
  // The draft turning this environment on or off.
  const environmentChanges = (envId: string) => {
    const to = feature.environmentSettings?.[envId]?.enabled ?? false;
    const from = liveEnabled(envId);
    return isDraft && from !== to
      ? [
          {
            title: "Environment",
            rows: [
              {
                label: envId,
                value: (
                  <EnvironmentToggleChange
                    from={from}
                    to={to}
                    besideApprovals={false}
                  />
                ),
                // Said beside the environment's name, which it'd repeat.
                text: `turned ${to ? "on" : "off"}`,
              },
            ],
          },
        ]
      : null;
  };
  const environmentCards: EnvironmentCard[] = environments.map((en) => {
    return {
      id: en.id,
      status: environmentStatuses.get(en.id) ?? null,
      prerequisites: prerequisites.map((p, index) => ({
        id: p.id,
        index,
        result: prerequisiteResult(p, en.id),
      })),
      environmentChanges: environmentChanges(en.id),
    };
  });
  const canEditPrerequisites = canEditDrafts && showsControls && !isReadOnly;
  const prerequisiteActions = (i: number) =>
    !canEditPrerequisites ? null : lockReason ? (
      <LockedRowMenu style={{ margin: 0 }} />
    ) : (
      <DropdownMenu
        trigger={<MoreMenuTrigger label="Prerequisite actions" size="sm" />}
        menuPlacement="end"
        variant="soft"
      >
        <DropdownMenuItem onClick={() => setPrerequisiteModal({ i })}>
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          color="red"
          onClick={() =>
            setDeletingPrerequisite({ i, baseline: getPrerequisites(feature) })
          }
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenu>
    );
  const openAddPrerequisite = () => {
    if (!hasPrerequisitesCommercialFeature) return;
    setPrerequisiteModal({ i: getPrerequisites(feature).length });
    track("Viewed prerequisite feature modal", {
      entity_id_hash: entityTrackingHash(feature.id),
      source: "add-prerequisite",
    });
  };
  const allEnvironmentsOff = envs.every(
    (envId) => !feature.environmentSettings?.[envId]?.enabled,
  );
  // Without draft rights it can only publish, which every environment it
  // turns off has to allow; the first that doesn't says why.
  const turnOffAllBlockedReason = canEditDrafts
    ? null
    : (envs
        .filter(liveEnabled)
        .map(envBlockedReason)
        .find((reason) => reason !== null) ?? null);
  const environmentActions =
    showsControls && (canEditDrafts || canChangeEnvironments) ? (
      lockReason ? (
        <LockedRowMenu style={{ margin: 0 }} />
      ) : (
        <DropdownMenu
          trigger={<MoreMenuTrigger label="Environment actions" />}
          menuPlacement="end"
          variant="soft"
        >
          {canEditDrafts ? (
            <DropdownMenuItem
              disabled={!hasPrerequisitesCommercialFeature}
              onClick={openAddPrerequisite}
            >
              <PremiumTooltip commercialFeature="prerequisites">
                Add prerequisite
              </PremiumTooltip>
            </DropdownMenuItem>
          ) : null}
          {canEditDrafts && canChangeEnvironments ? (
            <DropdownMenuSeparator />
          ) : null}
          {canChangeEnvironments ? (
            <DropdownMenuItem
              color="red"
              disabled={allEnvironmentsOff || !!turnOffAllBlockedReason}
              tooltip={
                allEnvironmentsOff
                  ? "Already off in all environments"
                  : (turnOffAllBlockedReason ?? undefined)
              }
              onClick={() =>
                setKillSwitchTarget({
                  desiredStates: Object.fromEntries(
                    envs.map((envId) => [envId, false]),
                  ),
                  header: "Turn off ALL environments",
                })
              }
            >
              Turn off ALL environments
            </DropdownMenuItem>
          ) : null}
        </DropdownMenu>
      )
    ) : null;

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
  environments.forEach((e) => {
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

        {/* Its box brings its own margin; without markdown it renders nothing. */}
        <CustomMarkdown page={"feature"} variables={variables} />
        <SectionFrame
          title="Environments"
          mb="4"
          actions={
            <Flex align="center" gap="5">
              {showFeatureUsage ? (
                <FeatureUsageSparkline valueType={feature.valueType} />
              ) : null}
              {environmentActions}
            </Flex>
          }
        >
          {parentStatesError ? (
            <Callout status="warning" mb="3">
              Couldn&apos;t load prerequisite states, so what each environment
              serves can&apos;t be shown.{" "}
              <Link onClick={() => retryParentStates()}>Try again</Link>
            </Callout>
          ) : null}
          {environments.length > 0 ? (
            <EnvironmentStatusCards
              cards={environmentCards}
              valueType={feature.valueType}
              prerequisiteState={prerequisiteState}
              renderToggle={(envId) => {
                const enabled =
                  feature.environmentSettings?.[envId]?.enabled ?? false;
                const blocked = envBlockedReason(envId);
                return showsControls && canChangeEnvironments ? (
                  <UITooltip content={blocked} enabled={!!blocked}>
                    {/* A DOM trigger, which the switch component isn't; and
                        focusable while the switch is disabled, so the reason
                        reaches the keyboard too. */}
                    <span
                      tabIndex={blocked ? 0 : undefined}
                      style={{ display: "inline-flex" }}
                    >
                      <EnvironmentSwitch
                        environment={envId}
                        enabled={enabled}
                        onToggle={(on) => toggleEnvironment(envId, on)}
                        disabled={savingEnv !== null || !!blocked}
                        changed={isDraft && enabled !== liveEnabled(envId)}
                      />
                    </span>
                  </UITooltip>
                ) : (
                  <Text color={enabled ? "text-high" : "text-low"}>
                    {enabled ? "On" : "Off"}
                  </Text>
                );
              }}
            />
          ) : (
            <Callout status="warning">
              <strong>This Feature Flag has no associated environments.</strong>{" "}
              Ensure that this Feature Flag&apos;s project is included in at
              least one environment to use it.{" "}
              <Link href="/environments">Manage environments</Link>
            </Callout>
          )}
          {prerequisites.length || removedPrerequisites.length ? (
            <PrerequisiteList
              prerequisites={prerequisites.map((p, index) => ({
                id: p.id,
                index,
                change: prerequisiteChange(p),
              }))}
              removed={removedPrerequisites}
              changes={
                prerequisiteChangeRows.length
                  ? [{ title: "Prerequisites", rows: prerequisiteChangeRows }]
                  : null
              }
              environments={environments.map((en) => en.id)}
              prerequisiteState={prerequisiteState}
              actions={prerequisiteActions}
            />
          ) : null}

          {envError ? (
            <HelperText status="error" size="sm" mt="3">
              Couldn&apos;t turn {envError.envId} {envError.on ? "on" : "off"}:{" "}
              {/* Several validation hooks' messages arrive one per line. */}
              <span style={{ whiteSpace: "pre-line" }}>{envError.message}</span>
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
          mt="4"
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
            revisionList={revisionList}
            rampSchedules={rampSchedules}
            draftRevision={revision}
            rulesEnv={rulesEnv}
            setRulesEnv={setRulesEnv}
            baseRevision={baseRevision}
            stickyHeaderTop={stickyTop}
          />
        ) : (
          <SectionFrame title="Rules" mt="4">
            <p>
              You need at least one environment to add rules. Add powerful logic
              on top of your feature. The first rule that matches will be
              applied and override the default value.
            </p>
          </SectionFrame>
        )}

        {/* Modals */}

        {edit && (
          <EditDefaultValueModal
            close={() => setEdit(false)}
            feature={feature}
            revisionList={revisionList}
            mutate={mutate}
            setVersion={setVersion}
          />
        )}
        {deletingPrerequisite ? (
          <DeletePrerequisiteModal
            i={deletingPrerequisite.i}
            feature={feature}
            baseline={deletingPrerequisite.baseline}
            revisionList={revisionList}
            gatedEnvSet={gatedEnvSet}
            mutate={mutate}
            setVersion={setVersion}
            close={() => setDeletingPrerequisite(null)}
          />
        ) : null}
        {prerequisiteModal !== null && (
          <PrerequisiteModal
            feature={feature}
            revisionList={revisionList}
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
            desiredStates={killSwitchTarget.desiredStates}
            header={killSwitchTarget.header}
            currentVersion={currentVersion}
            revisionList={revisionList}
            mutate={mutate}
            setVersion={setVersion}
            close={() => setKillSwitchTarget(null)}
          />
        )}
      </Box>
    </>
  );
}
