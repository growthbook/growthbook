import {
  EXPERIMENT_PROCESS_RULES_VERSION,
  ProcessChange,
  canJudgeProcess,
  evaluateProcessRules,
  toProcessSnapshot,
} from "shared/enterprise";
import {
  ExperimentInterface,
  auditUserToEventUser,
  eventUserLabel,
} from "shared/validators";
import { AuditInterface } from "shared/types/audit";
import { ReqContext } from "back-end/types/request";
import { findAuditByEntityList } from "back-end/src/models/AuditModel";
import { setExperimentQualityCache } from "back-end/src/models/ExperimentModel";
import { storeQualityScore } from "back-end/src/enterprise/services/experimentQualityScore";

// Audit events that record the experiment before and after the change
const HISTORY_EVENTS = [
  "experiment.update",
  "experiment.status",
  "experiment.phase",
  "experiment.start",
  "experiment.stop",
];

// Each audit entry holds two full experiment snapshots, so history is loaded
// a few experiments at a time
const HISTORY_BATCH_SIZE = 25;

function toProcessChange(audit: AuditInterface): ProcessChange | null {
  let details: unknown;
  try {
    details = audit.details ? JSON.parse(audit.details) : null;
  } catch {
    return null;
  }
  if (!details || typeof details !== "object") return null;
  const { pre: before, post: after } = details as Record<string, unknown>;
  const pre = toProcessSnapshot(before);
  const post = toProcessSnapshot(after);
  if (!pre || !post) return null;
  return {
    date: audit.dateCreated,
    user: eventUserLabel(auditUserToEventUser(audit.user)) || undefined,
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
      const processResults = {
        version: EXPERIMENT_PROCESS_RULES_VERSION,
        dateComputed: new Date(),
        rules: evaluateProcessRules({
          history: historyById.get(experiment.id) ?? [],
          orgSequentialTestingEnabled,
        }),
      };
      await setExperimentQualityCache(context, experiment.id, {
        processResults,
      });
      await storeQualityScore(context, { ...experiment, processResults });
    }
  }
}
