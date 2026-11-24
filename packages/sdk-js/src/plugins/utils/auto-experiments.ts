import type { GrowthBook } from "../../GrowthBook";
import type {
  AutoExperiment,
  AutoExperimentHandler,
  AutoExperimentRunner,
} from "../../types/growthbook";
import { getAutoExperimentChangeType } from "../../util";
import type { AnyGrowthBook } from "./instance";

function createRunner(gb: GrowthBook): AutoExperimentRunner {
  const active = new Map<
    AutoExperiment,
    { valueHash: string; undo: () => void }
  >();
  const triggered = new Set<string>();

  const run = (experiment: AutoExperiment, forceRerun?: boolean) => {
    const existing = active.get(experiment);

    // If this is a manual experiment and it's not already running, skip
    if (experiment.manual && !triggered.has(experiment.key) && !existing) {
      return null;
    }

    // An experiment with no plugin for its kind of change is blocked
    const handler = runner.handlers[getAutoExperimentChangeType(experiment)];
    const url =
      gb.getUrl() ||
      (typeof window !== "undefined" ? window.location.href : "");
    const { result, trackingCall } = gb._evalAutoExperiment(
      experiment,
      !handler || handler.isBlocked(experiment, url),
    );

    // A hash to quickly tell if the assigned value changed
    const valueHash = JSON.stringify(result.value);

    // If the changes are already active, no need to re-apply them
    if (
      !forceRerun &&
      result.inExperiment &&
      existing &&
      existing.valueHash === valueHash
    ) {
      return result;
    }

    // Undo any existing changes
    if (existing) {
      existing.undo();
      active.delete(experiment);
    }

    // Apply new changes
    if (handler && result.inExperiment) {
      const undo = handler.apply(experiment, result.value, url, trackingCall);
      if (undo) active.set(experiment, { undo, valueHash });
    }

    return result;
  };

  const runner: AutoExperimentRunner = {
    handlers: {},
    redirectUrl: "",
    update(forceRerun) {
      const experiments = gb.getExperiments();

      // Stop any experiments that are no longer defined
      const keys = new Set(experiments);
      active.forEach((v, k) => {
        if (!keys.has(k)) {
          v.undo();
          active.delete(k);
        }
      });

      // Re-run all new/updated experiments
      for (const exp of experiments) {
        const result = run(exp, forceRerun);

        // Once you're in a redirect experiment, break out of the loop and don't run any further experiments
        if (
          result &&
          result.inExperiment &&
          getAutoExperimentChangeType(exp) === "redirect"
        ) {
          break;
        }
      }
    },
    trigger(key) {
      triggered.add(key);
      const results = [];
      for (const exp of gb.getExperiments()) {
        const result = exp.key === key ? run(exp) : null;
        if (result) results.push(result);
      }
      return results;
    },
  };

  gb.onDestroy(() => {
    active.forEach((v) => v.undo());
    active.clear();
    triggered.clear();
  });

  return runner;
}

// visualEditorPlugin and urlRedirectsPlugin share one runner per instance. It
// goes through the experiments in payload order, so a redirect still stops the
// visual experiments that come after it.
export function addAutoExperimentHandler(
  gb: AnyGrowthBook,
  type: "visual" | "redirect",
  createHandler: (
    gb: GrowthBook,
    runner: AutoExperimentRunner,
  ) => AutoExperimentHandler,
) {
  if (!("triggerExperiment" in gb)) {
    throw new Error(
      "Visual editor and URL redirect experiments only run on a GrowthBook instance",
    );
  }
  const runner = (gb._autoExperimentRunner =
    gb._autoExperimentRunner || createRunner(gb));
  runner.handlers[type] = createHandler(gb, runner);
}
