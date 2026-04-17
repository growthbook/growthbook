import { Fragment, useState, type ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCheckBold } from "react-icons/pi";
import { format } from "date-fns";
import { abbreviateAgo } from "shared/dates";
import {
  RampScheduleInterface,
  RampScheduleStatus,
  RampStepAction,
  RampTrigger,
} from "shared/validators";
import stringify from "json-stringify-pretty-compact";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import styles from "./RampTimeline.module.scss";

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
export function formatScheduledDate(d: Date | string): ReactNode {
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
  afterCoverage,
}: {
  actions: RampStepAction[];
  syntheticEnabled?: boolean;
  afterCoverage?: ReactNode;
}) {
  const coverageItems: ReactNode[] = [];
  const additionalItems: ReactNode[] = [];

  actions.forEach((action, ai) => {
    const p = action.patch;
    const k = (s: string) => `${ai}-${s}`;

    if (p.coverage !== null && p.coverage !== undefined) {
      coverageItems.push(
        <PopoverEffectRow key={k("cov")} label="Rollout %">
          {Math.round(p.coverage * 100)}%
        </PopoverEffectRow>,
      );
    }
    if ("force" in p && p.force !== undefined) {
      const forceStr =
        p.force === null
          ? "null"
          : typeof p.force === "string"
            ? p.force
            : stringify(p.force as object);
      additionalItems.push(
        <PopoverEffectRow key={k("force")} label="Value">
          <InlineCode language="json" code={forceStr} />
        </PopoverEffectRow>,
      );
    }
    if ("condition" in p) {
      additionalItems.push(
        <PopoverEffectRow key={k("cond")} label="Attribute targeting">
          {p.condition && p.condition !== "{}" ? (
            <ConditionDisplay condition={p.condition} />
          ) : (
            <Text size="small" fontStyle="italic">
              None
            </Text>
          )}
        </PopoverEffectRow>,
      );
    }
    if ("savedGroups" in p) {
      additionalItems.push(
        <PopoverEffectRow key={k("sg")} label="Saved groups">
          {p.savedGroups && p.savedGroups.length > 0 ? (
            <SavedGroupTargetingDisplay savedGroups={p.savedGroups} />
          ) : (
            <Text size="small" fontStyle="italic">
              None
            </Text>
          )}
        </PopoverEffectRow>,
      );
    }
    if ("prerequisites" in p) {
      additionalItems.push(
        <PopoverEffectRow key={k("prereq")} label="Prerequisites">
          {p.prerequisites && p.prerequisites.length > 0 ? (
            <ConditionDisplay prerequisites={p.prerequisites} />
          ) : (
            <Text size="small" fontStyle="italic">
              None
            </Text>
          )}
        </PopoverEffectRow>,
      );
    }
    if (p.enabled === false && syntheticEnabled === undefined) {
      additionalItems.push(
        <PopoverEffectRow key={k("enabled")} label="Rule">
          disabled
        </PopoverEffectRow>,
      );
    } else if (p.enabled === true && syntheticEnabled === undefined) {
      additionalItems.push(
        <PopoverEffectRow key={k("enabled")} label="Rule">
          enabled
        </PopoverEffectRow>,
      );
    }
  });

  if (syntheticEnabled === false) {
    additionalItems.push(
      <PopoverEffectRow key="syn-enabled" label="Rule">
        disabled
      </PopoverEffectRow>,
    );
  } else if (syntheticEnabled === true) {
    additionalItems.push(
      <PopoverEffectRow key="syn-enabled" label="Rule">
        enabled
      </PopoverEffectRow>,
    );
  }

  const hasAdditional = additionalItems.length > 0;
  const items: ReactNode[] = [
    ...coverageItems,
    ...(afterCoverage ? [<Box key="cov-cta">{afterCoverage}</Box>] : []),
    ...(hasAdditional
      ? [
          <Text
            key="additional-header"
            as="div"
            weight="semibold"
            color="text-mid"
            mt="4"
            mb="2"
            size="small"
          >
            Additional Effects
          </Text>,
          ...additionalItems,
        ]
      : []),
  ];

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
  trigger: RampTrigger | null;
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
    !isActive && ["running", "paused", "pending-approval"].includes(rs.status);

  let ctaLabel: string | null = null;
  if (canAct) {
    if (stepIndex === "start") ctaLabel = "Roll back to start";
    else if (stepIndex === "end") ctaLabel = "Complete ramp";
    else ctaLabel = `Jump to Step ${(stepIndex as number) + 1}`;
  }

  const hasCtaHandler = stepIndex === "end" ? !!onComplete : !!onJump;

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
        return { label: "Needs Approval", color: "var(--orange-9)" };
      if (status === "paused")
        return { label: "Paused", color: "var(--amber-11)" };
      return { label: "Running", color: "var(--green-9)" };
    }
    return { label: "Upcoming", color: "var(--gray-12)" };
  })();

  return (
    <Box className={styles.popoverBox}>
      {/* Header */}
      <Flex align="center" gap="2" mb="2">
        <NodeDot state={nodeState} color={nodeColor} status={status} />
        <span style={{ color: headingColor }}>
          <Text weight="medium">
            {heading}
            {nodeState === "active" && (
              <Text as="span" weight="regular">
                {" "}
                (current)
              </Text>
            )}{" "}
            —{" "}
            <span className={styles.popoverStatusLabel}>
              {statusMeta.label}
            </span>
          </Text>
        </span>
      </Flex>

      {stepIndex === "start" ? (
        triggerLabel && (
          <Box mb="2">
            <PopoverEffectRow label="Starts">{triggerLabel}</PopoverEffectRow>
          </Box>
        )
      ) : stepIndex !== "end" ? (
        <Box mb="2">
          <PopoverEffectRow label="Hold">{triggerLabel}</PopoverEffectRow>
        </Box>
      ) : null}

      {isActive &&
        trigger?.type === "interval" &&
        (() => {
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

      <PopoverPatchDisplay
        actions={actions}
        syntheticEnabled={syntheticEnabled}
        afterCoverage={
          ctaLabel && hasCtaHandler ? (
            <Box mt="2" mb="1">
              <Button
                size="xs"
                variant="outline"
                loading={loading}
                onClick={handleCta}
              >
                {ctaLabel}
              </Button>
            </Box>
          ) : undefined
        }
      />
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
  if (state === "future") return "var(--ramp-future-dot)";
  return activeDotColor(status);
}

function nodeLabelColor(state: NodeState, status: RampScheduleStatus): string {
  if (state === "completed") return "var(--violet-12)";
  if (state === "future") return "var(--ramp-future-label)";
  return activeLabelColor(status);
}

function connectorColor(left: NodeState, status: RampScheduleStatus): string {
  if (left === "completed") return "var(--violet-9)";
  if (left === "active") return activeDotColor(status);
  return "var(--ramp-future-connector)";
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
      <Box className={styles.nodeDot} style={{ backgroundColor: color }}>
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
        popperStyle={{ maxWidth: 500 }}
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
  pendingDetach?: boolean;
  onJump?: (targetStepIndex: number) => Promise<void> | void;
  onComplete?: () => Promise<void> | void;
}

// ─── Exported helpers (used by parent pages to build header rows) ─────────────

export function getRampStatusLabel(rs: RampScheduleInterface): string {
  if (rs.status === "ready") {
    return "Scheduled";
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
  pendingDetach,
  onJump,
  onComplete,
}: Props) {
  const { steps, status, startDate, targets } = rs;
  // activatingRevisionVersion is now per-target; find the first target that has one
  const activatingRevisionVersion = targets.find(
    (t) => t.activatingRevisionVersion != null,
  )?.activatingRevisionVersion;
  const doneCount = completedNodeCount(rs);

  function getState(i: number): NodeState {
    if (pendingDetach) return "future";
    if (i < doneCount) return "completed";
    if (status === "pending") return "future";
    if (status === "ready") {
      if (startDate && i === 0) return "active";
      return "future";
    }
    if (i === doneCount && status !== "completed" && status !== "rolled-back")
      return "active";
    return "future";
  }

  const nodes: NodeMeta[] = [
    {
      key: "start",
      label: "start",
      sublabel: startDate ? formatScheduledDate(startDate) : null,
      popoverContent: (
        <NodePopoverContent
          heading="Start"
          headingColor={nodeLabelColor(getState(0), status)}
          nodeColor={dotColor(getState(0), status)}
          nodeState={getState(0)}
          status={status}
          trigger={null}
          triggerLabel={startDate ? formatScheduledDate(startDate) : null}
          actions={[]}
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
      connectorLabel:
        i === 0 ? (
          !startDate ? (
            <Text size="small">auto</Text>
          ) : undefined
        ) : (
          formatTrigger(steps[i - 1].trigger)
        ),
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
      sublabel: null,
      connectorLabel:
        steps.length > 0
          ? formatTrigger(steps[steps.length - 1].trigger)
          : undefined,
      popoverContent: (() => {
        const endNodeIndex = steps.length + 1;
        return (
          <NodePopoverContent
            heading="End"
            headingColor={nodeLabelColor(getState(endNodeIndex), status)}
            nodeColor={dotColor(getState(endNodeIndex), status)}
            nodeState={getState(endNodeIndex)}
            status={status}
            trigger={null}
            triggerLabel={null}
            actions={rs.endActions ?? []}
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
            status === "pending" && (
              <>
                <Node
                  node={{
                    key: "pre-indicator",
                    label: "pending",
                    sublabel: revisionSublabel,
                  }}
                  state="active"
                  status={status}
                />
                <Box className={styles.connectorSpacer} />
              </>
            )
          )}

          {nodes.map((node, i) => (
            <Fragment key={node.key}>
              {i > 0 && (
                <Connector
                  left={getState(i - 1)}
                  status={status}
                  triggerLabel={
                    getState(i) === "future" ? node.connectorLabel : undefined
                  }
                />
              )}
              <Node node={node} state={getState(i)} status={status} />
            </Fragment>
          ))}
        </Flex>
      </Box>
    </Box>
  );
}
