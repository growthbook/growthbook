import type { TrackingUserContext } from "../types/growthbook";
import type { GrowthBook } from "../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../GrowthBookClient";

export const TRACING_TAG_PREFIX = "gb";

export type TracingAssignment = {
  experimentKey: string;
  variationKey: string;
  hashAttribute: string;
  hashValue: string;
  // `${prefix}:${experimentKey}:${variationKey}`
  tag: string;
};

export type TracingPluginOptions = {
  // Called once per unique experiment assignment. Attach `assignment.tag` to
  // the current trace/span in your LLM tracing tool (Langfuse, Phoenix, OTel).
  onAssignment?: (
    assignment: TracingAssignment,
    user: TrackingUserContext,
  ) => void;
  tagPrefix?: string;
};

const TAG_SEPARATOR = ":";

// Tags recorded per instance. WeakMap so a destroyed or garbage-collected
// instance does not pin its tag set in memory.
const tagsByInstance = new WeakMap<object, Set<string>>();

export function tracingPlugin(options: TracingPluginOptions = {}) {
  const prefix = options.tagPrefix || TRACING_TAG_PREFIX;

  return (gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient) => {
    // A bare multi-user client has no assignments of its own. The same plugin
    // is re-run by each UserScopedGrowthBook it creates, which is what we want.
    if ("createScopedInstance" in gb) {
      return;
    }

    const tags = new Set<string>();
    tagsByInstance.set(gb, tags);

    const unsubscribe = gb._subscribeExperimentViewed(
      (experiment, result, user) => {
        const experimentKey = experiment.key;
        const variationKey = result.key;

        // The warehouse SQL splits tags positionally on ":", so a key
        // containing the separator would be parsed incorrectly. Skip it.
        if (
          experimentKey.includes(TAG_SEPARATOR) ||
          variationKey.includes(TAG_SEPARATOR)
        ) {
          return;
        }

        const tag = [prefix, experimentKey, variationKey].join(TAG_SEPARATOR);
        tags.add(tag);

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

// Sorted copy of every tag recorded for this instance so far.
export function getTracingTags(
  gb: GrowthBook | UserScopedGrowthBook,
): string[] {
  const tags = tagsByInstance.get(gb);
  return tags ? Array.from(tags).sort() : [];
}
