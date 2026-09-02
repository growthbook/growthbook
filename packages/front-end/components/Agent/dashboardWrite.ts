import { z } from "zod";

/** What a completed `callApi` step did to an Analytics dashboard. */
export interface DashboardWrite {
  kind: "created" | "updated";
  id: string;
}

const dashboardWriteEventSchema = z.object({
  toolName: z.literal("callApi"),
  input: z.object({ method: z.string(), path: z.string() }),
  output: z.object({
    status: z.number(),
    body: z.object({ dashboard: z.object({ id: z.string().min(1) }) }),
  }),
});

// The model picks the path it sends and the dispatcher accepts three prefix
// shapes for the same route, so match all of them rather than one.
const CREATE_PATH = /^(?:\/api)?(?:\/v[12])?\/dashboards\/?$/;
const UPDATE_PATH = /^(?:\/api)?(?:\/v[12])?\/dashboards\/[^/]+\/?$/;

/**
 * A successful dashboard write inside a `tool-call-end` event, or null for
 * every other event.
 *
 * The agent panel acts on it twice over: it opens a dashboard the agent just
 * created, which is what gives the next turn its page context, and it drops the
 * cached copy of one the agent changed, which the dashboard page is otherwise
 * holding from before the write.
 */
export function dashboardWriteFromEvent(event: {
  type: string;
  data: Record<string, unknown>;
}): DashboardWrite | null {
  if (event.type !== "tool-call-end") return null;

  const parsed = dashboardWriteEventSchema.safeParse(event.data);
  if (!parsed.success) return null;
  const { input, output } = parsed.data;
  if (output.status < 200 || output.status >= 300) return null;

  const path = input.path.split("?")[0];
  const method = input.method.toUpperCase();
  const id = output.body.dashboard.id;

  if (method === "POST" && CREATE_PATH.test(path)) {
    return { kind: "created", id };
  }
  if (method === "PUT" && UPDATE_PATH.test(path)) {
    return { kind: "updated", id };
  }
  return null;
}

/** Where a dashboard lives in the app. */
export function dashboardPath(id: string): string {
  return `/product-analytics/dashboards/${id}`;
}
