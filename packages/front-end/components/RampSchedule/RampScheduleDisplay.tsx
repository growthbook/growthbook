// Read-only, collapsible view of a ramp schedule's steps and effects.
// Accepts any RampScheduleInterface — usable inside rule modals, overview pages, or standalone.
// targetId: when provided, only the actions for that specific target are shown.

import { useState, type ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretRightBold } from "react-icons/pi";
import stringify from "json-stringify-pretty-compact";
import {
  RampScheduleInterface,
  RampStartTrigger,
  RampStepAction,
} from "shared/src/validators/ramp-schedule";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { formatTrigger } from "@/components/RampSchedule/RampTimeline";

// ─── Patch chips ─────────────────────────────────────────────────────────────

function PatchDisplay({ actions }: { actions: RampStepAction[] }) {
  const parts: ReactNode[] = [];

  actions.forEach((action, ai) => {
    const p = action.patch;

    if (p.coverage !== null && p.coverage !== undefined) {
      parts.push(
        <Badge
          key={`${ai}-cov`}
          color="violet"
          label={`${Math.round(p.coverage * 100)}%`}
        />,
      );
    }

    const hasTargeting =
      (p.condition && p.condition !== "{}") ||
      (p.savedGroups && p.savedGroups.length > 0) ||
      (p.prerequisites && p.prerequisites.length > 0);

    if (hasTargeting) {
      parts.push(
        <Box key={`${ai}-cond`}>
          <ConditionDisplay
            condition={p.condition ?? undefined}
            savedGroups={p.savedGroups ?? undefined}
            prerequisites={p.prerequisites ?? undefined}
          />
        </Box>,
      );
    }

    if (p.force !== undefined && p.force !== null) {
      const forceStr =
        typeof p.force === "string"
          ? p.force
          : stringify(p.force as object);
      parts.push(
        <Flex key={`${ai}-force`} align="center" gap="1">
          <Text size="small" color="text-low">
            value:
          </Text>
          <InlineCode language="json" code={forceStr} />
        </Flex>,
      );
    }

    if (p.enabled === false) {
      parts.push(
        <Badge key={`${ai}-disabled`} color="gray" label="disabled" />,
      );
    } else if (p.enabled === true) {
      parts.push(
        <Badge key={`${ai}-enabled`} color="green" label="enabled" />,
      );
    }
  });

  if (parts.length === 0) {
    return (
      <Text size="small" color="text-low">
        (no changes)
      </Text>
    );
  }

  return (
    <Flex gap="2" wrap="wrap" align="center">
      {parts}
    </Flex>
  );
}

// ─── Trigger label ────────────────────────────────────────────────────────────

function StartTriggerLabel({ trigger }: { trigger: RampStartTrigger }) {
  if (trigger.type === "immediately") {
    return <Text size="small">immediately</Text>;
  }
  if (trigger.type === "manual") {
    return <Text size="small">manual</Text>;
  }
  return <>{formatTrigger({ type: "scheduled", at: trigger.at })}</>;
}

// ─── Row ─────────────────────────────────────────────────────────────────────

const LABEL_W = 38;
const TRIGGER_W = 100;

function Row({
  label,
  trigger,
  actions,
  isActive,
  isComplete,
}: {
  label: ReactNode;
  trigger: ReactNode;
  actions: RampStepAction[];
  isActive?: boolean;
  isComplete?: boolean;
}) {
  const labelColor = isActive ? "violet" : isComplete ? "text-mid" : "text-low";

  return (
    <Flex align="flex-start" gap="3" py="1">
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
      <Box style={{ minWidth: 0 }}>
        <PatchDisplay actions={actions} />
      </Box>
    </Flex>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  rs: RampScheduleInterface;
  // When set, only actions belonging to this targetId are shown.
  // When absent, all actions are shown (useful in multi-target ramps).
  targetId?: string;
  defaultOpen?: boolean;
}

function filterActions(
  actions: RampStepAction[],
  targetId?: string,
): RampStepAction[] {
  if (!targetId) return actions;
  return actions.filter((a) => a.targetId === targetId);
}

export default function RampScheduleDisplay({
  rs,
  targetId,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const stepCount = rs.steps.length;
  const current = rs.currentStepIndex;

  const startActions = filterActions(rs.startActions ?? [], targetId);
  const endActions = filterActions(rs.endSchedule?.actions ?? [], targetId);

  return (
    <Box>
      {/* Toggle header */}
      <Flex
        align="center"
        gap="1"
        style={{ cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((o) => !o)}
      >
        <Box
          style={{
            transition: "transform 0.15s",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            lineHeight: 1,
          }}
        >
          <PiCaretRightBold size={10} color="var(--gray-9)" />
        </Box>
        <Text size="small" color="text-low">
          {open ? "Hide" : "View"} schedule
          {stepCount > 0 && (
            <> &middot; {stepCount} step{stepCount !== 1 ? "s" : ""}</>
          )}
        </Text>
      </Flex>

      {/* Collapsible body */}
      {open && (
        <Box
          mt="2"
          pl="2"
          style={{ borderLeft: "2px solid var(--gray-4)" }}
        >
          {/* Column headers */}
          <Flex gap="3" mb="1">
            <Box style={{ width: LABEL_W, flexShrink: 0 }}>
              <Text size="small" color="text-low" weight="medium">
                step
              </Text>
            </Box>
            <Box style={{ width: TRIGGER_W, flexShrink: 0 }}>
              <Text size="small" color="text-low" weight="medium">
                trigger
              </Text>
            </Box>
            <Box>
              <Text size="small" color="text-low" weight="medium">
                effects
              </Text>
            </Box>
          </Flex>

          {/* Start row */}
          <Row
            label="start"
            trigger={<StartTriggerLabel trigger={rs.startTrigger} />}
            actions={startActions}
            isComplete={current >= 0}
          />

          {/* Intermediate steps */}
          {rs.steps.map((step, i) => (
            <Row
              key={i}
              label={i + 1}
              trigger={formatTrigger(step.trigger)}
              actions={filterActions(step.actions, targetId)}
              isActive={i === current}
              isComplete={i < current}
            />
          ))}

          {/* End row */}
          {rs.endSchedule && (
            <Row
              label="end"
              trigger={formatTrigger(rs.endSchedule.trigger)}
              actions={endActions}
            />
          )}
        </Box>
      )}
    </Box>
  );
}
