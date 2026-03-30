import { useState, type ReactNode } from "react";
import styles from "./RampTimeline.module.scss";
import { Box, Flex } from "@radix-ui/themes";
import { PiCheckBold } from "react-icons/pi";
import { format } from "date-fns";
import { abbreviateAgo } from "shared/src/dates";
import {
  RampScheduleInterface,
  RampScheduleStatus,
  RampStepAction,
  RampStartTrigger,
  RampTarget,
  RampTrigger,
} from "shared/src/validators/ramp-schedule";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import stringify from "json-stringify-pretty-compact";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import ConditionDisplay from "@/components/Features/ConditionDisplay";

// ─── helpers ────────────────────────────────────────────────────────────────

export function formatTrigger(trigger: RampTrigger): ReactNode {
  if (trigger.type === "approval") return <Text size="small">approval</Text>;
  if (trigger.type === "scheduled") return formatScheduledDate(trigger.at);
  const s = trigger.seconds;
  let duration: string;
  if (s < 60) duration = `${s}s`;
  else {
    const m = s / 60;
    if (m < 60) duration = Number.isInteger(m) ? `${m}m` : `${m.toFixed(1)}m`;
    else {
      const h = s / 3600;
      if (h < 24) duration = Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
      else {
        const d = s / 86400;
        duration = Number.isInteger(d) ? `${d}d` : `${d.toFixed(1)}d`;
      }
    }
  }
  return <Text size="small">{duration}</Text>;
}

// Two-line ReactNode for a scheduled datetime; shows year only when it differs from current year.
function formatScheduledDate(d: Date | string): ReactNode {
  const parsed = new Date(d);
  const now = new Date();
  const sameYear = parsed.getFullYear() === now.getFullYear();
  const dateLine = format(parsed, sameYear ? "MMM d" : "MMM d, yyyy");
  const timeLine = format(parsed, "h:mm a");
  return (
    <>
      <div className={styles.scheduledDateLine}>
        <Text size="small">{dateLine}</Text>
      </div>
      <div className={styles.scheduledDateLine}>
        <Text size="small">{timeLine}</Text>
      </div>
    </>
  );
}

function formatStartTrigger(trigger?: RampStartTrigger | null): ReactNode {
  if (!trigger || trigger.type === "immediately")
    return <Text size="small" color="text-low">—</Text>;
  if (trigger.type === "manual") return <Text size="small">manual</Text>;
  return formatTrigger({ type: "scheduled", at: trigger.at });
}

function formatRemaining(ms: number): ReactNode {
  if (ms <= 0) return <Text size="small">any moment</Text>;
  const future = new Date(Date.now() + ms);
  const label = abbreviateAgo(future).replace(/^in /, "");
  return <Text size="small">{label}</Text>;
}

// ─── PopoverEffectRow ─────────────────────────────────────────────────────────

function PopoverEffectRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Flex align="start" gap="2">
      <Box className={styles.effectLabel}>
        <Text size="small" color="text-low">
          {label}:
        </Text>
      </Box>
      <Box className={styles.effectValue}>
        <Text size="small">{children}</Text>
      </Box>
    </Flex>
  );
}

// ─── Popover patch display ────────────────────────────────────────────────────

function PopoverPatchDisplay({
  actions,
  syntheticEnabled,
}: {
  actions: RampStepAction[];
  syntheticEnabled?: boolean;
}) {
  const items: ReactNode[] = [];

  actions.forEach((action, ai) => {
    const p = action.patch;
    const k = (s: string) => `${ai}-${s}`;

    if (p.coverage !== null && p.coverage !== undefined) {
      items.push(
        <PopoverEffectRow key={k("cov")} label="Rollout %">
          {Math.round(p.coverage * 100)}%
        </PopoverEffectRow>,
      );
    }
    if (p.force !== undefined && p.force !== null) {
      const forceStr =
        typeof p.force === "string" ? p.force : stringify(p.force as object);
      items.push(
        <PopoverEffectRow key={k("force")} label="Value">
          <InlineCode language="json" code={forceStr} />
        </PopoverEffectRow>,
      );
    }
    if (p.condition && p.condition !== "{}") {
      items.push(
        <PopoverEffectRow key={k("cond")} label="Targeting">
          <ConditionDisplay condition={p.condition} />
        </PopoverEffectRow>,
      );
    }
    if (p.savedGroups && p.savedGroups.length > 0) {
      items.push(
        <PopoverEffectRow key={k("sg")} label="Saved groups">
          <ConditionDisplay savedGroups={p.savedGroups} />
        </PopoverEffectRow>,
      );
    }
    if (p.prerequisites && p.prerequisites.length > 0) {
      items.push(
        <PopoverEffectRow key={k("prereq")} label="Prerequisites">
          <ConditionDisplay prerequisites={p.prerequisites} />
        </PopoverEffectRow>,
      );
    }
    if (p.enabled === false && syntheticEnabled === undefined) {
      items.push(
        <PopoverEffectRow key={k("enabled")} label="Rule">
          disabled
        </PopoverEffectRow>,
      );
    } else if (p.enabled === true && syntheticEnabled === undefined) {
      items.push(
        <PopoverEffectRow key={k("enabled")} label="Rule">
          enabled
        </PopoverEffectRow>,
      );
    }
  });

  if (syntheticEnabled === false) {
    items.push(
      <PopoverEffectRow key="syn-enabled" label="Rule">
        disabled
      </PopoverEffectRow>,
    );
  } else if (syntheticEnabled === true) {
    items.push(
      <PopoverEffectRow key="syn-enabled" label="Rule">
        enabled
      </PopoverEffectRow>,
    );
  }

  if (items.length === 0) {
    return (
      <Text size="small" color="text-low">
        No changes
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="1">
      {items}
    </Flex>
  );
}

// ─── Node popover content ─────────────────────────────────────────────────────

interface NodePopoverContentProps {
  heading: string;
  headingColor: string;
  nodeColor: string;
  nodeState: NodeState;
  status: RampScheduleStatus;
  trigger: RampTrigger | RampStartTrigger | null;
  triggerLabel: ReactNode;
  actions: RampStepAction[];
  syntheticEnabled?: boolean;
  stepIndex: number | "start" | "end";
  isActive: boolean;
  rs: RampScheduleInterface;
  onJump?: (targetStepIndex: number) => Promise<void> | void;
  onComplete?: () => Promise<void> | void;
}

function NodePopoverContent({
  heading,
  headingColor,
  nodeColor,
  nodeState,
  status,
  trigger,
  triggerLabel,
  actions,
  syntheticEnabled,
  stepIndex,
  isActive,
  rs,
  onJump,
  onComplete,
}: NodePopoverContentProps) {
  const [loading, setLoading] = useState(false);

  const canAct =
    !isActive &&
    ["running", "paused", "pending-approval"].includes(rs.status);

  let ctaLabel: string | null = null;
  if (canAct) {
    if (stepIndex === "start") ctaLabel = "Roll back to start";
    else if (stepIndex === "end") ctaLabel = "Complete ramp";
    else ctaLabel = `Jump to Step ${(stepIndex as number) + 1}`;
  }

  const hasCtaHandler =
    stepIndex === "end" ? !!onComplete : !!onJump;

  async function handleCta() {
    setLoading(true);
    try {
      if (stepIndex === "end") {
        await onComplete?.();
      } else if (stepIndex === "start") {
        await onJump?.(-1);
      } else {
        await onJump?.(stepIndex as number);
      }
    } finally {
      setLoading(false);
    }
  }

  type StatusMeta = { label: string; color: string };
  const statusMeta: StatusMeta = (() => {
    if (nodeState === "completed")
      return { label: "Completed", color: "var(--violet-9)" };
    if (nodeState === "active") {
      if (status === "pending-approval")
        return { label: "Current: needs approval", color: "var(--orange-9)" };
      if (status === "paused")
        return { label: "Current: paused", color: "var(--amber-11)" };
      return { label: "Current", color: "var(--green-9)" };
    }
    return { label: "Upcoming", color: "var(--gray-10)" };
  })();

  return (
    <Box className={styles.popoverBox}>
      {/* Header */}
      <Flex align="center" gap="2" mb="2">
        {/* Fixed-width area keeps status text consistently aligned */}
        <Flex align="center" gap="2" className={styles.popoverHeaderLeft}>
          <NodeDot state={nodeState} color={nodeColor} status={status} />
          <span style={{ color: headingColor }}>
            <Text weight="medium" size="small">
              {heading}
            </Text>
          </span>
        </Flex>
        <span className={styles.popoverStatusLabel} style={{ color: statusMeta.color }}>
          {statusMeta.label}
        </span>
      </Flex>

      {/* Hold / trigger label */}
      <Box mb="2">
        <PopoverEffectRow label="Hold">{triggerLabel}</PopoverEffectRow>
      </Box>

      {/* Remaining hold — only for active interval steps */}
      {isActive && trigger?.type === "interval" && (() => {
        if (!rs.nextStepAt) return null;
        const remainingMs = new Date(rs.nextStepAt).getTime() - Date.now();
        return (
          <Box mb="2">
            <PopoverEffectRow label="Remaining">
              {formatRemaining(remainingMs)}
            </PopoverEffectRow>
          </Box>
        );
      })()}

      {/* Effects */}
      <PopoverPatchDisplay actions={actions} syntheticEnabled={syntheticEnabled} />

      {/* CTA */}
      {ctaLabel && hasCtaHandler && (
        <Flex mt="2" justify="center">
          <Button size="xs" variant="ghost" loading={loading} onClick={handleCta}>
            {ctaLabel}
          </Button>
        </Flex>
      )}
    </Box>
  );
}

function completedNodeCount(rs: RampScheduleInterface): number {
  if (rs.status === "completed") return rs.steps.length + 2;

  if (rs.status === "pending" || rs.status === "ready") return 0;
  // currentStepIndex is the step currently active/in-progress (0-indexed).
  // Nodes before it (start + prior steps) are completed; it is active.
  // Node index = stepIndex + 1 (start occupies node 0).
  return rs.currentStepIndex + 1;
}

type NodeState = "completed" | "active" | "future";

function activeDotColor(status: RampScheduleStatus): string {
  if (status === "running") return "var(--green-9)";
  if (status === "pending" || status === "ready" || status === "paused")
    return "var(--amber-9)";
  if (status === "pending-approval") return "var(--orange-9)";
  if (status === "rolled-back") return "var(--gray-8)";
  return "var(--accent-9)";
}

function activeLabelColor(status: RampScheduleStatus): string {
  if (status === "running") return "var(--green-11)";
  if (status === "pending" || status === "ready" || status === "paused")
    return "var(--amber-11)";
  if (status === "pending-approval") return "var(--orange-11)";
  if (status === "rolled-back") return "var(--gray-10)";
  return "var(--accent-11)";
}

function dotColor(state: NodeState, status: RampScheduleStatus): string {
  if (state === "completed") return "var(--violet-9)";
  if (state === "future") return "var(--gray-4)";
  return activeDotColor(status);
}

function nodeLabelColor(state: NodeState, status: RampScheduleStatus): string {
  if (state === "completed") return "var(--violet-12)";
  if (state === "future") return "var(--gray-9)";
  return activeLabelColor(status);
}

function connectorColor(left: NodeState, status: RampScheduleStatus): string {
  if (left === "completed") return "var(--violet-9)";
  if (left === "active") return activeDotColor(status);
  return "var(--gray-4)";
}

// ─── NodeDot ─────────────────────────────────────────────────────────────────

function NodeDot({
  state,
  color,
  status,
}: {
  state: NodeState;
  color: string;
  status: RampScheduleStatus;
}) {
  return (
    <Box className={styles.dotContainer}>
      {state === "active" && (
        <Box
          className={`${styles.dotRing}${status === "running" ? ` ${styles.dotRingPulse}` : ""}`}
          style={{ border: `2px solid ${color}` }}
        />
      )}
      <Box
        className={styles.nodeDot}
        style={{ backgroundColor: color }}
      >
        {state === "completed" && <PiCheckBold size={11} color="white" />}
      </Box>
    </Box>
  );
}

// ─── Node ────────────────────────────────────────────────────────────────────

interface NodeMeta {
  key: string;
  label: string;
  sublabel: ReactNode;
  /** Trigger label rendered underneath the connector that leads INTO this node. */
  connectorLabel?: ReactNode;
  isApproval: boolean;
  dotColorOverride?: string;
  labelColorOverride?: string;
  /** Pre-built popover content — when present, wraps node in a hover popover. */
  popoverContent?: ReactNode;
}

function Node({
  node,
  state,
  status,
}: {
  node: NodeMeta;
  state: NodeState;
  status: RampScheduleStatus;
}) {
  const color = node.dotColorOverride ?? dotColor(state, status);
  const labelColor = node.labelColorOverride ?? nodeLabelColor(state, status);

  const nodeContent = (
    <Flex direction="column" align="center" className={styles.nodeInner}>
      {/* Dot */}
      <Box my="1">
        <NodeDot state={state} color={color} status={status} />
      </Box>

      {/* Labels */}
      <Flex
        direction="column"
        justify="center"
        align="center"
        className={styles.nodeLabels}
      >
        <span style={{ color: labelColor }}>
          <Text
            as="div"
            mb="2"
            weight={state === "active" ? "medium" : "regular"}
          >
            {node.label}
          </Text>
        </span>
        {node.sublabel && state !== "completed" && (
          <span className={styles.nodeSublabel}>{node.sublabel}</span>
        )}
      </Flex>
    </Flex>
  );

  if (node.popoverContent) {
    return (
      <Tooltip
        body={node.popoverContent}
        tipPosition="top"
        flipTheme={false}
        usePortal
        tipMinWidth="150px"
        popperStyle={{ maxWidth: 280 }}
        delay={200}
      >
        <div className={styles.nodeHoverable}>{nodeContent}</div>
      </Tooltip>
    );
  }

  return nodeContent;
}

// ─── Connector ───────────────────────────────────────────────────────────────

function Connector({
  left,
  status,
  triggerLabel,
}: {
  left: NodeState;
  status: RampScheduleStatus;
  triggerLabel?: ReactNode;
}) {
  return (
    <Flex direction="column" className={styles.connector}>
      <Box
        className={styles.connectorLine}
        style={{ backgroundColor: connectorColor(left, status) }}
      />
      {triggerLabel && (
        <Box className={styles.connectorLabel}>{triggerLabel}</Box>
      )}
    </Flex>
  );
}

// ─── RampTimeline ─────────────────────────────────────────────────────────────

interface Props {
  rs: RampScheduleInterface;
  onEditTarget?: (target: RampTarget) => void;
  hideHeader?: boolean;
  pendingDetach?: boolean;
  onJump?: (targetStepIndex: number) => Promise<void> | void;
  onComplete?: () => Promise<void> | void;
}

// ─── Exported helpers (used by parent pages to build header rows) ─────────────

export function getRampStatusLabel(rs: RampScheduleInterface): string {
  if (rs.status === "ready") {
    return rs.startCondition?.trigger.type === "manual"
      ? "Ready to Start"
      : "Scheduled";
  }
  const labels: Partial<Record<RampScheduleStatus, string>> = {
    pending: "Schedule Start is Pending",
    running: "Running",
    paused: "Paused",
    "pending-approval": "Needs Approval",
    completed: "Complete",
    "rolled-back": "Rolled Back",
  };
  return labels[rs.status] ?? rs.status;
}

export function getRampBadgeColor(
  status: RampScheduleStatus,
): "amber" | "green" | "orange" | "gray" {
  const colors: Record<
    RampScheduleStatus,
    "amber" | "green" | "orange" | "gray"
  > = {
    pending: "amber",
    ready: "amber",
    running: "green",
    paused: "amber",
    "pending-approval": "orange",
    completed: "gray",
    "rolled-back": "gray",
  };
  return colors[status] ?? "gray";
}

export function getRampStepsCompleted(rs: RampScheduleInterface): number {
  if (rs.status === "pending" || rs.status === "ready") return 0;
  // currentStepIndex is the active step (0-indexed); display as 1-indexed.
  return Math.min(rs.steps.length, Math.max(0, rs.currentStepIndex + 1));
}

// ─── RampTimeline ─────────────────────────────────────────────────────────────

export default function RampTimeline({
  rs,
  onEditTarget: _onEditTarget,
  hideHeader: _hideHeader,
  pendingDetach,
  onJump,
  onComplete,
}: Props) {
  const { steps, status, startCondition, endCondition, targets } = rs;
  const startTrigger = startCondition?.trigger;
  // activatingRevisionVersion is now per-target; find the first target that has one
  const activatingRevisionVersion = targets.find(
    (t) => t.activatingRevisionVersion != null,
  )?.activatingRevisionVersion;
  const doneCount = completedNodeCount(rs);

  function getState(i: number): NodeState {
    // Pending detach is the authoritative state — all timeline nodes become future (gray).
    if (pendingDetach) return "future";
    if (i < doneCount) return "completed";
    // "pending": a separate pre-node shows "pending"; all timeline nodes are future.
    // "ready" with "manual": a pre-node shows "ready to start"; timeline nodes are future.
    // "ready" with "scheduled": the "start" node (i=0) is highlighted as active.
    if (status === "pending") return "future";
    if (status === "ready") {
      if (startTrigger?.type === "scheduled" && i === 0) return "active";
      return "future";
    }
    // Apply-first: the active node is the step currently holding at its coverage
    // level (applied, counting down its own hold interval before advancing).
    if (i === doneCount && status !== "completed" && status !== "rolled-back")
      return "active";
    return "future";
  }

  const nodes: NodeMeta[] = [
    {
      key: "start",
      label: "start",
      // Only show a sublabel for scheduled starts — the date belongs under the node.
      // "auto" and "manual" labels move to the connector between start and [1].
      sublabel:
        startTrigger?.type === "scheduled"
          ? formatScheduledDate(startTrigger.at)
          : null,
      isApproval: false,
      popoverContent: (
        <NodePopoverContent
          heading="Start"
          headingColor={nodeLabelColor(getState(0), status)}
          nodeColor={dotColor(getState(0), status)}
          nodeState={getState(0)}
          status={status}
          trigger={startTrigger ?? null}
          triggerLabel={formatStartTrigger(startTrigger)}
          actions={startCondition?.actions ?? []}
          stepIndex="start"
          isActive={getState(0) === "active"}
          rs={rs}
          onJump={onJump}
          onComplete={onComplete}
        />
      ),
    },
    ...steps.map((step, i) => ({
      key: `step-${i}`,
      label: String(i + 1),
      sublabel: null,
      // Apply-first: the connector to the LEFT of this node shows the hold that
      // preceded it — i.e. the previous step's interval (or the start trigger for
      // step 0). For scheduled starts the date is already under the start node so
      // we omit it from the connector.
      connectorLabel:
        i === 0
          ? startTrigger?.type === "immediately" || !startTrigger
            ? <Text size="small">auto</Text>
            : startTrigger?.type === "manual"
            ? <Text size="small">manual</Text>
            : undefined
          : formatTrigger(steps[i - 1].trigger),
      isApproval: step.trigger.type === "approval",
      popoverContent: (
        <NodePopoverContent
          heading={`Step ${i + 1}`}
          headingColor={nodeLabelColor(getState(i + 1), status)}
          nodeColor={dotColor(getState(i + 1), status)}
          nodeState={getState(i + 1)}
          status={status}
          trigger={step.trigger}
          triggerLabel={formatTrigger(step.trigger)}
          actions={step.actions}
          stepIndex={i}
          isActive={getState(i + 1) === "active"}
          rs={rs}
          onJump={onJump}
          onComplete={onComplete}
        />
      ),
    })),
    {
      key: "end",
      label: "end",
      sublabel:
        endCondition?.trigger?.type === "scheduled"
          ? formatScheduledDate(endCondition.trigger.at)
          : null,
      // Apply-first: the connector before [end] is the last step's hold interval.
      connectorLabel:
        steps.length > 0
          ? formatTrigger(steps[steps.length - 1].trigger)
          : undefined,
      isApproval: false,
      popoverContent: (() => {
        const endNodeIndex = steps.length + 1;
        const hasExplicitEnd = !!endCondition;
        const implicitDisable = !hasExplicitEnd && !!rs.disableRuleAfter;
        return (
          <NodePopoverContent
            heading="End"
            headingColor={nodeLabelColor(getState(endNodeIndex), status)}
            nodeColor={dotColor(getState(endNodeIndex), status)}
            nodeState={getState(endNodeIndex)}
            status={status}
            trigger={endCondition?.trigger ?? null}
            triggerLabel={
              endCondition?.trigger ? (
                formatTrigger(endCondition.trigger)
              ) : (
                <Text size="small">auto</Text>
              )
            }
            actions={endCondition?.actions ?? []}
            syntheticEnabled={implicitDisable ? false : undefined}
            stepIndex="end"
            isActive={getState(endNodeIndex) === "active"}
            rs={rs}
            onJump={onJump}
            onComplete={onComplete}
          />
        );
      })(),
    },
  ];

  const sublabelLine = (text: ReactNode) => (
    <div className={styles.scheduledDateLine}>{text}</div>
  );

  const revisionSublabel = (
    <>
      {sublabelLine(<Text size="small">awaiting publish</Text>)}
      {activatingRevisionVersion != null &&
        sublabelLine(
          <Text size="small">Revision {activatingRevisionVersion}</Text>,
        )}
    </>
  );

  return (
    <Box className={styles.timelineRoot}>
      {/* Single-row timeline */}
      <Box className={styles.timelineScroll}>
        <Flex align="start" className={styles.timelineRow}>
          {/* Pre-timeline indicator: pending detach overrides all other pre-nodes */}
          {pendingDetach ? (
            <>
              <Node
                node={{
                  key: "pending-removal",
                  label: "removal",
                  sublabel: revisionSublabel,
                  isApproval: false,
                  dotColorOverride: "var(--red-9)",
                  labelColorOverride: "var(--red-11)",
                }}
                state="active"
                status={status}
              />
              <Box className={styles.connectorSpacer} />
            </>
          ) : (
            /* Normal pre-timeline indicator node for states where the ramp hasn't started yet */
            (status === "pending" ||
              (status === "ready" &&
                startCondition?.trigger.type === "manual")) && (
              <>
                <Node
                  node={{
                    key: "pre-indicator",
                    label: status === "pending" ? "pending" : "ready",
                    sublabel:
                      status === "pending" ? (
                        revisionSublabel
                      ) : (
                        <Text size="small">awaiting start</Text>
                      ),
                    isApproval: false,
                  }}
                  state="active"
                  status={status}
                />
                <Box className={styles.connectorSpacer} />
              </>
            )
          )}

          {nodes.map((node, i) => (
            <>
              {i > 0 && (
                <Connector
                  key={`conn-${i}`}
                  left={getState(i - 1)}
                  status={status}
                  triggerLabel={
                    getState(i) === "future" ? node.connectorLabel : undefined
                  }
                />
              )}
              <Node
                key={node.key}
                node={node}
                state={getState(i)}
                status={status}
              />
            </>
          ))}
        </Flex>
      </Box>
    </Box>
  );
}
