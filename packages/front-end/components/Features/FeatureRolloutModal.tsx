import React, { FC, type ReactNode, useMemo, useState } from "react";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { PiPlusBold, PiShieldCheckBold, PiInfo } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import type {
  FeatureInterface,
  SavedGroupTargeting,
} from "shared/types/feature";
import {
  RevisionRampCreateFeatureRolloutAction,
  RampStep,
} from "shared/validators";
import { isEnvironmentDevLike } from "shared/util";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import RadioGroup from "@/ui/RadioGroup";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConditionInput from "@/components/Features/ConditionInput";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
// eslint-disable-next-line no-restricted-imports
import Modal from "@/components/Modal";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import styles from "./RuleModal/RampScheduleSection.module.scss";

type LockdownMode = "none" | "locked";

interface Props {
  feature: FeatureInterface;
  version: number | "new";
  existing?: RevisionRampCreateFeatureRolloutAction | null;
  onClose: () => void;
  onSuccess: (version: number) => Promise<unknown>;
}

type IntervalUnit = "hours" | "days";

// Gate-level targeting that can change per step
interface GatePatch {
  coverage?: number; // 0–100 in UI, converted to 0–1 on submit
  condition?: string;
  savedGroups?: SavedGroupTargeting[];
}

type GateField = "condition" | "savedGroups";

const GATE_FIELD_LABELS: Record<GateField, string> = {
  condition: "Attribute targeting",
  savedGroups: "Saved groups",
};

const GATE_FIELD_DEFAULTS: Record<GateField, unknown> = {
  condition: "{}",
  savedGroups: [],
};

interface RolloutStep {
  patch: GatePatch;
  envToggles: Record<string, boolean>;
  triggerType: "interval" | "approval";
  intervalValue: number;
  intervalUnit: IntervalUnit;
  approvalNotes: string;
  notesOpen: boolean;
  monitored: boolean;
  effectsOpen: boolean;
}

const UNIT_SECONDS: Record<IntervalUnit, number> = {
  hours: 3600,
  days: 86400,
};

const POLL_INTERVAL_SECONDS = 60;

const COL = {
  num: 30,
  coverage: 80,
  trigger: 130,
  duration: 200,
} as const;

function ColHeader({
  children,
  width,
}: {
  children: ReactNode;
  width: number;
}) {
  return (
    <Box style={{ width, flexShrink: 0 }}>
      <Text size="small" weight="medium" color="text-low">
        {children}
      </Text>
    </Box>
  );
}

function defaultSteps(
  monitored: boolean,
  enableEnvIds: string[] = [],
): RolloutStep[] {
  const envToggles: Record<string, boolean> = {};
  for (const id of enableEnvIds) envToggles[id] = true;
  const hasEnvs = enableEnvIds.length > 0;
  return [
    {
      patch: { coverage: 10 },
      envToggles,
      triggerType: "interval",
      intervalValue: 1,
      intervalUnit: "days",
      approvalNotes: "",
      notesOpen: false,
      monitored,
      effectsOpen: hasEnvs,
    },
    {
      patch: { coverage: 25 },
      envToggles: {},
      triggerType: "interval",
      intervalValue: 1,
      intervalUnit: "days",
      approvalNotes: "",
      notesOpen: false,
      monitored,
      effectsOpen: false,
    },
    {
      patch: { coverage: 50 },
      envToggles: {},
      triggerType: "interval",
      intervalValue: 1,
      intervalUnit: "days",
      approvalNotes: "",
      notesOpen: false,
      monitored,
      effectsOpen: false,
    },
    {
      patch: { coverage: 100 },
      envToggles: {},
      triggerType: "interval",
      intervalValue: 1,
      intervalUnit: "days",
      approvalNotes: "",
      notesOpen: false,
      monitored,
      effectsOpen: false,
    },
  ];
}

function hydrateSteps(stored: RampStep[]): RolloutStep[] {
  return stored.map((s) => {
    const patch: GatePatch = {};
    const envToggles: Record<string, boolean> = {};

    for (const action of s.actions) {
      if (action.type === "set-gate") {
        if (action.patch.coverage !== undefined)
          patch.coverage = Math.round(action.patch.coverage * 100);
        if (action.patch.condition !== undefined)
          patch.condition = action.patch.condition ?? undefined;
        if (action.patch.savedGroups !== undefined)
          patch.savedGroups = action.patch.savedGroups ?? undefined;
      } else if (action.type === "set-environment-enabled") {
        envToggles[action.environment] = action.enabled;
      }
    }

    let triggerType: "interval" | "approval" = "interval";
    let intervalValue = 1;
    let intervalUnit: IntervalUnit = "days";

    if (s.trigger.type === "approval") {
      triggerType = "approval";
    } else if (s.trigger.type === "interval") {
      const secs = s.trigger.seconds;
      if (secs >= 86400 && secs % 86400 === 0) {
        intervalValue = secs / 86400;
        intervalUnit = "days";
      } else {
        intervalValue = Math.round(secs / 3600);
        intervalUnit = "hours";
      }
    }

    const hasToggles = Object.keys(envToggles).length > 0;

    return {
      patch,
      envToggles,
      triggerType,
      intervalValue,
      intervalUnit,
      approvalNotes: s.approvalNotes ?? "",
      notesOpen: false,
      monitored: s.monitored ?? false,
      effectsOpen:
        hasToggles || !!patch.condition || (patch.savedGroups?.length ?? 0) > 0,
    };
  });
}

const FeatureRolloutModal: FC<Props> = ({
  feature,
  version,
  existing,
  onClose,
  onSuccess,
}) => {
  const { apiCall } = useAuth();
  const { datasources } = useDefinitions();
  const settings = useOrgSettings();
  const attributeSchema = useAttributeSchema(false, feature.project);
  const environments = useEnvironments();

  const hashAttributes = useMemo(
    () => attributeSchema.filter((s) => s.hashAttribute),
    [attributeSchema],
  );
  const defaultHashAttr = hashAttributes[0]?.property ?? "";

  const prodLikeEnvs = useMemo(
    () => environments.filter((e) => !isEnvironmentDevLike(e.id)),
    [environments],
  );

  const allEnvIds = useMemo(
    () => environments.map((e) => e.id),
    [environments],
  );

  const featureIsOff = useMemo(() => {
    return !Object.values(feature.environmentSettings || {}).some(
      (s) => s.enabled,
    );
  }, [feature.environmentSettings]);

  const onlyDevLikeOn = useMemo(() => {
    const enabledIds = Object.entries(feature.environmentSettings || {})
      .filter(([, s]) => s.enabled)
      .map(([id]) => id);
    return enabledIds.length > 0 && enabledIds.every(isEnvironmentDevLike);
  }, [feature.environmentSettings]);

  const isDraft = featureIsOff || onlyDevLikeOn;

  // Form state — hydrate from existing rollout action if editing
  const [hashAttribute, setHashAttribute] = useState(
    existing?.gateConfig?.hashAttribute ?? defaultHashAttr,
  );
  const hasMonitoring = !!existing?.monitoringConfig;
  const [monitored, setMonitored] = useState(existing ? hasMonitoring : true);
  const [datasourceId, setDatasourceId] = useState(
    existing?.monitoringConfig?.datasourceId ??
      settings.defaultDataSource ??
      "",
  );
  const [exposureQueryId, setExposureQueryId] = useState(
    existing?.monitoringConfig?.exposureQueryId ?? "",
  );
  const [guardrailMetricIds, setGuardrailMetricIds] = useState<string[]>(
    existing?.monitoringConfig?.guardrailMetricIds ?? [],
  );
  const [lockdownMode, setLockdownMode] = useState<LockdownMode>(
    existing?.lockdownConfig?.mode ?? "locked",
  );
  const [steps, setSteps] = useState<RolloutStep[]>(() => {
    if (existing?.steps?.length) return hydrateSteps(existing.steps);
    const disabledProdEnvIds = prodLikeEnvs
      .filter((e) => !feature.environmentSettings?.[e.id]?.enabled)
      .map((e) => e.id);
    return defaultSteps(true, disabledProdEnvIds);
  });
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);

  const dataSource = datasources?.find((ds) => ds.id === datasourceId);
  const exposureQueries = dataSource?.settings?.queries?.exposure || [];

  const canSubmit =
    hashAttribute &&
    steps.length > 0 &&
    (!monitored ||
      (datasourceId && exposureQueryId && guardrailMetricIds.length > 0));

  // Active gate fields across all step patches
  const activeGateFields = useMemo<Set<GateField>>(() => {
    const fields = new Set<GateField>();
    for (const s of steps) {
      if (s.patch.condition !== undefined) fields.add("condition");
      if (s.patch.savedGroups !== undefined) fields.add("savedGroups");
    }
    return fields;
  }, [steps]);

  const hasAdditionalEffects =
    activeGateFields.size > 0 ||
    steps.some((s) => Object.keys(s.envToggles).length > 0);

  function updateStep(i: number, update: Partial<RolloutStep>) {
    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...update } : s)));
  }

  function updateStepPatch(i: number, field: string, value: unknown) {
    setSteps((prev) =>
      prev.map((s, j) => {
        if (j !== i) return s;
        const patch = { ...s.patch };
        if (value === undefined) {
          delete (patch as Record<string, unknown>)[field];
        } else {
          (patch as Record<string, unknown>)[field] = value;
        }
        return { ...s, patch };
      }),
    );
  }

  function cycleStepEnv(i: number, envId: string) {
    setSteps((prev) =>
      prev.map((s, j) => {
        if (j !== i) return s;
        const cur = s.envToggles[envId];
        const next = { ...s.envToggles };
        if (cur === undefined) {
          next[envId] = true;
        } else if (cur === true) {
          next[envId] = false;
        } else {
          delete next[envId];
        }
        return { ...s, envToggles: next };
      }),
    );
  }

  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, j) => j !== i));
  }

  function addStep() {
    const lastCoverage =
      steps.length > 0 ? (steps[steps.length - 1].patch.coverage ?? 0) : 0;
    const next = Math.min(lastCoverage + 25, 100);
    setSteps((prev) => [
      ...prev,
      {
        patch: { coverage: next },
        envToggles: {},
        triggerType: "interval",
        intervalValue: 1,
        intervalUnit: "days",
        approvalNotes: "",
        notesOpen: false,
        monitored,
        effectsOpen: false,
      },
    ]);
  }

  function addStepAfter(i: number) {
    const curr = steps[i].patch.coverage ?? 0;
    const nextCov = steps[i + 1]?.patch.coverage;
    const cov =
      nextCov != null
        ? Math.round((curr + nextCov) / 2)
        : Math.min(curr + 25, 100);
    setSteps((prev) => [
      ...prev.slice(0, i + 1),
      {
        patch: { coverage: cov },
        envToggles: {},
        triggerType: "interval",
        intervalValue: 1,
        intervalUnit: "days",
        approvalNotes: "",
        notesOpen: false,
        monitored,
        effectsOpen: false,
      },
      ...prev.slice(i + 1),
    ]);
  }

  async function handleSubmit() {
    if (!hashAttribute) throw new Error("Hash attribute is required");
    if (monitored && !datasourceId)
      throw new Error("Data source is required for monitored rollouts");
    if (monitored && !exposureQueryId)
      throw new Error("Exposure query is required for monitored rollouts");
    if (monitored && guardrailMetricIds.length === 0)
      throw new Error("At least one guardrail metric is required");

    const gateConfig = {
      seed: feature.id,
      hashAttribute,
      hashVersion: 2,
      coverage: 0,
      condition: null,
    };

    const monitoringConfig = monitored
      ? { datasourceId, exposureQueryId, guardrailMetricIds }
      : undefined;

    const lockdownConfig =
      lockdownMode !== "none" ? { mode: lockdownMode } : undefined;

    const apiSteps = steps.map((s) => {
      const actions: Record<string, unknown>[] = [];

      // set-gate action for coverage + targeting changes
      const gatePatch: Record<string, unknown> = {};
      if (s.patch.coverage !== undefined)
        gatePatch.coverage = s.patch.coverage / 100;
      if (s.patch.condition !== undefined)
        gatePatch.condition = s.patch.condition;
      if (s.patch.savedGroups !== undefined)
        gatePatch.savedGroups = s.patch.savedGroups;
      if (Object.keys(gatePatch).length > 0) {
        actions.push({ type: "set-gate", patch: gatePatch });
      }

      // set-environment-enabled actions
      for (const [envId, enabled] of Object.entries(s.envToggles)) {
        actions.push({
          type: "set-environment-enabled",
          environment: envId,
          enabled,
        });
      }

      return {
        trigger:
          s.triggerType === "interval"
            ? {
                type: "interval" as const,
                seconds: s.intervalValue * UNIT_SECONDS[s.intervalUnit],
              }
            : { type: "approval" as const },
        actions,
        monitored: s.monitored || undefined,
        ...(s.triggerType === "approval" && s.approvalNotes
          ? { approvalNotes: s.approvalNotes }
          : {}),
      };
    });

    const res = await apiCall<{ version: number }>(
      `/feature/${feature.id}/${version}/rollout`,
      {
        method: "PUT",
        body: JSON.stringify({
          gateConfig,
          monitoringConfig,
          lockdownConfig,
          steps: apiSteps,
        }),
      },
    );

    await onSuccess(res.version);
  }

  // ── Sub-row renderer for gate targeting + env toggles ─────────────────────

  function renderEffectsSubRows(step: RolloutStep, stepIndex: number) {
    if (!step.effectsOpen) return null;

    const subRowIndent = COL.num + 16;
    const unusedFields = (["condition", "savedGroups"] as GateField[]).filter(
      (f) => step.patch[f] === undefined,
    );

    return (
      <Box pb="3" style={{ paddingLeft: subRowIndent }}>
        <Flex
          direction="column"
          gap="5"
          pt="2"
          pb="3"
          px="2"
          className="bg-highlight rounded"
        >
          <Flex wrap="wrap" gap="3" align="start" justify="between">
            <Flex as="div" align="center" gap="1">
              <Text weight="medium" color="text-mid">
                Additional effects
              </Text>
              <Tooltip
                tipPosition="top"
                body="Effects are applied incrementally. Each change made in this step remains in effect until overridden in a future step."
              >
                <PiInfo style={{ color: "var(--accent-11)" }} />
              </Tooltip>
            </Flex>

            <Flex wrap="wrap" gap="5" align="start">
              {unusedFields.map((f) => (
                <Link
                  key={f}
                  size="1"
                  onClick={() =>
                    updateStepPatch(stepIndex, f, GATE_FIELD_DEFAULTS[f])
                  }
                >
                  <PiPlusBold
                    style={{ marginRight: 3, verticalAlign: "middle" }}
                  />
                  {GATE_FIELD_LABELS[f]}
                </Link>
              ))}
              {Object.keys(step.envToggles).length === 0 && (
                <Link
                  size="1"
                  onClick={() => {
                    const firstProd = prodLikeEnvs[0]?.id;
                    if (firstProd) cycleStepEnv(stepIndex, firstProd);
                  }}
                >
                  <PiPlusBold
                    style={{ marginRight: 3, verticalAlign: "middle" }}
                  />
                  Toggle environments
                </Link>
              )}
            </Flex>
          </Flex>

          {/* Environment toggles */}
          {Object.keys(step.envToggles).length > 0 && (
            <Box>
              <Flex align="center" justify="between" mb="1">
                <Text as="div" size="small" weight="semibold" color="text-mid">
                  Toggle environments at this step
                </Text>
                <Link
                  size="1"
                  color="red"
                  onClick={() => updateStep(stepIndex, { envToggles: {} })}
                >
                  Remove effect
                </Link>
              </Flex>
              <Flex wrap="wrap" gap="3">
                {allEnvIds.map((envId) => {
                  const val = step.envToggles[envId];
                  return (
                    <Flex
                      key={envId}
                      align="center"
                      gap="1"
                      style={{ cursor: "pointer", userSelect: "none" }}
                      onClick={() => cycleStepEnv(stepIndex, envId)}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background:
                            val === true
                              ? "var(--green-9)"
                              : val === false
                                ? "var(--red-9)"
                                : "var(--gray-6)",
                          border:
                            val === undefined
                              ? "1px dashed var(--gray-8)"
                              : "none",
                        }}
                      />
                      <Text
                        size="small"
                        color={val === undefined ? "text-low" : "text-mid"}
                      >
                        {envId}
                        {val === true ? " ON" : val === false ? " OFF" : ""}
                      </Text>
                    </Flex>
                  );
                })}
              </Flex>
              <Text size="small" color="text-low" mt="1">
                Click to cycle: ON → OFF → skip
              </Text>
            </Box>
          )}

          {/* Condition targeting */}
          {"condition" in step.patch && (
            <Box>
              <ConditionInput
                key={`${stepIndex}-condition`}
                defaultValue={step.patch.condition ?? "{}"}
                onChange={(v) => updateStepPatch(stepIndex, "condition", v)}
                project={feature.project ?? ""}
                slimMode
                emptyText="No targeting applied. Clears any existing targeting."
                labelActions={
                  <Link
                    size="1"
                    color="red"
                    onClick={() =>
                      updateStepPatch(stepIndex, "condition", undefined)
                    }
                  >
                    Remove effect
                  </Link>
                }
              />
            </Box>
          )}

          {/* Saved group targeting */}
          {"savedGroups" in step.patch && (
            <Box>
              <SavedGroupTargetingField
                value={step.patch.savedGroups ?? []}
                setValue={(v) => updateStepPatch(stepIndex, "savedGroups", v)}
                project={feature.project ?? ""}
                slimMode
                emptyText="No targeting applied. Clears any existing targeting."
                labelActions={
                  <Link
                    size="1"
                    color="red"
                    onClick={() =>
                      updateStepPatch(stepIndex, "savedGroups", undefined)
                    }
                  >
                    Remove effect
                  </Link>
                }
              />
            </Box>
          )}
        </Flex>
      </Box>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Modal
      trackingEventModalType="plan-feature-rollout"
      open
      close={onClose}
      header={existing ? "Edit Feature Rollout" : "Plan Feature Rollout"}
      submit={handleSubmit}
      cta={existing ? "Update Rollout" : "Create Rollout"}
      ctaEnabled={!!canSubmit}
      size="lg"
      useRadixButton
    >
      {!isDraft && (
        <Callout status="warning" mb="4">
          This feature is already enabled in one or more production-like
          environments. Feature rollouts work best when starting from a draft
          (all off) state.
        </Callout>
      )}

      <Heading as="h4" size="small" mb="3">
        Bucketing
      </Heading>

      <SelectField
        label="Hash attribute"
        options={
          hashAttributes.length > 0
            ? hashAttributes.map((s) => ({
                label: s.property,
                value: s.property,
              }))
            : attributeSchema.map((s) => ({
                label: s.property,
                value: s.property,
              }))
        }
        value={hashAttribute}
        onChange={setHashAttribute}
        required
        placeholder="Select a hash attribute"
      />

      {prodLikeEnvs.length > 0 && (
        <Text size="small" color="text-mid" mb="3" as="div">
          The rollout gate will apply to all environments. Traffic is controlled
          via coverage percentage.
        </Text>
      )}

      <Separator size="4" my="5" />

      <Heading as="h4" size="small" mb="3">
        Monitoring
      </Heading>

      <RadioGroup
        mb="3"
        gap="2"
        options={[
          {
            value: "monitored",
            label: "Safe rollout with monitoring",
            description:
              "Automatically monitor guardrail metrics at each step and roll back if thresholds are breached",
          },
          {
            value: "unmonitored",
            label: "Ramp-up only",
            description:
              "Increase coverage over time without automatic metric monitoring",
          },
        ]}
        value={monitored ? "monitored" : "unmonitored"}
        setValue={(v) => {
          const m = v === "monitored";
          setMonitored(m);
          setSteps((prev) => prev.map((s) => ({ ...s, monitored: m })));
        }}
      />

      {monitored && (
        <Box className="bg-highlight rounded p-3" mb="3">
          <SelectField
            label="Data source"
            options={datasources.map((d) => ({
              value: d.id,
              label: `${d.name}${d.description ? ` — ${d.description}` : ""}${d.id === settings.defaultDataSource ? " (default)" : ""}`,
            }))}
            value={datasourceId}
            onChange={setDatasourceId}
            required
            placeholder="Select a data source"
          />
          {datasources.length === 0 && (
            <Callout status="warning" mb="3">
              No data sources configured. Add one in Settings before using
              monitored rollouts.
            </Callout>
          )}

          <SelectField
            label="Experiment assignment table"
            options={exposureQueries.map((q) => ({
              label: q.name,
              value: q.id,
            }))}
            required
            disabled={!datasourceId}
            value={exposureQueryId}
            onChange={setExposureQueryId}
          />

          <Box mb="2">
            <Text as="label" size="medium" weight="medium">
              Guardrail metrics
              <Text size="small" as="div" weight="regular" color="text-mid">
                Metrics to monitor during the rollout
              </Text>
            </Text>
            <MetricsSelector
              datasource={datasourceId}
              exposureQueryId={exposureQueryId}
              project={feature.project}
              includeFacts
              forceSingleMetric={false}
              includeGroups
              excludeQuantiles
              selected={guardrailMetricIds}
              disabled={!exposureQueryId}
              onChange={setGuardrailMetricIds}
            />
          </Box>
        </Box>
      )}

      <Separator size="4" my="5" />

      <Heading as="h4" size="small" mb="3">
        Steps
      </Heading>

      {steps.some(
        (s) =>
          s.triggerType === "interval" &&
          Math.max(1, s.intervalValue) * UNIT_SECONDS[s.intervalUnit] <
            POLL_INTERVAL_SECONDS,
      ) && (
        <Callout status="warning" mb="3">
          One or more steps are shorter than the minimum check interval (1 min).
          Short steps may be applied together rather than at their exact
          scheduled times.
        </Callout>
      )}

      <Box>
        {/* Header row */}
        <Flex
          align="center"
          gap="4"
          pb="1"
          style={{ borderBottom: "1px solid var(--gray-a6)" }}
        >
          <ColHeader width={COL.num}>Step</ColHeader>
          <ColHeader width={COL.coverage}>Rollout %</ColHeader>
          <ColHeader width={COL.trigger}>Action</ColHeader>
          <Box flexGrow="1" />
        </Flex>

        {steps.map((step, i) => (
          <div
            key={i}
            style={
              hasAdditionalEffects
                ? { borderBottom: "1px solid var(--gray-a6)" }
                : {}
            }
          >
            {/* Main grid row */}
            <Flex align="center" gap="4" py="2">
              {/* Step number */}
              <Box style={{ width: COL.num, flexShrink: 0 }} pl="1">
                <Flex align="center" gap="1">
                  <Text size="small" color="text-low">
                    {i + 1}
                  </Text>
                  {step.monitored && (
                    <Tooltip body="Monitored step — guardrail metrics are evaluated">
                      <PiShieldCheckBold
                        size={12}
                        style={{ color: "var(--blue-9)" }}
                      />
                    </Tooltip>
                  )}
                </Flex>
              </Box>

              {/* Coverage */}
              <Box style={{ width: COL.coverage, flexShrink: 0 }}>
                <div className={`position-relative ${styles.percentInputWrap}`}>
                  <Field
                    style={{ width: COL.coverage, minHeight: 38 }}
                    type="number"
                    min="0"
                    max="100"
                    onFocus={(e) => e.target.select()}
                    value={String(step.patch.coverage ?? 0)}
                    onChange={(e) =>
                      updateStepPatch(
                        i,
                        "coverage",
                        parseInt(e.target.value) || 0,
                      )
                    }
                    onBlur={(e) =>
                      updateStepPatch(
                        i,
                        "coverage",
                        Math.min(
                          100,
                          Math.max(0, parseInt(e.target.value) || 0),
                        ),
                      )
                    }
                  />
                  <span>%</span>
                </div>
              </Box>

              {/* Hold / Approval */}
              <Flex
                align="center"
                gap="2"
                style={
                  step.triggerType === "approval"
                    ? { flex: 1, minWidth: COL.trigger }
                    : { width: COL.trigger + COL.duration, flexShrink: 0 }
                }
              >
                <Box style={{ width: COL.trigger, flexShrink: 0 }}>
                  <SelectField
                    value={step.triggerType}
                    options={[
                      {
                        value: "interval",
                        label: "Hold",
                        tooltip:
                          "Apply this step's effects, then hold for the interval before advancing",
                      },
                      {
                        value: "approval",
                        label: "Approval",
                        tooltip:
                          "Apply this step's effects, then hold for manual approval before advancing",
                      },
                    ]}
                    onChange={(v) =>
                      updateStep(i, {
                        triggerType: v as "interval" | "approval",
                      })
                    }
                    containerClassName="mb-0"
                    containerStyle={{ minHeight: 38 }}
                    useMultilineLabels
                    formatOptionLabel={(option, meta) => {
                      if (meta.context === "value") return <>{option.label}</>;
                      return (
                        <div>
                          <div>{option.label}</div>
                          {option.tooltip && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--color-text-low)",
                                marginTop: 1,
                              }}
                            >
                              {option.tooltip}
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                </Box>
                {step.triggerType === "interval" && (
                  <>
                    <Field
                      style={{ minHeight: 38 }}
                      type="number"
                      min="1"
                      onFocus={(e) => e.target.select()}
                      value={String(step.intervalValue)}
                      onChange={(e) =>
                        updateStep(i, {
                          intervalValue: parseInt(e.target.value) || 0,
                        })
                      }
                      onBlur={(e) =>
                        updateStep(i, {
                          intervalValue: Math.max(
                            1,
                            parseInt(e.target.value) || 1,
                          ),
                        })
                      }
                      containerStyle={{ width: 75, flexShrink: 0 }}
                    />
                    <Box style={{ flex: 1 }}>
                      <SelectField
                        value={step.intervalUnit}
                        options={[
                          { value: "hours", label: "hours" },
                          { value: "days", label: "days" },
                        ]}
                        onChange={(v) =>
                          updateStep(i, { intervalUnit: v as IntervalUnit })
                        }
                        containerClassName="mb-0"
                        containerStyle={{ minHeight: 38 }}
                      />
                    </Box>
                  </>
                )}
                {step.triggerType === "approval" && (
                  <Flex align="center" gap="2" style={{ flex: 1, minWidth: 0 }}>
                    {!step.notesOpen ? (
                      <Link
                        size="1"
                        ml="1"
                        color="gray"
                        style={{ flexShrink: 0 }}
                        onClick={() =>
                          updateStep(i, { notesOpen: true, approvalNotes: "" })
                        }
                      >
                        <PiPlusBold
                          style={{ marginRight: 3, verticalAlign: "middle" }}
                        />
                        Add approval notes
                      </Link>
                    ) : (
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Field
                          label=""
                          placeholder="ex: Check error rates"
                          value={step.approvalNotes}
                          onChange={(e) =>
                            updateStep(i, { approvalNotes: e.target.value })
                          }
                          containerClassName="mb-0"
                          style={{ minHeight: 38 }}
                        />
                      </Box>
                    )}
                  </Flex>
                )}
              </Flex>

              {step.triggerType !== "approval" && <Box flexGrow="1" />}

              {/* Three-dot menu */}
              <DropdownMenu
                open={openMenuIndex === i}
                onOpenChange={(o) => setOpenMenuIndex(o ? i : null)}
                trigger={
                  <IconButton
                    type="button"
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="2"
                    highContrast
                  >
                    <BsThreeDotsVertical size={18} />
                  </IconButton>
                }
                variant="soft"
                menuPlacement="end"
              >
                {!step.effectsOpen ? (
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => {
                        setOpenMenuIndex(null);
                        updateStep(i, { effectsOpen: true });
                      }}
                    >
                      Add additional effects
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                ) : null}
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => {
                      setOpenMenuIndex(null);
                      updateStep(i, { monitored: !step.monitored });
                    }}
                  >
                    {step.monitored
                      ? "Disable monitoring"
                      : "Enable monitoring"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setOpenMenuIndex(null);
                      addStepAfter(i);
                    }}
                  >
                    Add step after
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                {steps.length > 1 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        color="red"
                        onClick={() => {
                          setOpenMenuIndex(null);
                          removeStep(i);
                        }}
                      >
                        Remove step
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </>
                ) : null}
              </DropdownMenu>
            </Flex>

            {/* Effects sub-rows */}
            {renderEffectsSubRows(step, i)}
          </div>
        ))}

        <Box py="1">
          <Link size="2" onClick={addStep}>
            <PiPlusBold style={{ marginRight: 3, verticalAlign: "middle" }} />
            Add step
          </Link>
        </Box>
      </Box>

      <Separator size="4" my="5" />

      <Checkbox
        size="lg"
        label="Lock down feature during rollout"
        description="Prevent edits to this feature while the rollout is active. Admins can always override."
        value={lockdownMode === "locked"}
        setValue={(v) => setLockdownMode(v ? "locked" : "none")}
      />
    </Modal>
  );
};

export default FeatureRolloutModal;
