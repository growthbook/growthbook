import { putContextualBanditPhaseValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireCBPermission } from "./_shared";

export const putContextualBanditPhase = createApiRequestHandler(
  putContextualBanditPhaseValidator,
)(async (req) => {
  if (!req.context.hasPremiumFeature("contextual-bandits")) {
    req.context.throwPlanDoesNotAllowError(
      "Contextual Bandits require an Enterprise plan.",
    );
  }

  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  if (experiment.type !== "contextual-bandit") {
    throw new Error("Experiment is not a contextual bandit");
  }
  // "Updating a phase" counts as running the experiment — the operator is
  // actively reweighting the CB. Mirrors the gate on `postRefresh`.
  requireCBPermission(req.context, experiment, "run");

  const cb = await req.context.models.contextualBandits.getByExperimentId(
    experiment.id,
  );
  if (!cb) {
    throw new Error("Could not find contextual bandit for that experiment");
  }

  const phaseIndex = req.params.phase;
  if (phaseIndex >= cb.phases.length) {
    throw new Error(
      `Phase index ${phaseIndex} is out of range (experiment has ${cb.phases.length} phase(s))`,
    );
  }

  // Apply the (currently single) supported body field. `contexts` and
  // `status` from the original plan are not yet part of the CB phase
  // schema; the body validator rejects them via `.strict()`.
  let updated = cb;
  if (req.body.currentLeafWeights !== undefined) {
    updated = await req.context.models.contextualBandits.patchPhaseWeights(
      cb.id,
      phaseIndex,
      req.body.currentLeafWeights,
    );
  }

  const phase = updated.phases[phaseIndex];
  return {
    phase: {
      index: phaseIndex,
      dateStarted: phase.dateStarted.toISOString(),
      dateEnded: phase.dateEnded ? phase.dateEnded.toISOString() : null,
      currentLeafWeights: phase.currentLeafWeights,
    },
  };
});
