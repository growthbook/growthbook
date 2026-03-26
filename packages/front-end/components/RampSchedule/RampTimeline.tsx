import { type ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCheckBold, PiCaretDownFill } from "react-icons/pi";
import { format } from "date-fns";
import {
  RampScheduleInterface,
  RampScheduleStatus,
  RampTarget,
  RampTrigger,
} from "shared/src/validators/ramp-schedule";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";

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
      <div style={{ lineHeight: 1.2 }}>
        <Text size="small">{dateLine}</Text>
      </div>
      <div style={{ lineHeight: 1.2 }}>
        <Text size="small">{timeLine}</Text>
      </div>
    </>
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
  if (status === "pending-approval" || status === "conflict")
    return "var(--orange-9)";
  if (status === "rolled-back") return "var(--gray-8)";
  return "var(--accent-9)";
}

function activeLabelColor(status: RampScheduleStatus): string {
  if (status === "running") return "var(--green-11)";
  if (status === "pending" || status === "ready" || status === "paused")
    return "var(--amber-11)";
  if (status === "pending-approval" || status === "conflict")
    return "var(--orange-11)";
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

function connectorColor(left: NodeState): string {
  return left === "completed" ? "var(--violet-9)" : "var(--gray-4)";
}

// ─── constants ───────────────────────────────────────────────────────────────

// All dots sit inside a fixed-height container so the connector marginTop is constant.
const DOT_CONTAINER = 15; // px — same height for all nodes
const DOT_SIZE = 15;
// Center the 2px connector line on the dot: container/2 - 1, +4 accounts for my="1" (4px) on the dot container
const CONNECTOR_MARGIN_TOP = DOT_CONTAINER / 2 - 1 + 4;

// ─── Node ────────────────────────────────────────────────────────────────────

interface NodeMeta {
  key: string;
  label: string;
  sublabel: ReactNode;
  isApproval: boolean;
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
  const color = dotColor(state, status);
  const dotSize = DOT_SIZE;
  const labelColor = nodeLabelColor(state, status);

  return (
    <Flex
      direction="column"
      align="center"
      style={{ flexShrink: 0, minWidth: 44 }}
    >
      {/* Dot — fixed-height container keeps all dots on the same baseline */}
      <Box
        my="1"
        style={{
          height: DOT_CONTAINER,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {state === "active" && (
          <>
            {status === "running" && (
              <style>{`
                @keyframes ramp-dot-blip {
                  0%        { transform: scale(1);    opacity: 0; }
                  20%, 60%   { transform: scale(1);    opacity: 0.35; }
                  80%       { transform: scale(1.3);  opacity: 0; }
                  100%      { transform: scale(1.3);  opacity: 0; }
                }
              `}</style>
            )}
            <Box
              style={{
                position: "absolute",
                width: dotSize + 6,
                height: dotSize + 6,
                borderRadius: "50%",
                border: `2px solid ${color}`,
                opacity: 0.35,
                ...(status === "running" && {
                  animation: "ramp-dot-blip 2.5s ease-in-out infinite",
                }),
              }}
            />
          </>
        )}
        <Box
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: "50%",
            backgroundColor: color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {state === "completed" && <PiCheckBold size={11} color="white" />}
        </Box>
      </Box>

      {/* Labels */}
      <Flex
        direction="column"
        justify="center"
        align="center"
        style={{ marginLeft: -5, marginRight: -5, whiteSpace: "nowrap" }}
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
        {node.sublabel}
      </Flex>
    </Flex>
  );
}

const CONNECTOR_WIDTH = 44;

// ─── Connector ───────────────────────────────────────────────────────────────

function Connector({ left }: { left: NodeState }) {
  return (
    <Box
      style={{
        width: CONNECTOR_WIDTH,
        flexShrink: 0,
        height: 2,
        marginTop: CONNECTOR_MARGIN_TOP,
        backgroundColor: connectorColor(left),
        alignSelf: "flex-start",
      }}
    />
  );
}

// ─── RampTimeline ─────────────────────────────────────────────────────────────

interface Props {
  rs: RampScheduleInterface;
  onEditTarget?: (target: RampTarget) => void;
  hideHeader?: boolean;
}

function targetLabel(target: RampTarget, index: number): string {
  const env = target.environment ?? "unknown";
  return `${env} (target ${index + 1})`;
}

// ─── Exported helpers (used by parent pages to build header rows) ─────────────

export function getRampStatusLabel(rs: RampScheduleInterface): string {
  if (rs.status === "ready") {
    return rs.startCondition?.trigger.type === "manual"
      ? "ready to start"
      : "scheduled";
  }
  const labels: Partial<Record<RampScheduleStatus, string>> = {
    pending: "pending",
    running: "running",
    paused: "paused",
    "pending-approval": "needs approval",
    conflict: "conflict",
    completed: "complete",
    "rolled-back": "rolled back",
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
    conflict: "orange",
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

export default function RampTimeline({ rs, onEditTarget, hideHeader }: Props) {
  const { steps, status, startCondition, endCondition, targets } = rs;
  const startTrigger = startCondition?.trigger;
  // activatingRevisionVersion is now per-target; find the first target that has one
  const activatingRevisionVersion = targets.find(
    (t) => t.activatingRevisionVersion != null,
  )?.activatingRevisionVersion;
  const doneCount = completedNodeCount(rs);

  function getState(i: number): NodeState {
    if (i < doneCount) return "completed";
    // "pending": a separate pre-node shows "pending"; all timeline nodes are future.
    // "ready" with "manual": a pre-node shows "ready to start"; timeline nodes are future.
    // "ready" with "scheduled": the "start" node (i=0) is highlighted as active.
    if (status === "pending") return "future";
    if (status === "ready") {
      if (startTrigger?.type === "scheduled" && i === 0) return "active";
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
      sublabel:
        startTrigger?.type === "scheduled" ? (
          formatScheduledDate(startTrigger.at)
        ) : startTrigger?.type === "manual" ? (
          <Text size="small">manual</Text>
        ) : (
          <Text size="small">auto</Text>
        ),
      isApproval: false,
    },
    ...steps.map((step, i) => ({
      key: `step-${i}`,
      label: String(i + 1),
      sublabel: formatTrigger(step.trigger),
      isApproval: step.trigger.type === "approval",
    })),
    {
      key: "end",
      label: "end",
      sublabel:
        endCondition?.trigger?.type === "scheduled" ? (
          formatScheduledDate(endCondition.trigger.at)
        ) : (
          <Text size="small">auto</Text>
        ),
      isApproval: false,
    },
  ];

  const stepsCompleted = getRampStepsCompleted(rs);
  const activeTargets = rs.targets.filter((t) => t.status === "active");

  return (
    <Box style={{ minWidth: 0, overflow: "hidden" }}>
      {!hideHeader && (
        <>
          {/* Header */}
          <Flex align="center" gap="3" mb="2" wrap="wrap">
            <Text weight="medium" size="medium">
              {rs.name}
            </Text>
            {steps.length > 0 &&
              (status === "completed" || status === "rolled-back" ? (
                <Text size="small" color="text-low">
                  ramp complete
                </Text>
              ) : (
                <Text size="small" color="text-low">
                  Step {stepsCompleted} of {steps.length}
                </Text>
              ))}
            <Badge
              label={getRampStatusLabel(rs)}
              color={getRampBadgeColor(status)}
              radius="full"
            />
          </Flex>

          {/* Implementation CTA */}
          {onEditTarget && activeTargets.length === 1 && (
            <Flex align="center" gap="1" mb="2">
              <Text size="small" color="text-low">
                Implementation:
              </Text>
              <Link size="1" onClick={() => onEditTarget(activeTargets[0])}>
                {targetLabel(activeTargets[0], 0)}
              </Link>
            </Flex>
          )}
          {onEditTarget && activeTargets.length > 1 && (
            <Flex align="center" gap="1" mb="2">
              <Text size="small" color="text-low">
                Implementations:
              </Text>
              <DropdownMenu
                trigger={
                  <Link
                    size="1"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    Select implementation ({activeTargets.length} total)
                    <PiCaretDownFill size={10} />
                  </Link>
                }
              >
                {activeTargets.map((t, i) => (
                  <DropdownMenuItem key={t.id} onClick={() => onEditTarget(t)}>
                    {targetLabel(t, i)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenu>
            </Flex>
          )}
        </>
      )}

      {/* Single-row timeline */}
      <Box style={{ overflowX: "auto", padding: "6px 8px" }}>
        <Flex align="start" style={{ width: "fit-content" }}>
          {/* Pre-timeline indicator node for states where the ramp hasn't started yet */}
          {(status === "pending" ||
            (status === "ready" &&
              startCondition?.trigger.type === "manual")) && (
            <>
              <Node
                node={{
                  key: "pre-indicator",
                  label: status === "pending" ? "pending" : "ready",
                  sublabel:
                    status === "pending" ? (
                      <>
                        <div style={{ lineHeight: 1.2 }}>
                          <Text size="small">awaiting publish</Text>
                        </div>
                        {activatingRevisionVersion != null && (
                          <div style={{ lineHeight: 1.2 }}>
                            <Text size="small">
                              Revision {activatingRevisionVersion}
                            </Text>
                          </div>
                        )}
                      </>
                    ) : (
                      <Text size="small">awaiting start</Text>
                    ),
                  isApproval: false,
                }}
                state="active"
                status={status}
              />
              {/* Same-width spacer as a connector but undrawn */}
              <Box
                style={{
                  width: CONNECTOR_WIDTH,
                  flexShrink: 0,
                  marginTop: CONNECTOR_MARGIN_TOP,
                  alignSelf: "flex-start",
                }}
              />
            </>
          )}

          {nodes.map((node, i) => (
            <>
              {i > 0 && <Connector key={`conn-${i}`} left={getState(i - 1)} />}
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
