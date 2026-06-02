import Agenda, { Job } from "agenda";
import { dangerousFindContextualBanditsToUpdate } from "back-end/src/enterprise/models/ContextualBanditModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { runContextualBanditSnapshot } from "back-end/src/enterprise/services/contextualBandits";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";

/**
 * Background agenda job for refreshing CB snapshots.
 *
 * Parallel to `updateExperimentResults.ts` but scoped to ContextualBandit
 * docs only. The split mirrors the plan §6 decision: CB refresh cadence,
 * payload-refresh semantics, and failure handling diverge from regular
 * experiments enough that one polymorphic job became too branchy.
 *
 * Per-CB flow:
 *   1. Resolve a per-org agenda context.
 *   2. Look up the parent experiment by the FK on the CB (legacy, still
 *      required because `runContextualBanditSnapshot` accepts an
 *      ExperimentInterface). Once PR-8 lands the orchestrator signature
 *      changes to accept the CB directly, and this lookup goes away.
 *   3. Hand off to the existing CB snapshot orchestrator.
 *
 * Failures: CBs (like multi-armed bandits) have their own lifecycle
 * retry semantics — we log the error and bail without disabling
 * autoSnapshots, matching the bandit-exemption in
 * `updateExperimentResults.ts`.
 */

const QUEUE_CB_RESULTS_UPDATES = "queueContextualBanditUpdates";
const UPDATE_SINGLE_CB = "updateSingleContextualBandit";

type UpdateSingleCBJob = Job<{
  organization: string;
  contextualBanditId: string;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_CB_RESULTS_UPDATES, async () => {
    const cbs = await dangerousFindContextualBanditsToUpdate([]);
    for (const cb of cbs) {
      await queueContextualBanditUpdate(cb.organization, cb.id);
    }
  });

  agenda.define(UPDATE_SINGLE_CB, updateSingleContextualBandit);

  await startUpdateJob();

  async function startUpdateJob() {
    const job = agenda.create(QUEUE_CB_RESULTS_UPDATES, {});
    job.unique({});
    // CBs are intentionally polled more aggressively than experiments —
    // every 10 minutes matches the experiment cadence today and is the
    // safest starting point; we can tighten when the auto-retraining
    // schedule fields land.
    job.repeatEvery("10 minutes");
    await job.save();
  }

  async function queueContextualBanditUpdate(
    organization: string,
    contextualBanditId: string,
  ) {
    const job = agenda.create(UPDATE_SINGLE_CB, {
      organization,
      contextualBanditId,
    }) as UpdateSingleCBJob;
    job.unique({ contextualBanditId, organization });
    job.schedule(new Date());
    await job.save();
  }
}

const updateSingleContextualBandit = async (job: UpdateSingleCBJob) => {
  const cbId = job.attrs.data?.contextualBanditId;
  const orgId = job.attrs.data?.organization;
  if (!cbId || !orgId) return;

  const context = await getContextForAgendaJobByOrgId(orgId);

  const cb = await context.models.contextualBandits.getById(cbId);
  if (!cb) return;

  // Legacy bridge: the snapshot orchestrator currently takes an
  // ExperimentInterface. Look it up via the CB's FK during the
  // decoupling window; PR-8 will refactor the orchestrator to take a
  // CB directly and remove this lookup.
  if (!cb.experiment) {
    logger.warn(
      { contextualBanditId: cbId },
      "CB has no experiment FK; skipping scheduled refresh",
    );
    return;
  }
  const experiment = await getExperimentById(context, cb.experiment);
  if (!experiment) {
    logger.warn(
      { contextualBanditId: cbId, experimentId: cb.experiment },
      "CB parent experiment not found; skipping scheduled refresh",
    );
    return;
  }

  try {
    logger.info("Refreshing results for contextual bandit " + cbId);
    await runContextualBanditSnapshot(
      context,
      experiment,
      experiment.phases.length - 1,
      { triggeredBy: "scheduled" },
    );
    logger.info("Successfully refreshed results for contextual bandit " + cbId);
  } catch (e) {
    // CBs manage their own retry lifecycle (see the bandit exemption in
    // updateExperimentResults.ts); log and bail without disabling.
    logger.error(e, "Failed to update contextual bandit: " + cbId);
  }
};
