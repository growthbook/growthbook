import isEqual from "lodash/isEqual";
import { Changeset, ExperimentInterface } from "shared/types/experiment";
import { isScheduledToStart } from "shared/util";
import { BadRequestError } from "back-end/src/util/errors";

const LOCKED_KEYS = [
  "trackingKey",
  "hashAttribute",
  "fallbackAttribute",
  "hashVersion",
  "disableStickyBucketing",
  "bucketVersion",
  "minBucketVersion",
  "type",
  "holdoutId",
] as const;

const LOCKED_PHASE_KEYS = [
  "condition",
  "savedGroups",
  "prerequisites",
  "namespace",
  "seed",
  "coverage",
  "variationWeights",
] as const;

// Omitted, empty and off all mean the same thing to what launches.
function normalized(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value) && !value.length) return null;
  if (typeof value === "string" && value.trim() === "{}") return null;
  if (
    typeof value === "object" &&
    "enabled" in value &&
    !(value as { enabled: unknown }).enabled
  ) {
    return null;
  }
  return value;
}

const differs = (a: unknown, b: unknown) =>
  !isEqual(normalized(a), normalized(b));

// The bucketing, targeting and traffic fields a change would alter.
export function scheduledStartLockedFields(
  experiment: ExperimentInterface,
  changes: Changeset,
): string[] {
  const fields: string[] = LOCKED_KEYS.filter(
    (key) => key in changes && differs(changes[key], experiment[key]),
  );

  if (changes.variations) {
    const shape = (variations: ExperimentInterface["variations"]) =>
      variations.map(({ id, key }) => [id, key]);
    if (!isEqual(shape(changes.variations), shape(experiment.variations))) {
      fields.push("variations");
    }
  }

  if (changes.phases) {
    if (changes.phases.length !== experiment.phases.length) {
      fields.push("phases");
    } else {
      const before = experiment.phases[experiment.phases.length - 1];
      const after = changes.phases[changes.phases.length - 1];
      if (before && after) {
        fields.push(
          ...LOCKED_PHASE_KEYS.filter((key) =>
            differs(after[key], before[key]),
          ),
        );
      }
    }
  }

  return fields;
}

// A change that unschedules or starts the experiment passes.
export function assertScheduledStartAllowsChange(
  experiment: ExperimentInterface,
  changes: Changeset,
): void {
  if (!isScheduledToStart(experiment)) return;
  if ("nextScheduledStatusUpdate" in changes) return;
  if ((changes.status ?? experiment.status) !== "draft") return;
  const fields = scheduledStartLockedFields(experiment, changes);
  if (fields.length) {
    throw new BadRequestError(
      `Cannot change: [${fields.join(", ")}] while the experiment's start is scheduled. Unschedule the start first.`,
    );
  }
}

export function assertScheduledStartAllows(
  experiment: Pick<ExperimentInterface, "status" | "nextScheduledStatusUpdate">,
  what: string,
): void {
  if (isScheduledToStart(experiment)) {
    throw new BadRequestError(
      `Cannot change ${what} while the experiment's start is scheduled. Unschedule the start first.`,
    );
  }
}
