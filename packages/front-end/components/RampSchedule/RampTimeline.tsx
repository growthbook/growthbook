import { Fragment, useState, type ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCheckBold } from "react-icons/pi";
import { format } from "date-fns";
import { abbreviateAgo } from "shared/dates";
import {
  isReadyForApproval,
  isAwaitingStartApproval,
  RampScheduleInterface,
  RampScheduleStatus,
  RampStepAction,
  StepHoldConditions,
} from "shared/validators";
import stringify from "json-stringify-pretty-compact";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import MonitoredIcon from "@/components/Features/RuleModal/MonitoredIcon";
import {
  NodeState,
  resolveNodeStatus,
} from "@/components/RampSchedule/rampTimelineStatus";
import styles from "./RampTimeline.module.scss";

// ─── helpers ────────────────────────────────────────────────────────────────

// Renders the step's time/approval gate. Composite steps (interval +
// requiresApproval) show each gate on its own line; pure approval steps
// (interval=null + requiresApproval) show just "approval"; instant steps
// (interval=null, no requiresApproval) show "instant".
export function formatStepGate(
  interval: number | null,
  holdConditions?: StepHoldConditions,
): ReactNode {
  const requiresApproval = !!holdConditions?.requiresApproval;
  if (interval == null) {
    if (requiresApproval)
      return (
        <div style={{ textAlign: "center", lineHeight: 1 }}>
          <div>
            <Text size="small">approval</Text>
          </div>
        </div>
      );
    return (
      <div style={{ textAlign: "center", lineHeight: 1 }}>
        <div>
          <Text size="small">instant</Text>
        </div>
      </div>
    );
  }
  const s = interval;
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
  if (requiresApproval) {
    return (
      <div style={{ textAlign: "center", lineHeight: 1 }}>
        <div>
          <Text size="small">{duration},</Text>
        </div>
        <div>
          <Text size="small">approval</Text>
        </div>
      </div>
    );
  }
  return (
    <div style={{ textAlign: "center", lineHeight: 1 }}>
      <div>
        <Text size="small">{duration}</Text>
      </div>
    </div>
  );
}

// Plain inline string for tooltips/popovers (no multi-line wrapper).
export function formatStepGateInline(
  interval: number | null,
  holdConditions?: StepHoldConditions,
): string {
  const requiresApproval = !!holdConditions?.requiresApproval;
  if (interval == null) return requiresApproval ? "approval" : "instant";
  const s = interval;
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
  return requiresApproval ? `${duration}, approval` : duration;
}

// Scheduled datetime label. Two-line by default (for node sublabels);
// pass `inline` for single-line rendering in popovers.
export function formatScheduledDate(
  d: Date | string,
  { inline }: { inline?: boolean } = {},
): ReactNode {
  const parsed = new Date(d);
  const now = new Date();
  const sameYear = parsed.getFullYear() === now.getFullYear();
  const dateLine = format(parsed, sameYear ? "MMM d" : "MMM d, yyyy");
  const timeLine = format(parsed, "h:mm a");
  if (inline) {
    return (
      <Text size="small">
        {dateLine}, {timeLine}
      </Text>
    );
  }
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
    if (action.targetType !== "feature-rule") return;
    const p = action.patch;
    const k = (s: string) => `${ai}-${s}`;

    if (p.coverage !== null && p.coverage !== undefined) {
      const displayCov = Math.round(p.coverage * 100);
      coverageItems.push(
        <PopoverEffectRow key={k("cov")} label="Rollout %">
          {displayCov}%
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
    if ("allEnvironments" in p || "environments" in p) {
      const allEnvironments = p.allEnvironments === true;
      const selectedEnvironments = p.environments ?? [];
      additionalItems.push(
        <PopoverEffectRow key={k("env-scope")} label="Environments">
          {allEnvironments ? (
            <Text size="small">All environments</Text>
          ) : selectedEnvironments.length > 0 ? (
            <Text size="small">{selectedEnvironments.join(", ")}</Text>
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
  nodeState: NodeState;
  // Step's time gate in seconds (null = no time gate). null is also used for
  // start/end synthetic nodes that aren't backed by a step.
  interval: number | null;
  triggerLabel: ReactNode;
  actions: RampStepAction[];
  syntheticEnabled?: boolean;
  monitored?: boolean;
  holdConditions?: StepHoldConditions;
  stepIndex: number | "start" | "end";
  isActive: boolean;
  rs: RampScheduleInterface;
  onJump?: (targetStepIndex: number) => Promise<void> | void;
  onComplete?: () => Promise<void> | void;
  onCompleteAndDisable?: () => Promise<void> | void;
  isDisableNode?: boolean;
  ctaLabelOverride?: string;
}

function NodePopoverContent({
  heading,
  nodeState,
  interval,
  triggerLabel,
  actions,
  syntheticEnabled,
  monitored,
  holdConditions,
  stepIndex,
  isActive,
  rs,
  onJump,
  onComplete,
  onCompleteAndDisable,
  isDisableNode,
  ctaLabelOverride,
}: NodePopoverContentProps) {
  const [loading, setLoading] = useState(false);

  const canAct = !isActive && ["running", "paused"].includes(rs.status);

  let ctaLabel: string | null = null;
  if (canAct) {
    if (ctaLabelOverride) ctaLabel = ctaLabelOverride;
    else if (stepIndex === "start") ctaLabel = "Roll back to start";
    else if (stepIndex === "end")
      ctaLabel = isDisableNode
        ? "Complete ramp and disable rule"
        : "Complete ramp";
    else ctaLabel = `Jump to Step ${(stepIndex as number) + 1}`;
  }

  const endHandler = isDisableNode ? onCompleteAndDisable : onComplete;
  const hasCtaHandler = stepIndex === "end" ? !!endHandler : !!onJump;

  async function handleCta() {
    setLoading(true);
    try {
      if (stepIndex === "end") {
        await endHandler?.();
      } else if (stepIndex === "start") {
        await onJump?.(-1);
      } else {
        await onJump?.(stepIndex as number);
      }
    } finally {
      setLoading(false);
    }
  }

  const statusVisual = resolveNodeStatus(nodeState, rs, !!monitored);

  return (
    <Box className={styles.popoverBox}>
      {/* Header */}
      <Flex align="center" gap="2" mb="2">
        <NodeDot
          state={nodeState}
          color={statusVisual.dotColor}
          pulse={statusVisual.pulse}
        />
        <span style={{ color: statusVisual.labelColor }}>
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
              {statusVisual.label}
            </span>
          </Text>
        </span>
      </Flex>

      {monitored && (
        <Flex align="center" gap="1" mb="2" style={{ color: "var(--blue-9)" }}>
          <MonitoredIcon size={16} />
          <Text size="small">Monitored</Text>
        </Flex>
      )}

      {stepIndex === "start" ? (
        triggerLabel && (
          <Box mb="2">
            <PopoverEffectRow label="Starts">{triggerLabel}</PopoverEffectRow>
          </Box>
        )
      ) : stepIndex === "end" ? (
        triggerLabel && (
          <Box mb="2">
            <PopoverEffectRow label="Ends">{triggerLabel}</PopoverEffectRow>
          </Box>
        )
      ) : (
        <>
          {interval !== null && interval !== undefined && (
            <Box mb="2">
              <PopoverEffectRow label={monitored ? "Min hold" : "Hold"}>
                <Text size="small">
                  {formatStepGateInline(interval, undefined)}
                </Text>
              </PopoverEffectRow>
            </Box>
          )}
          {interval == null &&
            !holdConditions?.requiresApproval &&
            !holdConditions?.minSampleSize && (
              <Box mb="2">
                <PopoverEffectRow label="Hold">
                  <Text size="small">instant</Text>
                </PopoverEffectRow>
              </Box>
            )}
          {holdConditions?.requiresApproval && (
            <Box mb="2">
              <PopoverEffectRow label="Approval">
                <Text size="small">
                  {isActive &&
                  rs.stepApproval?.stepIndex === rs.currentStepIndex
                    ? "Approved"
                    : isActive
                      ? "Pending"
                      : "Required"}
                </Text>
              </PopoverEffectRow>
            </Box>
          )}
          {!!holdConditions?.minSampleSize && (
            <Box mb="2">
              <PopoverEffectRow label="Min. sample">
                <Text size="small">
                  {holdConditions.minSampleSize.toLocaleString()}
                </Text>
              </PopoverEffectRow>
            </Box>
          )}
        </>
      )}

      {isActive &&
        interval !== null &&
        interval !== undefined &&
        !monitored &&
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

function hasDualEndNodes(rs: RampScheduleInterface): boolean {
  if (!rs.cutoffDate) return false;
  if (rs.steps.length === 0) return false;
  return true;
}

function completedNodeCount(rs: RampScheduleInterface): number {
  const dual = hasDualEndNodes(rs);
  const extra = dual ? 1 : 0;
  if (rs.status === "completed") {
    // When dual end nodes exist and the cutoff date hasn't passed, the
    // disable node wasn't naturally reached by the scheduler. We can't
    // distinguish "complete without disable" from "complete and disable"
    // from the schedule data alone, so we conservatively show the disable
    // node as not-yet-completed until the cutoff passes.
    if (dual && rs.cutoffDate && new Date(rs.cutoffDate) > new Date()) {
      return rs.steps.length + 2;
    }
    return rs.steps.length + 2 + extra;
  }

  if (rs.status === "pending" || rs.status === "ready") return 0;
  return rs.currentStepIndex + 1;
}

// ─── NodeDot ─────────────────────────────────────────────────────────────────

function NodeDot({
  state,
  color,
  pulse = false,
}: {
  state: NodeState;
  color: string;
  pulse?: boolean;
}) {
  return (
    <Box className={styles.dotContainer}>
      {state === "active" && (
        <Box
          className={`${styles.dotRing}${pulse ? ` ${styles.dotRingPulse}` : ""}`}
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
  label: ReactNode;
  sublabel: ReactNode;
  /** Trigger label rendered underneath the connector that leads INTO this node. */
  connectorLabel?: ReactNode;
  monitored?: boolean;
  /** Pre-built popover content — when present, wraps node in a hover popover. */
  popoverContent?: ReactNode;
}

function Node({
  node,
  state,
  dotColor,
  labelColor,
  pulse,
}: {
  node: NodeMeta;
  state: NodeState;
  dotColor: string;
  labelColor: string;
  pulse: boolean;
}) {
  const nodeContent = (
    <Flex direction="column" align="center" className={styles.nodeInner}>
      {/* Dot */}
      <Box my="1">
        <NodeDot state={state} color={dotColor} pulse={pulse} />
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
  color,
  triggerLabel,
}: {
  color: string;
  triggerLabel?: ReactNode;
}) {
  return (
    <Flex direction="column" className={styles.connector}>
      <Box
        className={styles.connectorLine}
        style={{ backgroundColor: color }}
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
  onCompleteAndDisable?: () => Promise<void> | void;
}

// ─── Exported helpers (used by parent pages to build header rows) ─────────────

export function getRampStatusLabel(rs: RampScheduleInterface): string {
  if (rs.status === "ready") {
    return "Scheduled";
  }
  if (isReadyForApproval(rs)) {
    return "Needs Approval";
  }
  const labels: Partial<Record<RampScheduleStatus, string>> = {
    pending: "Schedule Start is Pending",
    running: "Running",
    paused: "Paused",
    completed: "Completed",
    "rolled-back": "Rolled back",
  };
  return labels[rs.status] ?? rs.status;
}

export function getRampBadgeColor(
  rs: Pick<
    RampScheduleInterface,
    | "status"
    | "currentStepIndex"
    | "steps"
    | "stepApproval"
    | "nextStepAt"
    | "currentStepEnteredAt"
  >,
): "amber" | "green" | "orange" | "gray" | "red" {
  if (isReadyForApproval(rs)) return "orange";
  const colors: Record<
    RampScheduleStatus,
    "amber" | "green" | "orange" | "gray" | "red"
  > = {
    pending: "amber",
    ready: "amber",
    running: "green",
    paused: "amber",
    completed: "gray",
    "rolled-back": "red",
  };
  return colors[rs.status] ?? "gray";
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
  onCompleteAndDisable,
}: Props) {
  const { steps, status, startDate, targets } = rs;
  // activatingRevisionVersion is now per-target; find the first target that has one
  const activatingRevisionVersion = targets.find(
    (t) => !!t.activatingRevisionVersion,
  )?.activatingRevisionVersion;
  const doneCount = completedNodeCount(rs);
  const awaitingStartApproval = isAwaitingStartApproval(rs);

  function getState(i: number): NodeState {
    if (pendingDetach) return "future";
    if (i < doneCount) return "completed";
    if (status === "pending") return "future";
    if (status === "ready") {
      // An approval hold parks the playhead at Start until approved.
      if (awaitingStartApproval) return i === 0 ? "active" : "future";
      if (startDate && i === 0) return "active";
      return "future";
    }
    // Rolled-back schedules sit at the Start node (currentStepIndex = -1
    // with effects rewound to the starting position). Mark Start active so
    // the user can see exactly where a Restart will resume from.
    if (status === "rolled-back") return i === 0 ? "active" : "future";
    if (i === doneCount && status !== "completed") return "active";
    return "future";
  }

  // Show the configured startDate on the Start node only while the schedule
  // is still waiting to actually start. `startDate` is a one-shot gate
  // consumed when the schedule first transitions out of pending/ready; the
  // resume path from a rolled-back step -1 also fires step 0 immediately
  // (it doesn't re-arm the startDate hold), so showing the date once we've
  // started would just be stale UI.
  const showStartDate =
    !!startDate && (status === "pending" || status === "ready");
  const startSublabel = showStartDate ? formatScheduledDate(startDate!) : null;
  const startInline = showStartDate
    ? formatScheduledDate(startDate!, { inline: true })
    : null;
  const nodes: NodeMeta[] = [
    {
      key: "start",
      label: "start",
      sublabel: startSublabel,
      popoverContent: (
        <NodePopoverContent
          heading="Start"
          nodeState={getState(0)}
          interval={null}
          triggerLabel={startInline}
          actions={rs.startActions ?? []}
          stepIndex="start"
          isActive={getState(0) === "active"}
          rs={rs}
          onJump={onJump}
          onComplete={onComplete}
        />
      ),
    },
    ...steps.map((step, i) => {
      const state = getState(i + 1);
      return {
        key: `step-${i}`,
        label: step.monitored ? (
          <Flex align="center" gap="1">
            {i + 1}
            <MonitoredIcon size={16} style={{ opacity: 0.65 }} />
          </Flex>
        ) : (
          String(i + 1)
        ),
        sublabel: null,
        monitored: step.monitored,
        connectorLabel:
          i === 0 ? (
            !startDate ? (
              <Text size="small">auto</Text>
            ) : undefined
          ) : (
            formatStepGate(steps[i - 1].interval, steps[i - 1].holdConditions)
          ),
        popoverContent: (
          <NodePopoverContent
            heading={`Step ${i + 1}`}
            nodeState={state}
            interval={step.interval}
            triggerLabel={formatStepGate(step.interval, step.holdConditions)}
            actions={step.actions}
            monitored={step.monitored}
            holdConditions={step.holdConditions}
            stepIndex={i}
            isActive={state === "active"}
            rs={rs}
            onJump={onJump}
            onComplete={onComplete}
          />
        ),
      };
    }),
    ...(() => {
      const dual = hasDualEndNodes(rs);
      const lastStepConnector =
        steps.length > 0
          ? formatStepGate(
              steps[steps.length - 1].interval,
              steps[steps.length - 1].holdConditions,
            )
          : undefined;

      if (dual) {
        const rampEndIdx = steps.length + 1;
        const cutoffIdx = steps.length + 2;
        return [
          {
            key: "end-ramp",
            label: "end",
            sublabel: null,
            connectorLabel: lastStepConnector,
            popoverContent: (
              <NodePopoverContent
                heading="End"
                nodeState={getState(rampEndIdx)}
                interval={null}
                triggerLabel={null}
                actions={rs.endActions ?? []}
                stepIndex="end"
                isActive={getState(rampEndIdx) === "active"}
                rs={rs}
                onJump={onJump}
                onComplete={onComplete}
              />
            ),
          },
          {
            key: "end-cutoff",
            label: "disable",
            sublabel: formatScheduledDate(rs.cutoffDate!),
            popoverContent: (
              <NodePopoverContent
                heading="Disable"
                nodeState={getState(cutoffIdx)}
                interval={null}
                triggerLabel={formatScheduledDate(rs.cutoffDate!, {
                  inline: true,
                })}
                actions={[]}
                stepIndex="end"
                isActive={getState(cutoffIdx) === "active"}
                rs={rs}
                onJump={onJump}
                onCompleteAndDisable={onCompleteAndDisable}
                isDisableNode
              />
            ),
          },
        ];
      }

      const singleDate = rs.cutoffDate ?? null;
      const hasDisableDate = !!singleDate;
      const endNodeIndex = steps.length + 1;
      return [
        {
          key: "end",
          label: hasDisableDate ? "disable" : "end",
          sublabel: singleDate ? formatScheduledDate(singleDate) : null,
          connectorLabel: lastStepConnector,
          popoverContent: (
            <NodePopoverContent
              heading={hasDisableDate ? "Disable" : "End"}
              nodeState={getState(endNodeIndex)}
              interval={null}
              triggerLabel={
                singleDate
                  ? formatScheduledDate(singleDate, { inline: true })
                  : null
              }
              actions={rs.endActions ?? []}
              stepIndex="end"
              isActive={getState(endNodeIndex) === "active"}
              rs={rs}
              onJump={onJump}
              onComplete={onComplete}
              ctaLabelOverride={
                hasDisableDate ? "Complete schedule and disable" : undefined
              }
            />
          ),
        },
      ];
    })(),
  ];

  const sublabelLine = (text: ReactNode) => (
    <div className={styles.scheduledDateLine}>{text}</div>
  );

  const revisionSublabel = (
    <>
      {sublabelLine(<Text size="small">awaiting publish</Text>)}
      {awaitingStartApproval &&
        sublabelLine(<Text size="small">starts on approval</Text>)}
      {!!activatingRevisionVersion &&
        sublabelLine(
          <Text size="small">Revision {activatingRevisionVersion}</Text>,
        )}
    </>
  );

  // Live (published) approval hold: the schedule is "ready" with the rule
  // off until approved. Surface a pre-Start indicator so it reads the same as
  // the draft-preview hold.
  const approvalSublabel = sublabelLine(
    <Text size="small">awaiting approval</Text>,
  );

  // Resolve each node's visuals once, shared by the node and its connector.
  const states = nodes.map((_, i) => getState(i));
  const visuals = nodes.map((node, i) =>
    resolveNodeStatus(states[i], rs, !!node.monitored),
  );
  const pendingVisual = resolveNodeStatus("active", rs, false);

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
                }}
                state="active"
                dotColor="var(--red-9)"
                labelColor="var(--red-11)"
                pulse={false}
              />
              <Box className={styles.connectorSpacer} />
            </>
          ) : (
            /* Normal pre-timeline indicator node for states where the ramp hasn't started yet */
            (status === "pending" ||
              (awaitingStartApproval && status === "ready")) && (
              <>
                <Node
                  node={{
                    key: "pre-indicator",
                    label:
                      awaitingStartApproval && status === "ready"
                        ? "approve"
                        : "pending",
                    sublabel:
                      awaitingStartApproval && status === "ready"
                        ? approvalSublabel
                        : revisionSublabel,
                  }}
                  state="active"
                  dotColor={pendingVisual.dotColor}
                  labelColor={pendingVisual.labelColor}
                  pulse={pendingVisual.pulse}
                />
                <Box className={styles.connectorSpacer} />
              </>
            )
          )}

          {nodes.map((node, i) => (
            <Fragment key={node.key}>
              {i > 0 && (
                <Connector
                  color={visuals[i - 1].connectorColor}
                  triggerLabel={
                    states[i] === "future" ? node.connectorLabel : undefined
                  }
                />
              )}
              <Node
                node={node}
                state={states[i]}
                dotColor={visuals[i].dotColor}
                labelColor={visuals[i].labelColor}
                pulse={visuals[i].pulse}
              />
            </Fragment>
          ))}
        </Flex>
      </Box>
    </Box>
  );
}
