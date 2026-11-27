import { z } from "zod";
import { aiChatMentionValidator } from "shared/validators";

// The Empty page creates the draft, then the draft's page starts the build from this.
const handoffValidator = z.object({
  text: z.string().min(1),
  mentions: aiChatMentionValidator.array(),
  datasourceId: z.string(),
  mode: z.enum(["build", "ask"]),
});
export type DashboardBuilderHandoff = z.infer<typeof handoffValidator>;

const key = (dashboardId: string) => `dashboard-builder-initial:${dashboardId}`;

export function storeDashboardBuilderHandoff(
  dashboardId: string,
  handoff: DashboardBuilderHandoff,
) {
  try {
    sessionStorage.setItem(key(dashboardId), JSON.stringify(handoff));
  } catch (e) {
    console.error(e);
  }
}

// Read once: a reload must not start the build again.
export function takeDashboardBuilderHandoff(
  dashboardId: string,
): DashboardBuilderHandoff | null {
  try {
    const stored = sessionStorage.getItem(key(dashboardId));
    if (!stored) return null;
    sessionStorage.removeItem(key(dashboardId));
    const parsed: unknown = JSON.parse(stored);
    return handoffValidator.safeParse(parsed).data ?? null;
  } catch (e) {
    console.error(e);
    return null;
  }
}
