import { Fragment, useState, type ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCheckBold } from "react-icons/pi";
import { format } from "date-fns";
import { abbreviateAgo } from "shared/dates";
import {
  isReadyForApproval,
  getEffectiveRampStatus,
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
    const k = (s: string) => `${ai}-${s}`;

    if (action.targetType === "experiment") {
      const p = action.patch;

      if (p.coverage !== null && p.coverage !== undefined) {
        coverageItems.push(
          <PopoverEffectRow key={k("cov")} label="Coverage">
            {Math.round(p.coverage * 100)}%
          </PopoverEffectRow>,
        );
      }
      if (p.variationWeights && p.variationWeights.length > 0) {
        additionalItems.push(
          <PopoverEffectRow key={k("weights")} label="Split">
            <Text size="small">
              {p.variationWeights
                .map((w) => `${Math.round(w * 100)}%`)
                .join(" / ")}
            </Text>
          </PopoverEffectRow>,
        );
      }
      if (p.condition !== null && p.condition !== undefined) {
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
      if (p.savedGroups !== null && p.savedGroups !== undefined) {
        additionalItems.push(
          <PopoverEffectRow key={k("sg")} label="Saved groups">
            {p.savedGroups.length > 0 ? (
              <SavedGroupTargetingDisplay savedGroups={p.savedGroups} />
            ) : (
              <Text size="small" fontStyle="italic">
                None
              </Text>
            )}
          </PopoverEffectRow>,
        );
      }
      if (p.prerequisites !== null && p.prerequisites !== undefined) {
        additionalItems.push(
          <PopoverEffectRow key={k("prereq")} label="Prerequisites">
            {p.prerequisites.length > 0 ? (
              <ConditionDisplay prerequisites={p.prerequisites} />
            ) : (
              <Text size="small" fontStyle="italic">
                None
              </Text>
            )}
          </PopoverEffectRow>,
        );
      }
      // Phase / bucketing controls — surface the re-randomization behavior so
      // it's clear which steps reshuffle users vs. update coverage in place.
      const bucketingNotes: string[] = [];
      if (p.newPhase) bucketingNotes.push("New phase");
      if (p.reseed) bucketingNotes.push("Re-seed");
      if (p.bumpBucketVersion) bucketingNotes.push("Re-bucket");
      if (p.blockPriorBucketed) bucketingNotes.push("Exclude prior users");
      if (bucketingNotes.length > 0) {
        additionalItems.push(
          <PopoverEffectRow key={k("phase")} label="Bucketing">
            <Text size="small">{bucketingNotes.join(", ")}</Text>
          </PopoverEffectRow>,
        );
      }
      return;
    }

    if (action.targetType !== "feature-rule") return;
    const p = action.patch;

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
  headingColor: string;
  nodeColor: string;
  nodeState: NodeState;
  status: RampScheduleStatus;
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
  headingColor,
  nodeColor,
  nodeState,
  status,
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

  type StatusMeta = { label: string; color: string };
  const statusMeta: StatusMeta = (() => {
    if (nodeState === "completed")
      return { label: "Completed", color: "var(--violet-9)" };
    if (nodeState === "active") {
      if (isReadyForApproval(rs)) {
        return { label: "Awaiting Approval", color: "var(--orange-9)" };
      }
      if (status === "paused")
        return { label: "Paused", color: "var(--amber-11)" };
      // Not started yet — the schedule is armed but hasn't begun running.
      if (status === "pending" || status === "ready")
        return { label: "Scheduled", color: "var(--amber-9)" };
      if (status === "rolled-back")
        return { label: "Rolled back", color: "var(--red-9)" };
      if (monitored) return { label: "Monitoring", color: "var(--blue-9)" };
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

type NodeState = "completed" | "active" | "future";

function activeDotColor(status: RampScheduleStatus): string {
  if (status === "running") return "var(--green-9)";
  if (status === "pending" || status === "ready" || status === "paused")
    return "var(--amber-9)";
  if (status === "rolled-back") return "var(--gray-8)";
  return "var(--accent-9)";
}

function activeLabelColor(status: RampScheduleStatus): string {
  if (status === "running") return "var(--green-11)";
  if (status === "pending" || status === "ready" || status === "paused")
    return "var(--amber-11)";
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
  label: ReactNode;
  sublabel: ReactNode;
  /** Trigger label rendered underneath the connector that leads INTO this node. */
  connectorLabel?: ReactNode;
  dotColorOverride?: string;
  labelColorOverride?: string;
  /** Force this node's state instead of deriving it from the playhead. */
  stateOverride?: NodeState;
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
  onCompleteAndDisable?: () => Promise<void> | void;
  // Experiment ramps don't carry their start/end on the schedule itself (the
  // experiment's statusUpdateSchedule owns them, and `cutoffDate` is unused).
  // When provided, these drive what the start/end nodes show.
  displayStartDate?: Date | string | null;
  displayEndDate?: Date | string | null;
  // The owning experiment's status (experiment ramps only). Drives the
  // liveness-aware playhead (a draft never shows progress) and the separate
  // "experiment ends" node.
  experimentStatus?: string;
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
    completed: "Complete",
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

// Format a duration (in seconds) as a compact human label, e.g. "2d 3h", "45m".
export function formatRemainingDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const minutes = totalSeconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = totalSeconds / 3600;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const days = totalSeconds / 86400;
  const d = Math.floor(days);
  const h = Math.round((days - d) * 24);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

// Estimate the time and manual approvals left before the ramp completes. Only
// meaningful while running/paused; returns null otherwise.
export function computeRemainingTime(
  rs: RampScheduleInterface,
): { seconds: number; manualApprovals: number } | null {
  if (rs.status !== "running" && rs.status !== "paused") return null;

  let seconds = 0;
  let manualApprovals = 0;

  // The current step can have two holds that clear in sequence: the interval
  // timer first, then a manual approval. Count both remaining components — the
  // time still left on the timer plus the approval, which only becomes
  // actionable once the timer elapses — so the estimate reflects all the work
  // left before the step can advance.
  const currentStep =
    rs.currentStepIndex >= 0 ? rs.steps[rs.currentStepIndex] : undefined;
  const currentNeedsApproval =
    !!currentStep?.holdConditions?.requiresApproval &&
    rs.stepApproval?.stepIndex !== rs.currentStepIndex;
  // nextStepAt is the current step's timer; it is frozen (null) while paused.
  const currentTimerRemainingMs = rs.nextStepAt
    ? new Date(rs.nextStepAt).getTime() - Date.now()
    : 0;
  if (currentNeedsApproval) manualApprovals++;
  if (currentTimerRemainingMs > 0) {
    seconds += Math.ceil(currentTimerRemainingMs / 1000);
  }

  // Future steps still contribute their full interval and approval holds.
  for (let i = rs.currentStepIndex + 1; i < rs.steps.length; i++) {
    const step = rs.steps[i];
    if (step?.interval) {
      seconds += step.interval;
    }
    if (step?.holdConditions?.requiresApproval) {
      manualApprovals++;
    }
  }

  return { seconds, manualApprovals };
}

// ─── RampTimeline ─────────────────────────────────────────────────────────────

export default function RampTimeline({
  rs,
  pendingDetach,
  onJump,
  onComplete,
  onCompleteAndDisable,
  displayStartDate,
  displayEndDate,
  experimentStatus,
}: Props) {
  const { steps, status, startDate, targets } = rs;
  // activatingRevisionVersion is now per-target; find the first target that has one
  const activatingRevisionVersion = targets.find(
    (t) => !!t.activatingRevisionVersion,
  )?.activatingRevisionVersion;
  const doneCount = completedNodeCount(rs);

  // Experiments don't have a rule to "disable" — a cutoff date stops the
  // experiment. Use entity-appropriate wording for the terminal node.
  const isExperiment = rs.entityType === "experiment";

  // Effective start/end shown on the boundary nodes. Callers (experiment ramps)
  // can override since the experiment's scheduled start/stop live outside the
  // schedule; otherwise fall back to the schedule's own dates.
  // Experiments never use the schedule's own startDate/cutoffDate (feature-only)
  // — their boundary dates come from the experiment via the display* props.
  const effectiveStartDate = isExperiment
    ? displayStartDate || null
    : (displayStartDate ?? startDate) || null;
  const effectiveEndDate = isExperiment
    ? displayEndDate || null
    : (displayEndDate ?? rs.cutoffDate) || null;
  const cutoffLabel = isExperiment ? "stop" : "disable";
  const cutoffHeading = isExperiment ? "Stop" : "Disable";

  // For experiment ramps, the playhead is liveness-aware: a not-started
  // experiment sits at the Start node with nothing progressed, even if the
  // stored schedule has a residual step index.
  const expNotStarted =
    isExperiment &&
    !!experimentStatus &&
    getEffectiveRampStatus(experimentStatus, rs) === "not-started";
  const experimentStopped = isExperiment && experimentStatus === "stopped";

  function getState(i: number): NodeState {
    if (pendingDetach) return "future";
    // Liveness-aware: a not-yet-live experiment sits at Start, nothing done.
    if (expNotStarted) return i === 0 ? "active" : "future";
    if (i < doneCount) return "completed";
    if (status === "pending") return "future";
    if (status === "ready") {
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

  // For features, show the configured startDate on the Start node only while
  // the schedule is still waiting to start — `startDate` is a one-shot gate
  // consumed once it starts, so showing it afterward would be stale UI. For
  // experiments the start date is the experiment's actual start, so it stays
  // meaningful (and worth showing) for the whole run.
  const showStartDate =
    !!effectiveStartDate &&
    (isExperiment || status === "pending" || status === "ready");
  const startSublabel = showStartDate
    ? formatScheduledDate(effectiveStartDate!)
    : null;
  const startInline = showStartDate
    ? formatScheduledDate(effectiveStartDate!, { inline: true })
    : null;
  const nodes: NodeMeta[] = [
    {
      key: "start",
      label: "start",
      sublabel: startSublabel,
      popoverContent: (
        <NodePopoverContent
          heading="Start"
          headingColor={nodeLabelColor(getState(0), status)}
          nodeColor={dotColor(getState(0), status)}
          nodeState={getState(0)}
          status={status}
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
        // Experiments are inherently monitored (they're an experiment), so the
        // per-step "monitored" indicator is meaningless noise — hide it.
        label:
          !isExperiment && step.monitored ? (
            <Flex align="center" gap="1">
              {i + 1}
              <MonitoredIcon size={16} style={{ opacity: 0.65 }} />
            </Flex>
          ) : (
            String(i + 1)
          ),
        sublabel: null,
        connectorLabel:
          i === 0 ? (
            !effectiveStartDate ? (
              <Text size="small">auto</Text>
            ) : undefined
          ) : (
            formatStepGate(steps[i - 1].interval, steps[i - 1].holdConditions)
          ),
        popoverContent: (
          <NodePopoverContent
            heading={`Step ${i + 1}`}
            headingColor={nodeLabelColor(state, status)}
            nodeColor={dotColor(state, status)}
            nodeState={state}
            status={status}
            interval={step.interval}
            triggerLabel={formatStepGate(step.interval, step.holdConditions)}
            actions={step.actions}
            monitored={!isExperiment && step.monitored}
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

      // Experiment ramps: the end of the ramp-up and the end of the experiment
      // are two distinct events. Show them as two nodes so it's clear which is
      // which — "ramp ends" (steps complete) then "experiment ends" (the
      // scheduled stop, or a future manual stop when no end date is set). The
      // experiment-end node carries no ramp interval (its connector is blank),
      // signalling it's a separate milestone outside the ramp.
      if (isExperiment) {
        const rampEndIdx = steps.length + 1;
        const expEndState: NodeState = experimentStopped
          ? "completed"
          : "future";
        return [
          {
            key: "ramp-end",
            label: "ramp ends",
            sublabel: null,
            connectorLabel: lastStepConnector,
            popoverContent: (
              <NodePopoverContent
                heading="Ramp ends"
                headingColor={nodeLabelColor(getState(rampEndIdx), status)}
                nodeColor={dotColor(getState(rampEndIdx), status)}
                nodeState={getState(rampEndIdx)}
                status={status}
                interval={null}
                triggerLabel={
                  <Text size="small">
                    Ramp-up complete; experiment continues
                  </Text>
                }
                actions={rs.endActions ?? []}
                stepIndex="end"
                isActive={getState(rampEndIdx) === "active"}
                rs={rs}
              />
            ),
          },
          {
            key: "experiment-end",
            label: "experiment ends",
            sublabel: effectiveEndDate ? (
              formatScheduledDate(effectiveEndDate)
            ) : (
              <Text size="small">when stopped</Text>
            ),
            // Blank connector — this is not a ramp step gate.
            stateOverride: expEndState,
            popoverContent: (
              <NodePopoverContent
                heading="Experiment ends"
                headingColor={nodeLabelColor(expEndState, status)}
                nodeColor={dotColor(expEndState, status)}
                nodeState={expEndState}
                status={status}
                interval={null}
                triggerLabel={
                  effectiveEndDate ? (
                    formatScheduledDate(effectiveEndDate, { inline: true })
                  ) : (
                    <Text size="small">No scheduled end — stops manually</Text>
                  )
                }
                actions={[]}
                stepIndex="end"
                isActive={false}
                rs={rs}
              />
            ),
          },
        ];
      }

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
                headingColor={nodeLabelColor(getState(rampEndIdx), status)}
                nodeColor={dotColor(getState(rampEndIdx), status)}
                nodeState={getState(rampEndIdx)}
                status={status}
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
            label: cutoffLabel,
            sublabel: formatScheduledDate(rs.cutoffDate!),
            popoverContent: (
              <NodePopoverContent
                heading={cutoffHeading}
                headingColor={nodeLabelColor(getState(cutoffIdx), status)}
                nodeColor={dotColor(getState(cutoffIdx), status)}
                nodeState={getState(cutoffIdx)}
                status={status}
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

      const singleDate = effectiveEndDate;
      const hasDisableDate = !!singleDate;
      const endNodeIndex = steps.length + 1;
      return [
        {
          key: "end",
          label: hasDisableDate ? cutoffLabel : "end",
          sublabel: singleDate ? formatScheduledDate(singleDate) : null,
          connectorLabel: lastStepConnector,
          popoverContent: (
            <NodePopoverContent
              heading={hasDisableDate ? cutoffHeading : "End"}
              headingColor={nodeLabelColor(getState(endNodeIndex), status)}
              nodeColor={dotColor(getState(endNodeIndex), status)}
              nodeState={getState(endNodeIndex)}
              status={status}
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
      {!!activatingRevisionVersion &&
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
              <Node
                node={node}
                state={node.stateOverride ?? getState(i)}
                status={status}
              />
            </Fragment>
          ))}
        </Flex>
      </Box>
    </Box>
  );
}
