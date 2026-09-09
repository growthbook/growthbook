import { EventModel } from "back-end/src/models/EventModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { buildExperimentCardData } from "back-end/src/services/slack/experimentCardData";
import { getFilterDataForNotificationEvent } from "back-end/src/events/handlers/utils";
import type {
  CardState,
  ScorecardData,
  ScorecardNotable,
} from "back-end/src/services/slack/chartImage";
import { logger } from "back-end/src/util/logger";

// The channel's Scope filters, applied to the digest so a scoped channel gets a
// scoped digest (previously digests were always org-wide). `ids` are experiment
// ids (scorecard) or feature ids (feature digest). Metric filtering is a
// live-notification concern and intentionally not applied to periodic digests.
export type SlackDigestFilters = {
  projects: string[];
  tags: string[];
  ids: string[];
};

const anyMatch = (want: string[], has: string[]) =>
  want.length === 0 || has.some((h) => want.includes(h));

// Whether a digest source event passes the channel's project/tag/id filters.
// Event envelope tags/projects mirror how live delivery filters (event-time
// values), keeping digest scope consistent with per-event scope.
export const digestEventPassesFilters = (
  ev: { objectId?: string; data?: unknown },
  filters: SlackDigestFilters,
): boolean => {
  if (
    filters.ids.length &&
    (!ev.objectId || !filters.ids.includes(ev.objectId))
  )
    return false;
  const { tags = [], projects = [] } =
    getFilterDataForNotificationEvent(
      // getFilterDataForNotificationEvent only reads .tags/.projects (with
      // fallbacks), so a loose cast is safe here.
      ev.data as Parameters<typeof getFilterDataForNotificationEvent>[0],
    ) || {};
  return anyMatch(filters.projects, projects) && anyMatch(filters.tags, tags);
};

// Aggregates a trailing window of experiment activity into the ScorecardData the
// program digest renders. Heuristics — an at-a-glance program pulse, not an
// exact audit. The window length is passed in.

const MAX_NOTABLE = 8;

// The notable "category" an experiment lands in this week, most significant
// first (a shipped experiment shows as Won even if it also hit significance).
type Category =
  | "won"
  | "lost"
  | "stopped"
  | "significance"
  | "warning"
  | "started";
const CATEGORY_PRIORITY: Category[] = [
  "won",
  "lost",
  "stopped",
  "significance",
  "warning",
  "started",
];
const CATEGORY_TO_STATE: Record<Category, CardState> = {
  won: "winner",
  lost: "loser",
  stopped: "stopped",
  significance: "running",
  warning: "warning",
  started: "started",
};

function categorize(eventName: string): Category | null {
  switch (eventName) {
    case "experiment.decision.ship":
    case "experiment.stopped.shipped":
      return "won";
    case "experiment.decision.rollback":
    case "experiment.stopped.rolledback":
      return "lost";
    case "experiment.info.significance":
      return "significance";
    case "experiment.warning":
    case "experiment.health.guardrailFailed":
    case "experiment.health.noData":
    case "experiment.health.queryFailed":
      return "warning";
    case "experiment.started":
      return "started";
    default:
      if (eventName.startsWith("experiment.stopped")) return "stopped";
      return null;
  }
}

function fmtDateShort(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
}

/** Human-readable label for a trailing window ending now, e.g. "Jun 8 – Jul 8, 2026". */
export function rangeLabel(start: Date, now: Date): string {
  return `${fmtDateShort(start)} – ${fmtDateShort(now)}, ${now.getUTCFullYear()}`;
}

/**
 * Build the scorecard model for an organization from the trailing `windowMs` of
 * experiment events (+ current running count). `label` is the human-readable
 * period shown in the card header. Returns null when there's nothing worth
 * reporting (no events and nothing running).
 */
export async function buildScorecardData(
  organizationId: string,
  now: Date,
  windowMs: number,
  label: string,
  filters: SlackDigestFilters,
): Promise<ScorecardData | null> {
  const context = await getContextForAgendaJobByOrgId(organizationId);
  const since = new Date(now.getTime() - windowMs);

  const events = await EventModel.find({
    organizationId,
    object: "experiment",
    dateCreated: { $gte: since },
  })
    .sort({ dateCreated: -1 })
    .limit(500)
    .lean<{ event: string; objectId?: string; data?: unknown }[]>();

  // Reduce to the top-priority category per experiment, and count categories.
  const byExperiment = new Map<string, Category>();
  const significant = new Set<string>();
  const shipped = new Set<string>();
  const rolledback = new Set<string>();
  for (const ev of events) {
    if (!digestEventPassesFilters(ev, filters)) continue;
    const experimentId = ev.objectId;
    if (!experimentId) continue;
    const category = categorize(ev.event);
    if (!category) continue;
    if (category === "significance") significant.add(experimentId);
    if (category === "won") shipped.add(experimentId);
    if (category === "lost") rolledback.add(experimentId);
    const current = byExperiment.get(experimentId);
    if (
      !current ||
      CATEGORY_PRIORITY.indexOf(category) < CATEGORY_PRIORITY.indexOf(current)
    ) {
      byExperiment.set(experimentId, category);
    }
  }

  // Scope the running count to the same filters so it's consistent with the
  // filtered notable list (project/tag/id — experiments carry these directly).
  const running = (
    await getAllExperiments(context, { status: "running" })
  ).filter(
    (e) =>
      anyMatch(filters.projects, e.project ? [e.project] : []) &&
      anyMatch(filters.tags, e.tags || []) &&
      (filters.ids.length === 0 || filters.ids.includes(e.id)),
  ).length;

  if (!byExperiment.size && !running) return null;

  const notable: ScorecardNotable[] = [];
  let highlight: ScorecardData["highlight"] | undefined;
  let bestLift = -Infinity;

  for (const [experimentId, category] of byExperiment) {
    if (notable.length >= MAX_NOTABLE) break;
    const state = CATEGORY_TO_STATE[category];
    let name = experimentId;
    let goal = "goal metric";
    let lift: string | null = null;
    let dir: "up" | "down" | undefined;
    try {
      const card = await buildExperimentCardData(context, experimentId);
      if (card) {
        name = card.name;
        goal = card.goal;
        const row = card.rows[0];
        const hasLift =
          category === "won" ||
          category === "lost" ||
          category === "significance";
        if (hasLift && row?.chg && row.dir) {
          lift = row.chg;
          dir = row.dir;
        }
      }
    } catch (e) {
      logger.warn(e, `Scorecard: failed to load card data for ${experimentId}`);
    }

    const note =
      lift !== null
        ? undefined
        : category === "warning"
          ? "Needs attention"
          : category === "stopped"
            ? "Inconclusive"
            : category === "started"
              ? "Started"
              : "Collecting";

    notable.push({ name, state, lift, dir, note });

    if (category === "won" && lift && dir === "up") {
      const value = parseFloat(lift);
      if (!Number.isNaN(value) && value > bestLift) {
        bestLift = value;
        highlight = { name, metric: goal, lift };
      }
    }
  }

  // Cumulative wins year-to-date (footer). Best-effort.
  let cumWins = shipped.size;
  try {
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const ytd = await EventModel.find({
      organizationId,
      object: "experiment",
      event: {
        $in: ["experiment.decision.ship", "experiment.stopped.shipped"],
      },
      dateCreated: { $gte: yearStart },
    }).distinct("objectId");
    cumWins = (ytd as unknown[]).length;
  } catch (e) {
    logger.warn(e, "Scorecard: failed to compute year-to-date wins");
  }

  return {
    week: label,
    stats: {
      running,
      significant: significant.size,
      shipped: shipped.size,
      rolledback: rolledback.size,
    },
    highlight,
    cumWins,
    notable,
  };
}
