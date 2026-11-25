import type { AIChatMessage } from "shared/ai-chat";

export type BuilderToolCall = {
  id: string;
  toolName: string;
  args?: Record<string, unknown>;
  status: "running" | "done" | "error";
};

export type BuilderStep = {
  key: string;
  label: string;
  detail: string;
  state: "pending" | "running" | "done" | "error";
};

const WRITE_TOOLS = new Set([
  "planDashboard",
  "setFilters",
  "addBlock",
  "updateBlock",
  "removeBlock",
]);
export const isBuilderWriteTool = (toolName: string) =>
  WRITE_TOOLS.has(toolName);

const STEP_LABELS: Record<string, string> = {
  search: "search",
  getAvailableColumns: "read_columns",
  getColumnValues: "read_values",
  runExploration: "run_query",
  getSnapshot: "read_result",
  getDashboard: "read_dashboard",
  planDashboard: "plan",
  setFilters: "add_filters",
  addBlock: "add_block",
  updateBlock: "update_block",
  removeBlock: "remove_block",
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

type PlannedBlock = { title: string; kind: string };
function plannedBlocks(calls: BuilderToolCall[]): PlannedBlock[] {
  const plan = [...calls].reverse().find((c) => c.toolName === "planDashboard");
  const blocks = plan?.args?.blocks;
  if (!Array.isArray(blocks)) return [];
  return blocks.map((b) => ({ title: str(b?.title), kind: str(b?.kind) }));
}

function detail(call: BuilderToolCall, planned: PlannedBlock[]): string {
  const args = call.args ?? {};
  switch (call.toolName) {
    case "search":
      return str(args.query) || "metrics and fact tables";
    case "planDashboard":
      return planned.length
        ? `${planned.length} ${planned.length === 1 ? "block" : "blocks"}`
        : "";
    case "setFilters":
      return "Date range";
    case "addBlock":
    case "updateBlock": {
      const title = str(args.title);
      const kind = planned.find((b) => b.title === title)?.kind;
      return [kind, title].filter(Boolean).join(" · ");
    }
    default:
      return "";
  }
}

// The step list: every tool call so far, then the planned blocks not started yet.
export function builderSteps(calls: BuilderToolCall[]): BuilderStep[] {
  const planned = plannedBlocks(calls);
  const steps: BuilderStep[] = calls.map((call) => ({
    key: call.id,
    label: STEP_LABELS[call.toolName] ?? call.toolName,
    detail: detail(call, planned),
    state: call.status,
  }));
  const planIndex = calls.map((c) => c.toolName).lastIndexOf("planDashboard");
  if (planIndex === -1) return steps;
  const started = new Set(
    calls
      .slice(planIndex + 1)
      .filter((c) => c.toolName === "addBlock")
      .map((c) => str(c.args?.title)),
  );
  planned
    .filter((b) => !started.has(b.title))
    .forEach((b, i) =>
      steps.push({
        key: `planned-${i}`,
        label: "add_block",
        detail: [b.kind, b.title].filter(Boolean).join(" · "),
        state: "pending",
      }),
    );
  return steps;
}

export function builderChanges(calls: BuilderToolCall[]): string[] {
  const done = calls.filter((c) => c.status === "done");
  const added = done.filter((c) => c.toolName === "addBlock");
  const changes: string[] = [];
  if (added.length > 3) changes.push(`Added ${added.length} blocks`);
  else added.forEach((c) => changes.push(`Added ${str(c.args?.title)}`));
  done
    .filter((c) => c.toolName === "updateBlock")
    .forEach((c) => changes.push(`Updated ${str(c.args?.title)}`));
  const removed = done.filter((c) => c.toolName === "removeBlock").length;
  if (removed) {
    changes.push(`Removed ${removed} ${removed === 1 ? "block" : "blocks"}`);
  }
  if (done.some((c) => c.toolName === "setFilters")) {
    changes.push("Set filters: Date range");
  }
  return changes;
}

function resultFailed(result: string, isError?: boolean): boolean {
  if (isError) return true;
  try {
    return JSON.parse(result)?.status === "error";
  } catch {
    return false;
  }
}

// Tool calls of one finished assistant turn, in the order the model made them.
export function toolCallsFromMessages(
  msgs: AIChatMessage[],
): BuilderToolCall[] {
  const failed = new Map<string, boolean>();
  for (const msg of msgs) {
    if (msg.role !== "tool") continue;
    for (const part of msg.content) {
      failed.set(part.toolCallId, resultFailed(part.result, part.isError));
    }
  }
  const calls: BuilderToolCall[] = [];
  for (const msg of msgs) {
    if (msg.role !== "assistant" || typeof msg.content === "string") continue;
    for (const part of msg.content) {
      if (part.type !== "tool-call") continue;
      calls.push({
        id: part.toolCallId,
        toolName: part.toolName,
        args: part.args,
        status: failed.get(part.toolCallId) ? "error" : "done",
      });
    }
  }
  return calls;
}
