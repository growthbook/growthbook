import type { TrackingUserContext } from "../types/growthbook";
import type { GrowthBook } from "../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../GrowthBookClient";

// Tags are `gb.<kind>:<key>=<value>`; `gb.feature:` is reserved for flag evaluations.
export const TRACING_TAG_EXPERIMENT_PREFIX = "gb.exp";

export type TracingAssignment = {
  experimentKey: string;
  variationKey: string;
  hashAttribute: string;
  hashValue: string;
  // `gb.exp:${experimentKey}=${variationKey}`
  tag: string;
};

export type TracingPluginOptions = {
  // Called once per unique experiment assignment. Attach `assignment.tag` to
  // the current trace/span in your LLM tracing tool (Langfuse, Phoenix, OTel).
  onAssignment?: (
    assignment: TracingAssignment,
    user: TrackingUserContext,
  ) => void;
};

const KEY_VALUE_SEPARATOR = "=";

// Latest tag per experiment key, per instance. WeakMap so a destroyed or
// garbage-collected instance does not pin its tags in memory.
const tagsByInstance = new WeakMap<object, Map<string, string>>();

export function tracingPlugin(options: TracingPluginOptions = {}) {
  return (gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient) => {
    // A bare multi-user client has no assignments of its own. The same plugin
    // is re-run by each UserScopedGrowthBook it creates, which is what we want.
    if ("createScopedInstance" in gb) {
      return;
    }

    const tags = new Map<string, string>();
    tagsByInstance.set(gb, tags);

    const unsubscribe = gb._subscribeExperimentViewed(
      (experiment, result, user) => {
        const experimentKey = experiment.key;
        const variationKey = result.key;

        // The warehouse SQL splits on the first "=", so only the experiment key must avoid it.
        if (experimentKey.includes(KEY_VALUE_SEPARATOR)) {
          return;
        }

        const tag = `${TRACING_TAG_EXPERIMENT_PREFIX}:${experimentKey}${KEY_VALUE_SEPARATOR}${variationKey}`;
        // A reassignment replaces the old variation; keeping both would read as a multiple exposure.
        tags.set(experimentKey, tag);

        if (options.onAssignment) {
          try {
            options.onAssignment(
              {
                experimentKey,
                variationKey,
                hashAttribute: result.hashAttribute,
                hashValue: result.hashValue,
                tag,
              },
              user,
            );
          } catch (e) {
            console.error(e);
          }
        }
      },
    );

    if ("onDestroy" in gb) {
      gb.onDestroy(() => {
        unsubscribe();
        tagsByInstance.delete(gb);
      });
    }
  };
}

// Sorted current tag for each experiment this instance has assigned.
export function getTracingTags(
  gb: GrowthBook | UserScopedGrowthBook,
): string[] {
  const tags = tagsByInstance.get(gb);
  return tags ? Array.from(tags.values()).sort() : [];
}
