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
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { formatTrigger } from "@/components/RampSchedule/RampTimeline";

// ─── Effect row ──────────────────────────────────────────────────────────────

const EFFECT_LABEL_W = 100;

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

// syntheticEnabled: inject an enabled/disabled effect that isn't stored in actions
// (happens when disableRuleAfter auto-injects at end but no endCondition trigger).
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
        <EffectRow key={k("cov")} label="Coverage">
          {Math.round(p.coverage * 100)}%
        </EffectRow>,
      );
    }

    if (p.force !== undefined && p.force !== null) {
      const forceStr =
        typeof p.force === "string" ? p.force : stringify(p.force as object);
      items.push(
        <EffectRow key={k("force")} label="Feature value">
          <InlineCode language="json" code={forceStr} />
        </EffectRow>,
      );
    }

    if (p.condition && p.condition !== "{}") {
      items.push(
        <EffectRow key={k("cond")} label="Targeting">
          <ConditionDisplay condition={p.condition} />
        </EffectRow>,
      );
    }

    if (p.savedGroups && p.savedGroups.length > 0) {
      items.push(
        <EffectRow key={k("sg")} label="Saved groups">
          <ConditionDisplay savedGroups={p.savedGroups} />
        </EffectRow>,
      );
    }

    if (p.prerequisites && p.prerequisites.length > 0) {
      items.push(
        <EffectRow key={k("prereq")} label="Prerequisites">
          <ConditionDisplay prerequisites={p.prerequisites} />
        </EffectRow>,
      );
    }

    // Skip enabled patches from actions — they're shown via syntheticEnabled instead
    // so we don't double-render when the backend stored them explicitly in endCondition.
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

  // Synthetic enabled/disabled from disableRuleBefore/disableRuleAfter (not stored explicitly in actions)
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
  isComplete?: boolean;
}) {
  const labelColor: "text-mid" | "text-low" = isActive
    ? "text-mid"
    : "text-low";

  return (
    <Flex
      align="start"
      gap="3"
      my="3"
      pl="2"
      style={{
        borderLeft: "2px solid var(--gray-4)",
        opacity: dimmed ? 0.5 : 1,
      }}
    >
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
  defaultOpen?: boolean;
  // Override the toggle label. Defaults to "View/Hide ramp schedule · N steps".
  triggerLabel?: string;
}

export default function RampScheduleDisplay({
  rs,
  targetId,
  defaultOpen = false,
  triggerLabel,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const stepCount = rs.steps.length;
  const current = rs.currentStepIndex;

  const startActions = filterActions(
    rs.startCondition?.actions ?? [],
    targetId,
  );
  const endActions = filterActions(rs.endCondition?.actions ?? [], targetId);

  return (
    <Box>
      {/* Toggle */}
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
          {triggerLabel ?? (
            <>
              {open ? "Hide" : "View"} ramp schedule
              {stepCount > 0 && (
                <>
                  {" "}
                  &middot; {stepCount} step{stepCount !== 1 ? "s" : ""}
                </>
              )}
            </>
          )}
        </Text>
      </Flex>

      {/* Body */}
      {open && (
        <Box mt="2" mx="2">
          {/* Column headers */}
          <Flex
            gap="3"
            mb="1"
            pl="2"
            style={{ borderLeft: "2px solid transparent" }}
          >
            <Box style={{ width: LABEL_W, flexShrink: 0 }}>
              <Text size="small" color="text-low" weight="medium">
                Step
              </Text>
            </Box>
            <Box style={{ width: TRIGGER_W, flexShrink: 0 }}>
              <Text size="small" color="text-low" weight="medium">
                Trigger
              </Text>
            </Box>
            <Box>
              <Text size="small" color="text-low" weight="medium">
                Effects
              </Text>
            </Box>
          </Flex>

          {/* Start — when disableRuleBefore and no explicit start action stored,
               the enabled:true is auto-injected by the backend into startCondition.actions
               so it should already appear in the data. Only synthesize if absent. */}
          <Row
            label="start"
            trigger={<StartTriggerLabel trigger={rs.startCondition.trigger} />}
            actions={startActions}
            isComplete={current >= 0}
          />

          {/* Steps */}
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

          {/* End — always shown.
               When endCondition is absent but disableRuleAfter is set, synthesize
               Rule: disabled since the backend applies it at completion without storing
               it in an endCondition (no explicit trigger was provided). */}
          {(() => {
            const hasExplicitEnd = !!rs.endCondition;
            const implicitDisable = !hasExplicitEnd && !!rs.disableRuleAfter;
            const terminal =
              rs.status === "completed" ||
              rs.status === "expired" ||
              rs.status === "rolled-back";
            return (
              <Row
                label="end"
                trigger={
                  hasExplicitEnd && rs.endCondition?.trigger ? (
                    formatTrigger(rs.endCondition.trigger)
                  ) : (
                    <Text size="small" color="text-low">
                      auto
                    </Text>
                  )
                }
                actions={endActions}
                syntheticEnabled={implicitDisable ? false : undefined}
                dimmed={!hasExplicitEnd && !implicitDisable}
                isComplete={terminal}
              />
            );
          })()}
        </Box>
      )}
    </Box>
  );
}
