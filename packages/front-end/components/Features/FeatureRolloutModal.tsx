import React, { FC, useMemo, useState } from "react";
import {
  Box,
  Flex,
  IconButton,
  Separator,
  TextField,
  // eslint-disable-next-line no-restricted-imports
  Checkbox as RadixCheckbox,
  // eslint-disable-next-line no-restricted-imports
  Text as RadixText,
} from "@radix-ui/themes";
import { PiPlusBold, PiShieldCheckBold } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { RiAlertLine } from "react-icons/ri";
import type {
  FeatureInterface,
  SavedGroupTargeting,
} from "shared/types/feature";
import {
  RevisionRampCreateFeatureRolloutAction,
  RampStep,
  GateRule,
} from "shared/validators";
import { isEnvironmentDevLike } from "shared/util";
import Badge from "@/ui/Badge";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import RadioGroup from "@/ui/RadioGroup";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";

import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import RuleEnvironmentScopeField from "@/components/Features/RuleModal/EnvironmentScopeField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
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

type LockdownMode = "none" | "locked";

interface Props {
  feature: FeatureInterface;
  version: number | "new";
  existing?: RevisionRampCreateFeatureRolloutAction | null;
  onClose: () => void;
  onSuccess: (version: number) => Promise<unknown>;
}

type IntervalUnit = "hours" | "days";

let _ruleIdCounter = 0;
function nextRuleId(): string {
  return `sr_${++_ruleIdCounter}`;
}

// A gate rule within a step: coverage + optional targeting, scoped to environments.
interface StepRule {
  id: string;
  monitored: boolean;
  allEnvironments: boolean;
  envIds: string[];
  coverage: number; // 0–100 in UI, converted to 0–1 on submit
  condition?: string;
  savedGroups?: SavedGroupTargeting[];
  expanded?: boolean; // UI state: show targeting editors
}

interface RolloutStep {
  toggles: Record<string, boolean>; // envId → enable/disable
  togglesExpanded: boolean; // UI state: show toggle checkboxes
  rules: StepRule[];
  triggerType: "interval" | "approval";
  intervalValue: number;
  intervalUnit: IntervalUnit;
  approvalNotes: string;
  notesOpen: boolean;
  monitored: boolean;
}

const UNIT_SECONDS: Record<IntervalUnit, number> = {
  hours: 3600,
  days: 86400,
};

type RuleVisualState = "monitored" | "bypass" | "default" | "unreachable";

function ruleColor(state: RuleVisualState): string {
  switch (state) {
    case "monitored":
      return "var(--blue-9)";
    case "bypass":
      return "var(--accent-9)";
    case "unreachable":
      return "var(--orange-7)";
    case "default":
      return "var(--gray-7)";
  }
}

function isRuleUnreachable(rules: StepRule[], ruleIdx: number): boolean {
  if (ruleIdx === 0) return false;
  for (let k = 0; k < ruleIdx; k++) {
    const above = rules[k];
    if (above.coverage < 100) continue;
    if (above.condition && above.condition !== "{}") continue;
    if (above.savedGroups && above.savedGroups.length > 0) continue;
    const current = rules[ruleIdx];
    if (above.allEnvironments) return true;
    if (current.allEnvironments) continue;
    if (current.envIds.every((e) => above.envIds.includes(e))) return true;
  }
  return false;
}

function deriveRuleState(
  rules: StepRule[],
  ruleIdx: number,
  stepMonitored: boolean,
): RuleVisualState {
  if (isRuleUnreachable(rules, ruleIdx)) return "unreachable";
  const isLast = ruleIdx === rules.length - 1;
  if (isLast && stepMonitored) return "monitored";
  if (!isLast && stepMonitored) return "bypass";
  return "default";
}

const POLL_INTERVAL_SECONDS = 60;

function defaultSteps(
  monitored: boolean,
  prodLikeEnvIds: string[] = [],
): RolloutStep[] {
  const coverages = [10, 25, 50, 100];
  const togglesOnFirst: Record<string, boolean> = {};
  for (const id of prodLikeEnvIds) togglesOnFirst[id] = true;

  return coverages.map((cov, i) => ({
    toggles: i === 0 ? { ...togglesOnFirst } : {},
    togglesExpanded: i === 0,
    rules: [
      prodLikeEnvIds.length > 0
        ? {
            id: nextRuleId(),
            monitored: true,
            allEnvironments: false,
            envIds: [...prodLikeEnvIds],
            coverage: cov,
          }
        : {
            id: nextRuleId(),
            monitored: true,
            allEnvironments: true,
            envIds: [],
            coverage: cov,
          },
    ],
    triggerType: "interval",
    intervalValue: 1,
    intervalUnit: "days",
    approvalNotes: "",
    notesOpen: false,
    monitored,
  }));
}

function hydrateSteps(
  stored: RampStep[],
  existingGateRules?: GateRule[],
): RolloutStep[] {
  return stored.map((s, idx) => {
    const toggles: Record<string, boolean> = {};
    const rules: StepRule[] = [];

    for (const action of s.actions) {
      if (action.type === "set-gate") {
        const gateRule = existingGateRules?.find((r) => r.id === action.ruleId);
        const envIds = gateRule?.environments ?? [];
        const isAll = envIds.length === 0 && !gateRule;
        rules.push({
          id: nextRuleId(),
          monitored: gateRule?.type !== "bypass",
          allEnvironments: isAll,
          envIds: [...envIds],
          coverage:
            action.patch.coverage !== undefined
              ? Math.round(action.patch.coverage * 100)
              : 0,
          condition: action.patch.condition ?? undefined,
          savedGroups: action.patch.savedGroups ?? undefined,
        });
      } else if (action.type === "set-environment-enabled") {
        toggles[action.environment] = action.enabled;
      }
    }

    if (rules.length === 0) {
      rules.push({
        id: nextRuleId(),
        monitored: true,
        allEnvironments: true,
        envIds: [],
        coverage: 0,
      });
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

    return {
      toggles,
      togglesExpanded: idx === 0 || Object.keys(toggles).length > 0,
      rules,
      triggerType,
      intervalValue,
      intervalUnit,
      approvalNotes: s.approvalNotes ?? "",
      notesOpen: false,
      monitored: s.monitored ?? false,
    };
  });
}

function GateRuleCard({
  state,
  label,
  labelColor,
  children,
}: {
  state: RuleVisualState;
  label?: string | null;
  labelColor?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      style={{
        position: "relative",
        border: "1px solid var(--gray-a5)",
        borderRadius: "var(--radius-2)",
        width: "100%",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          borderRadius: "var(--radius-2) 0 0 var(--radius-2)",
          backgroundColor: ruleColor(state),
        }}
      />
      {label && (
        <span
          style={{
            position: "absolute",
            top: -12,
            left: 8,
            fontSize: 10,
            fontWeight: 600,
            lineHeight: "16px",
            padding: "1px 6px",
            borderRadius: 4,
            backgroundColor: "var(--color-panel-solid)",
            border: `1px solid ${labelColor ?? ruleColor(state)}`,
            color: labelColor ?? ruleColor(state),
            letterSpacing: "0.03em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
      )}
      <Flex align="start" gap="2" py="3" px="4">
        {children}
      </Flex>
    </Box>
  );
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
  const [monitoredEnvIds, setMonitoredEnvIds] = useState<string[]>(
    existing?.monitoringConfig?.monitoredEnvironments ?? [],
  );
  const [allMonitoredEnvs, setAllMonitoredEnvs] = useState(
    !existing?.monitoringConfig?.monitoredEnvironments?.length,
  );
  const [lockdownMode, setLockdownMode] = useState<LockdownMode>(
    existing?.lockdownConfig?.mode ?? "locked",
  );
  const [steps, setSteps] = useState<RolloutStep[]>(() => {
    if (existing?.steps?.length)
      return hydrateSteps(existing.steps, existing.gateConfig?.rules);
    const disabledProdEnvIds = prodLikeEnvs
      .filter((e) => !feature.environmentSettings?.[e.id]?.enabled)
      .map((e) => e.id);
    return defaultSteps(true, disabledProdEnvIds);
  });
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  const [openRuleMenu, setOpenRuleMenu] = useState<string | null>(null);

  const dataSource = datasources?.find((ds) => ds.id === datasourceId);
  const exposureQueries = dataSource?.settings?.queries?.exposure || [];

  const canSubmit =
    hashAttribute &&
    steps.length > 0 &&
    (!monitored ||
      (datasourceId && exposureQueryId && guardrailMetricIds.length > 0));

  function updateStep(i: number, update: Partial<RolloutStep>) {
    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...update } : s)));
  }

  function updateRule(
    stepIdx: number,
    ruleIdx: number,
    update: Partial<StepRule>,
  ) {
    setSteps((prev) => {
      const updated = prev.map((s, j) => {
        if (j !== stepIdx) return s;
        const rules = s.rules.map((r, k) => {
          if (k !== ruleIdx) return r;
          return { ...r, ...update };
        });
        return { ...s, rules };
      });

      if ("envIds" in update || "allEnvironments" in update) {
        const alreadyToggled = new Set<string>();
        for (let k = 0; k < stepIdx; k++) {
          for (const [envId, val] of Object.entries(updated[k].toggles)) {
            if (val) alreadyToggled.add(envId);
          }
        }

        const step = updated[stepIdx];
        const neededByRules = new Set<string>();
        for (const r of step.rules) {
          if (r.allEnvironments) {
            allEnvIds.forEach((id) => neededByRules.add(id));
          } else {
            r.envIds.forEach((id) => neededByRules.add(id));
          }
        }

        const toggles: Record<string, boolean> = {};
        for (const envId of neededByRules) {
          if (!alreadyToggled.has(envId)) {
            toggles[envId] = step.toggles[envId] ?? true;
          }
        }

        updated[stepIdx] = {
          ...step,
          toggles,
          togglesExpanded:
            step.togglesExpanded || Object.keys(toggles).length > 0,
        };
      }

      return updated;
    });
  }

  function removeRule(stepIdx: number, ruleIdx: number) {
    setSteps((prev) =>
      prev.map((s, j) => {
        if (j !== stepIdx) return s;
        return { ...s, rules: s.rules.filter((_, k) => k !== ruleIdx) };
      }),
    );
  }

  function insertRuleAt(stepIdx: number, atIdx: number) {
    setSteps((prev) =>
      prev.map((s, j) => {
        if (j !== stepIdx) return s;
        const newRule: StepRule = {
          id: nextRuleId(),
          monitored: false,
          allEnvironments: true,
          envIds: [],
          coverage: 100,
        };
        const updated = [...s.rules];
        updated.splice(atIdx, 0, newRule);
        return { ...s, rules: updated };
      }),
    );
  }

  function setToggle(stepIdx: number, envId: string, value?: boolean) {
    setSteps((prev) =>
      prev.map((s, j) => {
        if (j !== stepIdx) return s;
        const toggles = { ...s.toggles };
        if (value === undefined) {
          delete toggles[envId];
        } else {
          toggles[envId] = value;
        }
        return { ...s, toggles };
      }),
    );
  }

  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, j) => j !== i));
  }

  function addStep() {
    const lastStep = steps[steps.length - 1];
    const rules: StepRule[] = lastStep
      ? lastStep.rules.map((r) => ({
          ...r,
          envIds: [...r.envIds],
          coverage: Math.min(r.coverage + 25, 100),
        }))
      : [
          {
            id: nextRuleId(),
            monitored: true,
            allEnvironments: true,
            envIds: [],
            coverage: 100,
          },
        ];
    setSteps((prev) => [
      ...prev,
      {
        toggles: {},
        togglesExpanded: false,
        rules,
        triggerType: "interval",
        intervalValue: 1,
        intervalUnit: "days",
        approvalNotes: "",
        notesOpen: false,
        monitored,
      },
    ]);
  }

  function addStepAfter(i: number) {
    const curr = steps[i];
    const next = steps[i + 1];
    const rules: StepRule[] = curr.rules.map((r, ri) => {
      const nextRule = next?.rules[ri];
      const cov = nextRule
        ? Math.round((r.coverage + nextRule.coverage) / 2)
        : Math.min(r.coverage + 25, 100);
      return { ...r, envIds: [...r.envIds], coverage: cov };
    });
    setSteps((prev) => [
      ...prev.slice(0, i + 1),
      {
        toggles: {},
        togglesExpanded: false,
        rules,
        triggerType: "interval",
        intervalValue: 1,
        intervalUnit: "days",
        approvalNotes: "",
        notesOpen: false,
        monitored,
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

    // Build gate rules from all step rules. Each unique set of envIds
    // becomes a gate rule. Rules scoped to "all" get an empty environments array.
    const gateRules: GateRule[] = [];
    const ruleKeyToId = new Map<string, string>();
    for (const s of steps) {
      for (let ri = 0; ri < s.rules.length; ri++) {
        const r = s.rules[ri];
        const isMonitoredRule = ri === s.rules.length - 1 && s.monitored;
        const key = r.allEnvironments
          ? "__all__"
          : [...r.envIds].sort().join(",");
        if (!ruleKeyToId.has(key)) {
          const ruleId = `rollout-${key}`;
          ruleKeyToId.set(key, ruleId);
          gateRules.push({
            id: ruleId,
            type: isMonitoredRule ? "rollout" : "bypass",
            environments: r.allEnvironments ? [] : r.envIds,
            coverage: 0,
          });
        }
      }
    }
    const gateConfig: Record<string, unknown> = {
      seed: feature.id,
      monitorSeed: `${feature.id}-monitor`,
      hashAttribute,
      hashVersion: 2,
      rules: gateRules,
    };

    const monitoringConfig = monitored
      ? {
          datasourceId,
          exposureQueryId,
          guardrailMetricIds,
          monitoredEnvironments:
            !allMonitoredEnvs && monitoredEnvIds.length > 0
              ? monitoredEnvIds
              : undefined,
        }
      : undefined;

    const lockdownConfig =
      lockdownMode !== "none" ? { mode: lockdownMode } : undefined;

    const apiSteps = steps.map((s) => {
      const actions: Record<string, unknown>[] = [];

      // Environment toggles
      for (const [envId, enabled] of Object.entries(s.toggles)) {
        actions.push({
          type: "set-environment-enabled",
          environment: envId,
          enabled,
        });
      }

      // Gate rule patches
      for (const rule of s.rules) {
        const key = rule.allEnvironments
          ? "__all__"
          : [...rule.envIds].sort().join(",");
        const ruleId = ruleKeyToId.get(key);
        if (!ruleId) continue;

        const gatePatch: Record<string, unknown> = {
          coverage: rule.coverage / 100,
        };
        if (rule.condition !== undefined) gatePatch.condition = rule.condition;
        if (rule.savedGroups !== undefined)
          gatePatch.savedGroups = rule.savedGroups;
        actions.push({ type: "set-gate", ruleId, patch: gatePatch });
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
      size="max"
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

      <Select
        label="Hash attribute"
        size="2"
        value={hashAttribute}
        setValue={setHashAttribute}
        placeholder="Select a hash attribute"
        mb="3"
      >
        {(hashAttributes.length > 0 ? hashAttributes : attributeSchema).map(
          (s) => (
            <SelectItem key={s.property} value={s.property}>
              {s.property}
            </SelectItem>
          ),
        )}
      </Select>

      {prodLikeEnvs.length > 0 && (
        <Text size="small" color="text-mid" mb="3" as="div">
          Configure per-environment coverage and targeting in each step below.
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
          <Select
            label="Data source"
            size="2"
            value={datasourceId}
            setValue={setDatasourceId}
            placeholder="Select a data source"
            mb="3"
          >
            {datasources.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
                {d.description ? ` — ${d.description}` : ""}
                {d.id === settings.defaultDataSource ? " (default)" : ""}
              </SelectItem>
            ))}
          </Select>
          {datasources.length === 0 && (
            <Callout status="warning" mb="3">
              No data sources configured. Add one in Settings before using
              monitored rollouts.
            </Callout>
          )}

          <Select
            label="Experiment assignment table"
            size="2"
            value={exposureQueryId}
            setValue={setExposureQueryId}
            disabled={!datasourceId}
            placeholder="Select assignment table"
            mb="3"
          >
            {exposureQueries.map((q) => (
              <SelectItem key={q.id} value={q.id}>
                {q.name}
              </SelectItem>
            ))}
          </Select>

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

          {environments.length > 1 && (
            <RuleEnvironmentScopeField
              environments={environments}
              allEnvironments={allMonitoredEnvs}
              setAllEnvironments={(v) => {
                setAllMonitoredEnvs(v);
                if (v) setMonitoredEnvIds([]);
              }}
              selectedEnvironments={monitoredEnvIds}
              setSelectedEnvironments={setMonitoredEnvIds}
              label="Monitored environments"
              mb="2"
            />
          )}
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

      <Table variant="surface" size="2">
        <TableHeader>
          <TableRow>
            <TableColumnHeader style={{ width: 60, textAlign: "center" }}>
              <Text size="small" weight="medium" color="text-low">
                STEP
              </Text>
            </TableColumnHeader>
            <TableColumnHeader>
              <Text size="small" weight="medium" color="text-low">
                APPLY EFFECT
              </Text>
            </TableColumnHeader>
            <TableColumnHeader style={{ width: 260 }}>
              <Text size="small" weight="medium" color="text-low">
                THEN
              </Text>
            </TableColumnHeader>
            <TableColumnHeader style={{ width: 50 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {steps.map((step, i) => (
            <TableRow key={i}>
              {/* STEP number */}
              <TableCell
                style={{
                  verticalAlign: "top",
                  paddingTop: 20,
                  paddingBottom: 20,
                  textAlign: "center",
                }}
              >
                <Flex
                  align="center"
                  justify="center"
                  style={{
                    width: 28,
                    height: 28,
                    margin: "0 auto",
                    borderRadius: "50%",
                    background: "var(--accent-3)",
                    color: "var(--accent-11)",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {i + 1}
                </Flex>
              </TableCell>

              {/* APPLY EFFECT */}
              <TableCell
                style={{
                  verticalAlign: "top",
                  paddingTop: 20,
                  paddingBottom: 20,
                }}
              >
                <Flex direction="column" gap="5">
                  {/* Gate rules */}
                  {step.rules.map((rule, ruleIdx) => {
                    const rState = deriveRuleState(
                      step.rules,
                      ruleIdx,
                      step.monitored,
                    );
                    const nativeState: RuleVisualState =
                      rState === "unreachable"
                        ? ruleIdx === step.rules.length - 1 && step.monitored
                          ? "monitored"
                          : !step.monitored
                            ? "default"
                            : "bypass"
                        : rState;
                    return (
                      <React.Fragment key={rule.id}>
                        <GateRuleCard
                          state={rState}
                          label={
                            nativeState === "monitored"
                              ? "Safe rollout"
                              : nativeState === "bypass"
                                ? "Unmonitored"
                                : null
                          }
                          labelColor={ruleColor(nativeState)}
                        >
                          <Flex
                            gap="3"
                            align="start"
                            style={{ flex: 1, minWidth: 0 }}
                          >
                            {/* Left: type + environment scope */}
                            <Box
                              style={{
                                width: 200,
                                flexShrink: 0,
                              }}
                            >
                              <MultiSelectField
                                value={rule.envIds}
                                onChange={(vals) =>
                                  updateRule(i, ruleIdx, {
                                    envIds: vals,
                                    allEnvironments: vals.length === 0,
                                  })
                                }
                                options={allEnvIds.map((id) => ({
                                  label: id,
                                  value: id,
                                }))}
                                placeholder="All environments"
                                sort={false}
                                showCopyButton={false}
                                containerClassName="mb-0"
                                customClassName="multiselect-unfixed"
                              />
                            </Box>

                            {/* Right: coverage + targeting */}
                            <Flex
                              direction="column"
                              gap="2"
                              style={{ flex: 1, minWidth: 0 }}
                            >
                              <Flex align="center" gap="3">
                                <Box
                                  style={{
                                    width: 240,
                                    flexShrink: 0,
                                    border: "1px solid var(--slate-a5)",
                                    borderRadius: 10,
                                    backgroundColor: "var(--slate-a3)",
                                    height: 14,
                                    overflow: "hidden",
                                  }}
                                >
                                  <Box
                                    style={{
                                      width: `${rule.coverage}%`,
                                      height: "100%",
                                      backgroundColor: ruleColor(nativeState),
                                    }}
                                  />
                                </Box>
                                <TextField.Root
                                  size="2"
                                  type="number"
                                  min="0"
                                  max="100"
                                  style={{ width: 60 }}
                                  onFocus={(e) => e.target.select()}
                                  value={String(rule.coverage)}
                                  onChange={(e) =>
                                    updateRule(i, ruleIdx, {
                                      coverage: parseInt(e.target.value) || 0,
                                    })
                                  }
                                  onBlur={(e) =>
                                    updateRule(i, ruleIdx, {
                                      coverage: Math.min(
                                        100,
                                        Math.max(
                                          0,
                                          parseInt(e.target.value) || 0,
                                        ),
                                      ),
                                    })
                                  }
                                >
                                  <TextField.Slot side="right">
                                    <span
                                      style={{
                                        color: "var(--color-text-low)",
                                        fontSize: "var(--font-size-1)",
                                      }}
                                    >
                                      %
                                    </span>
                                  </TextField.Slot>
                                </TextField.Root>
                                <Text size="small" color="text-low">
                                  of users
                                </Text>
                              </Flex>

                              {rule.expanded ? (
                                <Flex direction="column" gap="2">
                                  <ConditionInput
                                    defaultValue={rule.condition ?? "{}"}
                                    onChange={(v) =>
                                      updateRule(i, ruleIdx, {
                                        condition: v,
                                      })
                                    }
                                    project={feature.project ?? ""}
                                    slimMode
                                    emptyText="No targeting — all users"
                                  />
                                  <SavedGroupTargetingField
                                    value={rule.savedGroups ?? []}
                                    setValue={(v) =>
                                      updateRule(i, ruleIdx, {
                                        savedGroups: v,
                                      })
                                    }
                                    project={feature.project ?? ""}
                                    slimMode
                                  />
                                </Flex>
                              ) : (
                                <Link
                                  size="1"
                                  color="gray"
                                  onClick={() =>
                                    updateRule(i, ruleIdx, {
                                      expanded: true,
                                    })
                                  }
                                >
                                  <PiPlusBold
                                    size={9}
                                    style={{
                                      marginRight: 3,
                                      verticalAlign: "middle",
                                    }}
                                  />
                                  targeting
                                </Link>
                              )}
                            </Flex>
                          </Flex>

                          {rState === "unreachable" && (
                            <Badge
                              color="orange"
                              title="Rule not reachable"
                              mt="1"
                              label={
                                <>
                                  <RiAlertLine />
                                  Unreachable
                                </>
                              }
                            />
                          )}

                          {/* Rule menu */}
                          <DropdownMenu
                            open={openRuleMenu === rule.id}
                            onOpenChange={(o) =>
                              setOpenRuleMenu(o ? rule.id : null)
                            }
                            trigger={
                              <IconButton
                                type="button"
                                variant="ghost"
                                color="gray"
                                radius="full"
                                size="2"
                                highContrast
                                style={{
                                  flexShrink: 0,
                                }}
                              >
                                <BsThreeDotsVertical size={16} />
                              </IconButton>
                            }
                            variant="soft"
                            menuPlacement="end"
                          >
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                onClick={() => {
                                  insertRuleAt(i, ruleIdx);
                                  setOpenRuleMenu(null);
                                }}
                              >
                                Add rule above
                              </DropdownMenuItem>
                              {step.rules.length > 1 &&
                                rState !== "monitored" && (
                                  <DropdownMenuItem
                                    color="red"
                                    onClick={() => {
                                      removeRule(i, ruleIdx);
                                      setOpenRuleMenu(null);
                                    }}
                                  >
                                    Delete rule
                                  </DropdownMenuItem>
                                )}
                            </DropdownMenuGroup>
                          </DropdownMenu>
                        </GateRuleCard>
                      </React.Fragment>
                    );
                  })}

                  {/* Environment toggles */}
                  {step.togglesExpanded ? (
                    <Flex gap="4" wrap="wrap">
                      {allEnvIds.map((envId) => {
                        const state = step.toggles[envId];
                        const isOn = state === true;
                        const isOff = state === false;
                        const isIndeterminate = state === undefined;
                        return (
                          <Flex
                            key={envId}
                            direction="column"
                            gap="0"
                            style={{ lineHeight: 1 }}
                          >
                            <RadixText
                              as="label"
                              size="2"
                              color={isIndeterminate ? undefined : "violet"}
                              style={{ cursor: "pointer" }}
                            >
                              <Flex gap="2" align="center">
                                <RadixCheckbox
                                  size="3"
                                  variant={isIndeterminate ? "soft" : "surface"}
                                  color={isIndeterminate ? "gray" : "violet"}
                                  checked={
                                    isIndeterminate ? "indeterminate" : isOn
                                  }
                                  onCheckedChange={() => {
                                    if (isIndeterminate) {
                                      setToggle(i, envId, true);
                                    } else if (isOn) {
                                      setToggle(i, envId, false);
                                    } else {
                                      setToggle(i, envId);
                                    }
                                  }}
                                />
                                {envId}
                              </Flex>
                            </RadixText>
                            <span
                              style={{
                                fontSize: "var(--font-size-1)",
                                color: isOn
                                  ? "var(--green-10)"
                                  : isOff
                                    ? "var(--red-10)"
                                    : "var(--gray-a8)",
                                paddingLeft: 28,
                                width: 100,
                                display: "inline-block",
                              }}
                            >
                              {isOn
                                ? "toggle ON"
                                : isOff
                                  ? "toggle OFF"
                                  : "no change"}
                            </span>
                          </Flex>
                        );
                      })}
                    </Flex>
                  ) : (
                    <Link
                      size="1"
                      onClick={() => updateStep(i, { togglesExpanded: true })}
                    >
                      Change enabled environments
                    </Link>
                  )}
                </Flex>
              </TableCell>

              {/* THEN */}
              <TableCell
                style={{
                  verticalAlign: "top",
                  paddingTop: 20,
                  paddingBottom: 20,
                }}
              >
                <Flex direction="column" gap="2">
                  <Flex align="center" gap="2" wrap="wrap">
                    <Select
                      size="2"
                      value={step.triggerType}
                      setValue={(v) =>
                        updateStep(i, {
                          triggerType: v as "interval" | "approval",
                        })
                      }
                    >
                      <SelectItem value="interval">hold</SelectItem>
                      <SelectItem value="approval">await approval</SelectItem>
                    </Select>
                    {step.triggerType === "interval" && (
                      <>
                        <TextField.Root
                          size="2"
                          type="number"
                          min="1"
                          style={{ width: 56 }}
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
                        />
                        <Select
                          size="2"
                          value={step.intervalUnit}
                          setValue={(v) =>
                            updateStep(i, {
                              intervalUnit: v as IntervalUnit,
                            })
                          }
                        >
                          <SelectItem value="hours">hours</SelectItem>
                          <SelectItem value="days">days</SelectItem>
                        </Select>
                      </>
                    )}
                  </Flex>
                  <Flex align="center" gap="1">
                    <Box
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        const newMonitored = !step.monitored;
                        if (newMonitored && step.rules.length === 0) {
                          setSteps((prev) =>
                            prev.map((s, j) => {
                              if (j !== i) return s;
                              return {
                                ...s,
                                rules: [
                                  {
                                    id: nextRuleId(),
                                    monitored: true,
                                    allEnvironments: true,
                                    envIds: [],
                                    coverage: 100,
                                  },
                                ],
                              };
                            }),
                          );
                        }
                        updateStep(i, { monitored: newMonitored });
                      }}
                    >
                      {step.monitored ? (
                        <Flex
                          align="center"
                          gap="1"
                          style={{ display: "inline-flex" }}
                        >
                          <PiShieldCheckBold
                            size={12}
                            style={{ color: "var(--blue-9)" }}
                          />
                          <span
                            style={{
                              fontSize: "var(--font-size-1)",
                              color: "var(--blue-9)",
                            }}
                          >
                            monitored
                          </span>
                        </Flex>
                      ) : (
                        <Text size="small" color="text-low">
                          unmonitored
                        </Text>
                      )}
                    </Box>
                  </Flex>
                </Flex>
              </TableCell>

              {/* Menu */}
              <TableCell
                style={{
                  verticalAlign: "top",
                  paddingTop: 20,
                  paddingBottom: 20,
                }}
              >
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
                      style={{ marginTop: 2, flexShrink: 0 }}
                    >
                      <BsThreeDotsVertical size={16} />
                    </IconButton>
                  }
                  variant="soft"
                  menuPlacement="end"
                >
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => {
                        setOpenMenuIndex(null);
                        addStepAfter(i);
                      }}
                    >
                      Add step after
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  {steps.length > 1 && (
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
                  )}
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Box py="3">
        <Link size="2" onClick={addStep}>
          <PiPlusBold
            size={12}
            style={{ marginRight: 4, verticalAlign: "middle" }}
          />
          Add step
        </Link>
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
