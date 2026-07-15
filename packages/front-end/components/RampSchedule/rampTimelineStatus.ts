import { isReadyForApproval } from "shared/validators";

// Single source of truth: a timeline node's status → label + colors. The dot,
// label, connector, and popover all resolve here so they can't drift apart.

// Minimal schedule shape the derivation needs; tracks isReadyForApproval's input.
type StatusSchedule = Parameters<typeof isReadyForApproval>[0];

export type NodeState = "completed" | "active" | "future";

export type NodeStatusToken =
  | "completed"
  | "awaiting-approval"
  | "monitoring"
  | "running"
  | "paused"
  | "scheduled"
  | "rolled-back"
  | "future";

export interface NodeStatusVisual {
  token: NodeStatusToken;
  label: string;
  dotColor: string;
  labelColor: string;
  // Color of the connector segment leaving this node.
  connectorColor: string;
  // Only live states pulse; holds, pauses, and stops are static.
  pulse: boolean;
}

const FUTURE_CONNECTOR = "var(--ramp-future-connector)";

const STATUS_VISUALS: Record<
  NodeStatusToken,
  Omit<NodeStatusVisual, "token">
> = {
  completed: {
    label: "Completed",
    dotColor: "var(--violet-9)",
    labelColor: "var(--violet-12)",
    connectorColor: "var(--violet-9)",
    pulse: false,
  },
  // Approval is a hard stop — outgoing edge stays gray so it doesn't read as
  // "already advanced"; the orange dot + "approval" label carry the signal.
  "awaiting-approval": {
    label: "Needs Approval",
    dotColor: "var(--orange-9)",
    labelColor: "var(--orange-11)",
    connectorColor: FUTURE_CONNECTOR,
    pulse: false,
  },
  monitoring: {
    label: "Monitoring",
    dotColor: "var(--blue-9)",
    labelColor: "var(--blue-11)",
    connectorColor: "var(--blue-9)",
    pulse: true,
  },
  running: {
    label: "Running",
    dotColor: "var(--green-9)",
    labelColor: "var(--green-11)",
    connectorColor: "var(--green-9)",
    pulse: true,
  },
  paused: {
    label: "Paused",
    dotColor: "var(--amber-9)",
    labelColor: "var(--amber-11)",
    connectorColor: "var(--amber-9)",
    pulse: false,
  },
  scheduled: {
    label: "Scheduled",
    dotColor: "var(--amber-9)",
    labelColor: "var(--amber-11)",
    connectorColor: "var(--amber-9)",
    pulse: false,
  },
  "rolled-back": {
    label: "Rolled back",
    dotColor: "var(--gray-8)",
    labelColor: "var(--gray-10)",
    connectorColor: "var(--gray-8)",
    pulse: false,
  },
  future: {
    label: "Upcoming",
    dotColor: "var(--ramp-future-dot)",
    labelColor: "var(--ramp-future-label)",
    connectorColor: FUTURE_CONNECTOR,
    pulse: false,
  },
};

export function nodeStatusToken(
  nodeState: NodeState,
  rs: StatusSchedule,
  monitored: boolean,
): NodeStatusToken {
  if (nodeState === "completed") return "completed";
  if (nodeState === "future") return "future";

  // Approval is the top-priority active hold, mirroring the rule badge.
  if (isReadyForApproval(rs)) return "awaiting-approval";
  switch (rs.status) {
    case "running":
      return monitored ? "monitoring" : "running";
    case "paused":
      return "paused";
    case "pending":
    case "ready":
      return "scheduled";
    case "rolled-back":
      return "rolled-back";
    // Unknown/stale status: fall back to a neutral, non-live state rather than
    // a pulsing green/blue that implies healthy progress.
    default:
      return "scheduled";
  }
}

export function resolveNodeStatus(
  nodeState: NodeState,
  rs: StatusSchedule,
  monitored: boolean,
): NodeStatusVisual {
  const token = nodeStatusToken(nodeState, rs, monitored);
  return { token, ...STATUS_VISUALS[token] };
}
