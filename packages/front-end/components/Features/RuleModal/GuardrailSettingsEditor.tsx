import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiGearSixFill } from "react-icons/pi";
import { isMetricGroupId } from "shared/experiments";
import type {
  GuardrailTopLevelAction,
  GuardrailStepAction,
  ScheduleGuardrailSettings,
  StepGuardrailSettings,
} from "shared/validators";
import Text from "@/ui/Text";
import { Select, SelectItem } from "@/ui/Select";
import { Popover } from "@/ui/Popover";
import { useDefinitions } from "@/services/DefinitionsContext";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";

// ── Label maps ───────────────────────────────────────────────────────────────

const TOP_LEVEL_ACTION_LABELS: Record<GuardrailTopLevelAction, string> = {
  rollback: "Rollback",
  pause: "Pause",
  warn: "Warn only",
};

const STEP_ACTION_LABELS: Record<GuardrailStepAction, string> = {
  hold: "Hold step",
  warn: "Warn only",
  ignore: "Ignore",
};

// ── Layout constants ─────────────────────────────────────────────────────────

const LABEL_WIDTH = 160;
const SELECT_WIDTH = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveMetricName(
  id: string,
  getMetricById: (id: string) => { name: string } | null,
  getFactMetricById: (id: string) => { name: string } | null,
  getMetricGroupById: (id: string) => { name: string } | null,
): string {
  if (isMetricGroupId(id)) {
    return getMetricGroupById(id)?.name ?? id.slice(0, 12);
  }
  return (
    getMetricById(id)?.name ?? getFactMetricById(id)?.name ?? id.slice(0, 12)
  );
}

// ── Schedule-level summary ───────────────────────────────────────────────────

export function summarizeScheduleGuardrails(
  gs: ScheduleGuardrailSettings,
  metricIds: string[],
): string {
  const parts: string[] = [];

  const byAction: Record<string, number> = {};
  for (const id of metricIds) {
    const action = gs.metrics?.[id]?.onUnhealthy ?? "warn";
    byAction[action] = (byAction[action] ?? 0) + 1;
  }
  for (const [action, count] of Object.entries(byAction)) {
    if (count === metricIds.length && metricIds.length > 0) {
      parts.push(
        `${TOP_LEVEL_ACTION_LABELS[action as GuardrailTopLevelAction]} on fail`,
      );
    } else {
      parts.push(
        `${count} ${TOP_LEVEL_ACTION_LABELS[action as GuardrailTopLevelAction].toLowerCase()}`,
      );
    }
  }

  if (metricIds.length === 0) {
    parts.push("No guardrail metrics");
  }

  const healthLabel =
    TOP_LEVEL_ACTION_LABELS[gs.experimentHealthAction ?? "pause"];
  if (gs.experimentHealthAction !== "pause") {
    parts.push(`SRM: ${healthLabel.toLowerCase()}`);
  }

  return parts.join(" · ");
}

export function summarizeStepGuardrails(
  gs: StepGuardrailSettings,
  metricIds: string[],
): string {
  const parts: string[] = [];

  const byAction: Record<string, number> = {};
  for (const id of metricIds) {
    const action = gs.metrics?.[id]?.onUnhealthy ?? "ignore";
    byAction[action] = (byAction[action] ?? 0) + 1;
  }
  for (const [action, count] of Object.entries(byAction)) {
    if (count === metricIds.length && metricIds.length > 0) {
      parts.push(
        `${STEP_ACTION_LABELS[action as GuardrailStepAction]} on fail`,
      );
    } else {
      parts.push(
        `${count} ${STEP_ACTION_LABELS[action as GuardrailStepAction].toLowerCase()}`,
      );
    }
  }

  if (metricIds.length === 0) {
    parts.push("No guardrail metrics");
  }

  const healthLabel = STEP_ACTION_LABELS[gs.experimentHealthAction ?? "hold"];
  if (gs.experimentHealthAction !== "hold") {
    parts.push(`SRM: ${healthLabel.toLowerCase()}`);
  }

  return parts.join(" · ");
}

// ── Metric table (shared between schedule and step popovers) ─────────────────

function MetricTable({
  rows,
  options,
}: {
  rows: { label: string; value: string; onChange: (v: string) => void }[];
  options: { value: string; label: string }[];
}) {
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td
              style={{
                width: LABEL_WIDTH,
                paddingRight: 8,
                paddingBottom: 4,
                verticalAlign: "middle",
              }}
            >
              <OverflowText
                maxWidth={LABEL_WIDTH}
                title={row.label}
                style={{ fontSize: "var(--font-size-1)" }}
              >
                {row.label}
              </OverflowText>
            </td>
            <td
              style={{
                width: SELECT_WIDTH,
                paddingBottom: 4,
                verticalAlign: "middle",
              }}
            >
              <Select
                size="1"
                value={row.value}
                setValue={row.onChange}
                variant="surface"
                style={{ width: SELECT_WIDTH }}
              >
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </Select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TOP_LEVEL_OPTIONS = [
  { value: "rollback", label: "Rollback" },
  { value: "pause", label: "Pause" },
  { value: "warn", label: "Warn only" },
];

const STEP_OPTIONS = [
  { value: "hold", label: "Hold step" },
  { value: "warn", label: "Warn only" },
  { value: "ignore", label: "Ignore" },
];

// ── Schedule-level editor (replaces autoRollback checkbox) ───────────────────

interface ScheduleGuardrailEditorProps {
  settings: ScheduleGuardrailSettings;
  metricIds: string[];
  onChange: (settings: ScheduleGuardrailSettings) => void;
}

export function ScheduleGuardrailEditor({
  settings,
  metricIds,
  onChange,
}: ScheduleGuardrailEditorProps) {
  const { getMetricById, getFactMetricById, getMetricGroupById } =
    useDefinitions();

  const updateMetric = (metricId: string, action: GuardrailTopLevelAction) => {
    onChange({
      ...settings,
      metrics: { ...settings.metrics, [metricId]: { onUnhealthy: action } },
    });
  };

  const setAllMetrics = (action: GuardrailTopLevelAction) => {
    onChange({
      ...settings,
      metrics: Object.fromEntries(
        metricIds.map((id) => [id, { onUnhealthy: action }]),
      ),
    });
  };

  const summary = summarizeScheduleGuardrails(settings, metricIds);

  const allSameValue =
    metricIds.length > 1 &&
    metricIds.every(
      (id) =>
        (settings.metrics?.[id]?.onUnhealthy ?? "warn") ===
        (settings.metrics?.[metricIds[0]]?.onUnhealthy ?? "warn"),
    )
      ? (settings.metrics?.[metricIds[0]]?.onUnhealthy ?? "warn")
      : "";

  const rows = [
    ...(metricIds.length > 1
      ? [
          {
            label: "All metrics",
            value: allSameValue,
            onChange: (v: string) =>
              setAllMetrics(v as GuardrailTopLevelAction),
          },
        ]
      : []),
    ...metricIds.map((id) => ({
      label: resolveMetricName(
        id,
        getMetricById,
        getFactMetricById,
        getMetricGroupById,
      ),
      value: settings.metrics?.[id]?.onUnhealthy ?? "warn",
      onChange: (v: string) => updateMetric(id, v as GuardrailTopLevelAction),
    })),
  ];

  return (
    <Popover
      trigger={
        <Flex
          align="center"
          gap="2"
          role="button"
          style={{ cursor: "pointer" }}
        >
          <PiGearSixFill size={14} color="var(--color-text-mid)" />
          <Text size="small" color="text-mid">
            {summary}
          </Text>
        </Flex>
      }
      content={
        <Box>
          <Text weight="semibold" size="small" mb="2" as="p">
            If a guardrail metric is unhealthy
          </Text>

          {rows.length > 0 ? (
            <MetricTable rows={rows} options={TOP_LEVEL_OPTIONS} />
          ) : (
            <Text size="small" color="text-low" mb="2">
              Add guardrail metrics above to configure actions.
            </Text>
          )}

          <Box mt="3" pt="2" style={{ borderTop: "1px solid var(--gray-a5)" }}>
            <Text weight="semibold" size="small" mb="2" as="p">
              On experiment health issue (SRM)
            </Text>
            <Select
              size="1"
              value={settings.experimentHealthAction ?? "pause"}
              setValue={(v) =>
                onChange({
                  ...settings,
                  experimentHealthAction: v as GuardrailTopLevelAction,
                })
              }
              variant="surface"
              style={{ width: SELECT_WIDTH }}
            >
              <SelectItem value="rollback">Rollback</SelectItem>
              <SelectItem value="pause">Pause</SelectItem>
              <SelectItem value="warn">Warn only</SelectItem>
            </Select>
          </Box>
        </Box>
      }
      side="bottom"
      align="start"
      showCloseButton
      contentStyle={{ padding: "12px 16px", minWidth: 300, maxWidth: 400 }}
    />
  );
}

// ── Step-level editor (replaces old per-step checkboxes) ─────────────────────

interface StepGuardrailEditorProps {
  settings: StepGuardrailSettings;
  metricIds: string[];
  onChange: (settings: StepGuardrailSettings) => void;
}

export function StepGuardrailEditor({
  settings,
  metricIds,
  onChange,
}: StepGuardrailEditorProps) {
  const { getMetricById, getFactMetricById, getMetricGroupById } =
    useDefinitions();

  const updateMetric = (metricId: string, action: GuardrailStepAction) => {
    onChange({
      ...settings,
      metrics: { ...settings.metrics, [metricId]: { onUnhealthy: action } },
    });
  };

  const setAllMetrics = (action: GuardrailStepAction) => {
    onChange({
      ...settings,
      metrics: Object.fromEntries(
        metricIds.map((id) => [id, { onUnhealthy: action }]),
      ),
    });
  };

  const summary = summarizeStepGuardrails(settings, metricIds);

  const allSameValue =
    metricIds.length > 1 &&
    metricIds.every(
      (id) =>
        (settings.metrics?.[id]?.onUnhealthy ?? "ignore") ===
        (settings.metrics?.[metricIds[0]]?.onUnhealthy ?? "ignore"),
    )
      ? (settings.metrics?.[metricIds[0]]?.onUnhealthy ?? "ignore")
      : "";

  const rows = [
    ...(metricIds.length > 1
      ? [
          {
            label: "All metrics",
            value: allSameValue,
            onChange: (v: string) => setAllMetrics(v as GuardrailStepAction),
          },
        ]
      : []),
    ...metricIds.map((id) => ({
      label: resolveMetricName(
        id,
        getMetricById,
        getFactMetricById,
        getMetricGroupById,
      ),
      value: settings.metrics?.[id]?.onUnhealthy ?? "ignore",
      onChange: (v: string) => updateMetric(id, v as GuardrailStepAction),
    })),
  ];

  return (
    <Popover
      trigger={
        <Flex
          align="center"
          gap="1"
          role="button"
          style={{ cursor: "pointer" }}
        >
          <PiGearSixFill size={12} color="var(--color-text-mid)" />
          <Text size="small" color="text-mid">
            {summary}
          </Text>
        </Flex>
      }
      content={
        <Box>
          <Text weight="semibold" size="small" mb="2" as="p">
            If a guardrail metric is unhealthy
          </Text>

          {rows.length > 0 ? (
            <MetricTable rows={rows} options={STEP_OPTIONS} />
          ) : (
            <Text size="small" color="text-low" mb="2">
              No guardrail metrics configured.
            </Text>
          )}

          <Box mt="3" pt="2" style={{ borderTop: "1px solid var(--gray-a5)" }}>
            <Text weight="semibold" size="small" mb="2" as="p">
              On experiment health issue (SRM)
            </Text>
            <Select
              size="1"
              value={settings.experimentHealthAction ?? "hold"}
              setValue={(v) =>
                onChange({
                  ...settings,
                  experimentHealthAction: v as GuardrailStepAction,
                })
              }
              variant="surface"
              style={{ width: SELECT_WIDTH }}
            >
              <SelectItem value="hold">Hold step</SelectItem>
              <SelectItem value="warn">Warn only</SelectItem>
              <SelectItem value="ignore">Ignore</SelectItem>
            </Select>
          </Box>
        </Box>
      }
      side="bottom"
      align="end"
      showCloseButton
      contentStyle={{ padding: "12px 16px", minWidth: 300, maxWidth: 400 }}
    />
  );
}
