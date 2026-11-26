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

const str = (value: unknown) => (typeof value === "string" ? value : "");

// The agent follows the dashboard skills, so most of its work is REST calls.
type Action = { label: string; detail?: string; write?: boolean };

const DRAFT_RE =
  /\/dashboards\/[^/]+\/draft(\/blocks(\/[^/]+)?|\/publish)?\/?$/;
const READ_LABELS: [RegExp, string][] = [
  [/\/data-sources/, "list_sources"],
  [/\/projects/, "list_projects"],
  [/\/fact-metrics/, "list_metrics"],
  [/\/fact-tables/, "read_schema"],
  [/\/metrics/, "list_metrics"],
  [/\/dashboards/, "read_dashboard"],
];

function body(args: Record<string, unknown>): Record<string, unknown> {
  const raw = args.body;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function action(call: BuilderToolCall): Action | null {
  const args = call.args ?? {};
  if (call.toolName === "planDashboard") return { label: "plan", write: true };
  if (call.toolName === "loadSkill") {
    return { label: "load_skill", detail: str(args.name) };
  }
  if (call.toolName !== "callApi") return null;

  const method = str(args.method).toUpperCase();
  const path = str(args.path).split("?")[0];
  const draft = path.match(DRAFT_RE);
  if (draft && method !== "GET") {
    const title = str(body(args).title);
    if (draft[1] === "/publish") return { label: "publish", write: true };
    if (!draft[1]) {
      return body(args).globalControls
        ? { label: "add_filters", detail: "Date range", write: true }
        : { label: "rename", detail: title, write: true };
    }
    if (method === "POST")
      return { label: "add_block", detail: title, write: true };
    if (method === "PUT")
      return { label: "update_block", detail: title, write: true };
    return { label: "remove_block", write: true };
  }
  if (/-exploration\/?$/.test(path) || /\/sql\//.test(path)) {
    return { label: "run_query" };
  }
  if (method === "GET") {
    const hit = READ_LABELS.find(([re]) => re.test(path));
    return { label: hit ? hit[1] : "read", detail: hit ? "" : path };
  }
  return { label: method.toLowerCase(), detail: path, write: true };
}

/** True for a call that changes the dashboard, which is what tags a turn as an edit. */
export const isBuilderWrite = (call: BuilderToolCall) => !!action(call)?.write;

/** The block a running call is adding, for the placeholder shown while it runs. */
export function addingBlockTitle(call: BuilderToolCall): string | null {
  const a = action(call);
  return a?.label === "add_block" ? (a.detail ?? "") : null;
}

type PlannedBlock = { title: string; kind: string };
function plannedBlocks(calls: BuilderToolCall[]): PlannedBlock[] {
  const plan = [...calls].reverse().find((c) => c.toolName === "planDashboard");
  const blocks = plan?.args?.blocks;
  if (!Array.isArray(blocks)) return [];
  return blocks.map((b) => ({ title: str(b?.title), kind: str(b?.kind) }));
}

// The step list: every tool call so far, then the planned blocks not started yet.
export function builderSteps(calls: BuilderToolCall[]): BuilderStep[] {
  const planned = plannedBlocks(calls);
  const kindOf = (title: string) =>
    planned.find((b) => b.title === title)?.kind ?? "";
  const steps: BuilderStep[] = [];
  const started = new Set<string>();
  let planSeen = false;
  for (const call of calls) {
    const a = action(call);
    if (!a) continue;
    let detail = a.detail ?? "";
    if (a.label === "plan") {
      planSeen = true;
      started.clear();
      detail = `${planned.length} ${planned.length === 1 ? "block" : "blocks"}`;
    } else if (a.label === "add_block" || a.label === "update_block") {
      if (a.label === "add_block" && planSeen) started.add(detail);
      detail = [kindOf(detail), detail].filter(Boolean).join(" · ");
    }
    steps.push({ key: call.id, label: a.label, detail, state: call.status });
  }
  if (!planSeen) return steps;
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
  const done = calls
    .filter((c) => c.status === "done")
    .flatMap((c) => action(c) ?? []);
  const of = (label: string) => done.filter((a) => a.label === label);
  const changes: string[] = [];
  const added = of("add_block");
  if (added.length > 3) changes.push(`Added ${added.length} blocks`);
  else added.forEach((a) => changes.push(`Added ${a.detail}`));
  of("update_block").forEach((a) => changes.push(`Updated ${a.detail}`));
  const removed = of("remove_block").length;
  if (removed) {
    changes.push(`Removed ${removed} ${removed === 1 ? "block" : "blocks"}`);
  }
  of("rename").forEach((a) => changes.push(`Renamed to ${a.detail}`));
  if (of("add_filters").length) changes.push("Set filters: Date range");
  return changes;
}

function resultFailed(result: string, isError?: boolean): boolean {
  if (isError) return true;
  try {
    const parsed = JSON.parse(result);
    // callApi reports the HTTP status of the call it made.
    return (
      parsed?.status === "error" ||
      (typeof parsed?.status === "number" && parsed.status >= 400)
    );
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
