import { z } from "zod";
import { parseDashboardApiPath } from "shared/enterprise";

const dashboardWriteEventSchema = z.object({
  toolName: z.literal("callApi"),
  input: z.object({ method: z.string(), path: z.string() }),
  output: z.object({
    status: z.number(),
    body: z.object({ dashboard: z.object({ id: z.string().min(1) }) }),
  }),
});

/** What a successful `callApi` step did to a dashboard, or null. */
export function dashboardWriteFromEvent(event: {
  type: string;
  data: Record<string, unknown>;
}): { kind: "created" | "updated"; id: string } | null {
  if (event.type !== "tool-call-end") return null;

  const parsed = dashboardWriteEventSchema.safeParse(event.data);
  if (!parsed.success) return null;
  const { input, output } = parsed.data;
  if (output.status < 200 || output.status >= 300) return null;

  const route = parseDashboardApiPath(input.path);
  if (!route) return null;

  const method = input.method.toUpperCase();
  const id = output.body.dashboard.id;
  if (method === "POST" && !route.id) return { kind: "created", id };
  if (method === "PUT" && route.id) return { kind: "updated", id };
  return null;
}
