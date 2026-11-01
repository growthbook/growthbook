import {
  isContextualBanditMeasurementArm,
  MEASUREMENT_ARM_EDITABLE_FIELDS,
} from "shared/experiments";
import { ExperimentInterface } from "shared/types/experiment";
import { BadRequestError } from "back-end/src/util/errors";

const EDITABLE = new Set<string>(MEASUREMENT_ARM_EDITABLE_FIELDS);

export function assertMeasurementArmExperimentEditable(
  experiment: ExperimentInterface,
  changes: Record<string, unknown>,
): void {
  if (!isContextualBanditMeasurementArm(experiment)) return;
  const normalize = (v: unknown) =>
    v === undefined || v === "" || (Array.isArray(v) && v.length === 0)
      ? null
      : JSON.stringify(v);
  const blocked = Object.keys(changes).filter((key) => {
    if (EDITABLE.has(key)) return false;
    const value = changes[key];
    if (value === undefined) return false;
    return (
      normalize(value) !==
      normalize(experiment[key as keyof ExperimentInterface])
    );
  });
  if (blocked.length) {
    throw new BadRequestError(
      `Only secondary and guardrail metrics can be changed on a measurement arm; [${blocked.join(", ")}] follow the Contextual Bandit`,
    );
  }
}

export function assertNotMeasurementArmExperiment(
  experiment: Pick<ExperimentInterface, "type">,
  action: string,
): void {
  if (isContextualBanditMeasurementArm(experiment)) {
    throw new BadRequestError(
      `Cannot ${action}: this experiment measures a Contextual Bandit and is managed from the Bandit`,
    );
  }
}
