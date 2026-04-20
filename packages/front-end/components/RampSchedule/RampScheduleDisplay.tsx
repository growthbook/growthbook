// Read-only view of a ramp schedule's steps and effects.
// When targetId is set, only actions for that target are shown.

import { Fragment, type ReactNode } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import stringify from "json-stringify-pretty-compact";
import { RampScheduleInterface, RampStepAction } from "shared/validators";
import Text from "@/ui/Text";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import {
  formatTrigger,
  formatScheduledDate,
} from "@/components/RampSchedule/RampTimeline";

// ─── Effect row ──────────────────────────────────────────────────────────────

const EFFECT_LABEL_W = 120;

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

// ─── Patch display ────────────────────────────────────────────────────────────

function PatchDisplay({
  actions,
  syntheticEnabled,
  noChangesLabel = "—",
}: {
  actions: RampStepAction[];
  syntheticEnabled?: boolean;
  noChangesLabel?: string;
}) {
  const items: ReactNode[] = [];

  actions.forEach((action, ai) => {
    const p = action.patch;
    const k = (s: string) => `${ai}-${s}`;

    if (p.coverage !== null && p.coverage !== undefined) {
      items.push(
        <EffectRow key={k("cov")} label="Rollout %">
          {Math.round(p.coverage * 100)}%
        </EffectRow>,
      );
    }

    if ("force" in p && p.force !== undefined) {
      const forceStr =
        p.force === null
          ? "null"
          : typeof p.force === "string"
            ? p.force
            : stringify(p.force as object);
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

    if (p.enabled === false && syntheticEnabled === undefined) {
      items.push(
        <EffectRow key={k("enabled")} label="Rule">
          disabled
        </EffectRow>,
      );
    } else if (p.enabled === true && syntheticEnabled === undefined) {
      items.push(
        <EffectRow key={k("enabled")} label="Rule">
          enabled
        </EffectRow>,
      );
    }
  });

  if (syntheticEnabled === false) {
    items.push(
      <EffectRow key="syn-enabled" label="Rule">
        disabled
      </EffectRow>,
    );
  } else if (syntheticEnabled === true) {
    items.push(
      <EffectRow key="syn-enabled" label="Rule">
        enabled
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

// ─── Trigger label ────────────────────────────────────────────────────────────

function StartDateLabel({ startDate }: { startDate?: Date | string | null }) {
  if (!startDate)
    return (
      <Text size="small" color="text-low">
        —
      </Text>
    );
  return <>{formatScheduledDate(startDate)}</>;
}

// ─── Row ─────────────────────────────────────────────────────────────────────

const LABEL_W = 40;
const TRIGGER_W = 110;

function Row({
  label,
  trigger,
  actions,
  syntheticEnabled,
  dimmed,
  isActive,
}: {
  label: ReactNode;
  trigger: ReactNode;
  actions: RampStepAction[];
  syntheticEnabled?: boolean;
  dimmed?: boolean;
  isActive?: boolean;
}) {
  const labelColor: "text-mid" | "text-low" = isActive
    ? "text-mid"
    : "text-low";

  return (
    <Flex align="start" gap="3" pt="2" style={{ opacity: dimmed ? 0.5 : 1 }}>
      <Box style={{ width: LABEL_W, flexShrink: 0 }}>
        <Text size="small" weight="medium" color={labelColor}>
          {label}
        </Text>
      </Box>
      <Box style={{ width: TRIGGER_W, flexShrink: 0 }}>
        <Text size="small" color="text-low">
          {trigger}
        </Text>
      </Box>
      <Box style={{ minWidth: 0, flex: 1 }}>
        <PatchDisplay actions={actions} syntheticEnabled={syntheticEnabled} />
      </Box>
    </Flex>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function filterActions(
  actions: RampStepAction[],
  targetId?: string,
): RampStepAction[] {
  if (!targetId) return actions;
  return actions.filter((a) => a.targetId === targetId);
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  rs: RampScheduleInterface;
  // When set, only actions belonging to this targetId are shown.
  targetId?: string;
}

export default function RampScheduleDisplay({ rs, targetId }: Props) {
  const current = rs.currentStepIndex;

  const endActions = filterActions(rs.endActions ?? [], targetId);

  return (
    <Box mx="2">
      {/* Column headers */}
      <Flex gap="3" mb="1">
        <Box style={{ width: LABEL_W, flexShrink: 0 }}>
          <Text size="small" color="text-low" weight="medium">
            Step
          </Text>
        </Box>
        <Box style={{ width: TRIGGER_W, flexShrink: 0 }}>
          <Text size="small" color="text-low" weight="medium">
            Wait for
          </Text>
        </Box>
        <Box>
          <Text size="small" color="text-low" weight="medium">
            Effects
          </Text>
        </Box>
      </Flex>

      {rs.startDate && (
        <>
          <Separator size="4" my="2" />
          <Row
            label="start"
            trigger={<StartDateLabel startDate={rs.startDate} />}
            actions={[]}
          />
        </>
      )}

      {/* Steps */}
      {rs.steps.map((step, i) => (
        <Fragment key={i}>
          <Separator size="4" my="2" />
          <Row
            label={i + 1}
            trigger={formatTrigger(step.trigger)}
            actions={filterActions(step.actions, targetId)}
            isActive={i === current}
          />
        </Fragment>
      ))}

      <Separator size="4" my="2" />
      <Row
        label="end"
        trigger={
          <Text size="small" color="text-low">
            Complete
          </Text>
        }
        actions={endActions}
        dimmed
      />
    </Box>
  );
}
