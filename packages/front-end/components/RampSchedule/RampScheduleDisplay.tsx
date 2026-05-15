import type { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  RampScheduleInterface,
  RampStep,
  RampStepAction,
  StepHoldConditions,
} from "shared/validators";
import Text from "@/ui/Text";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import {
  formatTrigger,
  formatScheduledDate,
} from "@/components/RampSchedule/RampTimeline";

const COL = {
  step: 48,
  coverage: 96,
  action: 170,
};
const EFFECT_LABEL_W = 140;

function EffectRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Flex align="start" gap="2">
      <Box style={{ width: EFFECT_LABEL_W, flexShrink: 0 }}>
        <Text size="small" color="text-low">
          {label}:
        </Text>
      </Box>
      <Box style={{ minWidth: 0 }}>
        <Text size="small">{children}</Text>
      </Box>
    </Flex>
  );
}

function PatchDisplay({
  actions,
  monitored,
  holdConditions,
  approvalNotes,
  noChangesLabel = "—",
}: {
  actions: RampStepAction[];
  monitored?: boolean;
  holdConditions?: StepHoldConditions;
  approvalNotes?: string | null;
  noChangesLabel?: string;
}) {
  const items: ReactNode[] = [];

  actions.forEach((action, ai) => {
    if (action.targetType !== "feature-rule") return;
    const p = action.patch;
    const k = (s: string) => `${ai}-${s}`;

    if ("force" in p && p.force !== undefined) {
      const forceStr =
        p.force === null
          ? "null"
          : typeof p.force === "string"
            ? p.force
            : JSON.stringify(p.force);
      items.push(
        <EffectRow key={k("force")} label="Feature value">
          <InlineCode language="json" code={forceStr} />
        </EffectRow>,
      );
    }

    if ("condition" in p) {
      items.push(
        <EffectRow key={k("cond")} label="Attribute targeting">
          {p.condition && p.condition !== "{}" ? (
            <ConditionDisplay condition={p.condition} />
          ) : (
            <Text size="small" fontStyle="italic">
              None
            </Text>
          )}
        </EffectRow>,
      );
    }

    if ("savedGroups" in p) {
      items.push(
        <EffectRow key={k("sg")} label="Saved groups">
          {p.savedGroups && p.savedGroups.length > 0 ? (
            <SavedGroupTargetingDisplay savedGroups={p.savedGroups} />
          ) : (
            <Text size="small" fontStyle="italic">
              None
            </Text>
          )}
        </EffectRow>,
      );
    }

    if ("prerequisites" in p) {
      items.push(
        <EffectRow key={k("prereq")} label="Prerequisites">
          {p.prerequisites && p.prerequisites.length > 0 ? (
            <ConditionDisplay prerequisites={p.prerequisites} />
          ) : (
            <Text size="small" fontStyle="italic">
              None
            </Text>
          )}
        </EffectRow>,
      );
    }

    if ("allEnvironments" in p || "environments" in p) {
      const hasSelectedEnvironments =
        Array.isArray(p.environments) && p.environments.length > 0;
      const envScope = p.allEnvironments
        ? "All environments"
        : hasSelectedEnvironments
          ? p.environments!.join(", ")
          : "No environments";
      items.push(
        <EffectRow key={k("env")} label="Rule environments">
          {envScope}
        </EffectRow>,
      );
    }

    if (p.enabled === false) {
      items.push(
        <EffectRow key={k("enabled")} label="Rule">
          disabled
        </EffectRow>,
      );
    } else if (p.enabled === true) {
      items.push(
        <EffectRow key={k("enabled")} label="Rule">
          enabled
        </EffectRow>,
      );
    }
  });

  if (monitored) {
    items.push(
      <EffectRow key="monitored" label="Monitoring">
        Enabled for this step
      </EffectRow>,
    );
  }

  if (holdConditions?.minSampleSize) {
    items.push(
      <EffectRow key="hold-sample" label="Hold condition">
        At least {holdConditions.minSampleSize.toLocaleString()} users
      </EffectRow>,
    );
  }
  if (holdConditions?.minDurationMs) {
    items.push(
      <EffectRow key="hold-duration" label="Hold condition">
        At least {formatDurationMs(holdConditions.minDurationMs)}
      </EffectRow>,
    );
  }
  if (approvalNotes) {
    items.push(
      <EffectRow key="approval-notes" label="Approval notes">
        {approvalNotes}
      </EffectRow>,
    );
  }

  if (items.length === 0) {
    return (
      <Text size="small" color="text-low">
        {noChangesLabel}
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="1">
      {items}
    </Flex>
  );
}

function StartDateLabel({ startDate }: { startDate?: Date | string | null }) {
  if (!startDate)
    return (
      <Text size="small" color="text-low">
        —
      </Text>
    );
  return <>{formatScheduledDate(startDate)}</>;
}

function formatDurationMs(ms: number): string {
  if (ms % 86_400_000 === 0) {
    return `${ms / 86_400_000} day${ms === 86_400_000 ? "" : "s"}`;
  }
  if (ms % 3_600_000 === 0) {
    return `${ms / 3_600_000} hour${ms === 3_600_000 ? "" : "s"}`;
  }
  if (ms % 60_000 === 0) {
    return `${ms / 60_000} minute${ms === 60_000 ? "" : "s"}`;
  }
  return `${Math.round(ms / 1000)} seconds`;
}

function getCoverageLabel(
  actions: RampStepAction[],
  monitored?: boolean,
): string {
  const firstCoverage = actions
    .filter((a) => a.targetType === "feature-rule")
    .map((a) => a.patch.coverage)
    .find((c): c is number => c !== undefined && c !== null);
  if (firstCoverage === undefined) return "—";
  const pct = monitored ? (firstCoverage * 100) / 2 : firstCoverage * 100;
  const rounded = Math.round(pct * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

function getRowAccentColor(
  step: Pick<RampStep, "monitored">,
  isActive?: boolean,
) {
  if (isActive) return "var(--blue-9)";
  if (step.monitored) return "var(--blue-8)";
  return "var(--gray-a5)";
}

function Row({
  label,
  step,
  trigger,
  actions,
  coverageLabel,
  dimmed,
  isActive,
}: {
  label: ReactNode;
  step?: Pick<RampStep, "monitored" | "holdConditions" | "approvalNotes">;
  trigger: ReactNode;
  actions: RampStepAction[];
  coverageLabel: string;
  dimmed?: boolean;
  isActive?: boolean;
}) {
  const labelColor: "text-mid" | "text-low" = isActive
    ? "text-mid"
    : "text-low";

  return (
    <Box
      my="2"
      style={{
        position: "relative",
        border: "1px solid var(--gray-a5)",
        borderRadius: "var(--radius-2)",
        paddingBlock: "var(--space-2)",
        opacity: dimmed ? 0.6 : 1,
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
          backgroundColor: step
            ? getRowAccentColor(step, isActive)
            : "var(--gray-a5)",
        }}
      />
      <Flex align="start" gap="4" pl="2" pr="2">
        <Box style={{ width: COL.step, flexShrink: 0, textAlign: "center" }}>
          <Text size="small" weight="medium" color={labelColor}>
            {label}
          </Text>
        </Box>
        <Box style={{ width: COL.coverage, flexShrink: 0 }}>
          <Text size="small" color="text-low">
            {coverageLabel}
          </Text>
        </Box>
        <Box style={{ width: COL.action, flexShrink: 0 }}>
          <Text size="small" color="text-low">
            {trigger}
          </Text>
        </Box>
        <Box style={{ minWidth: 0, flex: 1 }}>
          <PatchDisplay
            actions={actions}
            monitored={step?.monitored}
            holdConditions={step?.holdConditions}
            approvalNotes={step?.approvalNotes}
          />
        </Box>
      </Flex>
    </Box>
  );
}

function filterActions(
  actions: RampStepAction[],
  targetId?: string,
): RampStepAction[] {
  if (!targetId) return actions;
  return actions.filter(
    (a) => a.targetType === "feature-rule" && a.targetId === targetId,
  );
}

interface Props {
  rs: RampScheduleInterface;
  // When set, only actions belonging to this targetId are shown.
  targetId?: string;
}

export default function RampScheduleDisplay({ rs, targetId }: Props) {
  const current = rs.currentStepIndex;

  const startActions = filterActions(rs.startActions ?? [], targetId);
  const endActions = filterActions(rs.endActions ?? [], targetId);

  return (
    <Box mx="2">
      <Flex align="center" gap="4" pb="1" pl="2" style={{ marginBottom: 4 }}>
        <Box style={{ width: COL.step, flexShrink: 0 }}>
          <Text size="small" color="text-low" weight="medium">
            Step
          </Text>
        </Box>
        <Box style={{ width: COL.coverage, flexShrink: 0 }}>
          <Text size="small" color="text-low" weight="medium">
            Rollout %
          </Text>
        </Box>
        <Box style={{ width: COL.action, flexShrink: 0 }}>
          <Text size="small" color="text-low" weight="medium">
            Action
          </Text>
        </Box>
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Text size="small" color="text-low" weight="medium">
            Rule effects
          </Text>
        </Box>
      </Flex>

      {rs.startDate && (
        <Row
          label="start"
          trigger={<StartDateLabel startDate={rs.startDate} />}
          actions={startActions}
          coverageLabel={getCoverageLabel(startActions)}
        />
      )}

      {rs.steps.map((step, i) => (
        <Row
          key={i}
          label={i + 1}
          step={step}
          trigger={formatTrigger(step.trigger)}
          actions={filterActions(step.actions, targetId)}
          coverageLabel={getCoverageLabel(
            filterActions(step.actions, targetId),
            step.monitored,
          )}
          isActive={i === current}
        />
      ))}

      <Row
        label="end"
        trigger={
          <Text size="small" color="text-low">
            Complete
          </Text>
        }
        actions={endActions}
        coverageLabel={getCoverageLabel(endActions)}
        dimmed
      />
    </Box>
  );
}
