import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  DO_NO_HARM_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIA,
} from "shared/enterprise";
import { DecisionCriteriaData } from "shared/types/experiment";

// The presets' English name and description are stored on them and copied
// into custom criteria, so only what they show is translated here.
const PRESET_TEXT: Record<
  string,
  { name: MessageDescriptor; description: MessageDescriptor }
> = {
  [PRESET_DECISION_CRITERIA.id]: {
    name: msg`Clear Signals`,
    description: msg`Ship only with clear goal metric successes and no guardrail failures.`,
  },
  [DO_NO_HARM_DECISION_CRITERIA.id]: {
    name: msg`Do No Harm`,
    description: msg`Ship so long as no guardrails and no goal metrics are failing. Useful if the costs of shipping are very low.`,
  },
};

/** A decision criteria's name and description as shown: a preset's translated, a custom one's as written. */
export function decisionCriteriaText(
  criteria: Pick<DecisionCriteriaData, "id" | "name" | "description">,
  i18n: I18n,
): { name: string; description?: string } {
  const preset = PRESET_TEXT[criteria.id];
  if (!preset) {
    return { name: criteria.name, description: criteria.description };
  }
  return {
    name: i18n._(preset.name),
    description: i18n._(preset.description),
  };
}
