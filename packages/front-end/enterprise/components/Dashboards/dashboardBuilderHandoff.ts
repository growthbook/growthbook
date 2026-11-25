import { AIChatMention } from "shared/ai-chat";

// The Empty page creates the draft, then the draft's page starts the build from this.
export interface DashboardBuilderHandoff {
  text: string;
  mentions: AIChatMention[];
  datasourceId: string;
  mode: "build" | "ask";
}

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

export function takeDashboardBuilderHandoff(
  dashboardId: string,
): DashboardBuilderHandoff | null {
  try {
    const stored = sessionStorage.getItem(key(dashboardId));
    if (!stored) return null;
    sessionStorage.removeItem(key(dashboardId));
    const parsed = JSON.parse(stored);
    return typeof parsed?.text === "string" && parsed.text ? parsed : null;
  } catch (e) {
    console.error(e);
    return null;
  }
}
