import {
  EXPERIMENT_PROCESS_RULES_VERSION,
  ProcessChange,
  canJudgeProcess,
  evaluateProcessRules,
  toProcessSnapshot,
} from "shared/enterprise";
import { ExperimentInterface } from "shared/validators";
import { AuditInterface } from "shared/types/audit";
import { ReqContext } from "back-end/types/request";
import { findAuditByEntityList } from "back-end/src/models/AuditModel";
import { updateExperiment } from "back-end/src/models/ExperimentModel";

// Audit events that record the experiment before and after the change
const HISTORY_EVENTS = [
  "experiment.update",
  "experiment.status",
  "experiment.phase",
  "experiment.start",
];

// Each audit entry holds two full experiment snapshots, so history is loaded
// a few experiments at a time
const HISTORY_BATCH_SIZE = 25;

function describeUser(user: AuditInterface["user"]): string | undefined {
  if ("system" in user) return "GrowthBook";
  if ("apiKey" in user) return user.name || "An API key";
  return user.name || user.email;
}

function toProcessChange(audit: AuditInterface): ProcessChange | null {
  let details: { pre?: unknown; post?: unknown };
  try {
    details = audit.details ? JSON.parse(audit.details) : {};
  } catch {
    return null;
  }
  const pre = toProcessSnapshot(details.pre);
  const post = toProcessSnapshot(details.post);
  if (!pre || !post) return null;
  return {
    date: audit.dateCreated,
    user: describeUser(audit.user),
    pre,
    post,
  };
}

// Judges each experiment's change history and caches the results on it
export async function computeAndStoreProcessResults(
  context: ReqContext,
  experiments: ExperimentInterface[],
): Promise<void> {
  if (!context.hasPremiumFeature("experiment-quality-score")) return;
  const judgeable = experiments.filter(canJudgeProcess);
  const orgSequentialTestingEnabled =
    !!context.org.settings?.sequentialTestingEnabled;

  for (let i = 0; i < judgeable.length; i += HISTORY_BATCH_SIZE) {
    const batch = judgeable.slice(i, i + HISTORY_BATCH_SIZE);
    const audits = await findAuditByEntityList(
      context.org.id,
      "experiment",
      batch.map((e) => e.id),
      { event: { $in: HISTORY_EVENTS } },
      { sort: { dateCreated: 1 } },
    );
    const historyById = new Map<string, ProcessChange[]>();
    for (const audit of audits) {
      const change = toProcessChange(audit);
      if (!change) continue;
      const history = historyById.get(audit.entity.id) ?? [];
      history.push(change);
      historyById.set(audit.entity.id, history);
    }

    for (const experiment of batch) {
      await updateExperiment({
        context,
        experiment,
        changes: {
          processResults: {
            version: EXPERIMENT_PROCESS_RULES_VERSION,
            dateComputed: new Date(),
            rules: evaluateProcessRules({
              history: historyById.get(experiment.id) ?? [],
              orgSequentialTestingEnabled,
            }),
          },
        },
        bypassWebhooks: true,
      });
    }
  }
}
