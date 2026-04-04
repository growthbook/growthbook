import type {
  RevisionRampCreateAction,
  RampStep,
  RampStepAction,
} from "shared/validators";
import { validateCustomFieldsForSection } from "back-end/src/util/custom-fields";
import { ApiReqContext } from "back-end/types/api";

export const DRAFT_STATUSES = [
  "draft",
  "pending-review",
  "changes-requested",
  "approved",
] as const;

export function isDraftStatus(status: string): boolean {
  return (DRAFT_STATUSES as readonly string[]).includes(status);
}

/**
 * Build a RevisionRampCreateAction from simple startDate / endDate inputs.
 * - startDate → adds a scheduled step that enables the rule
 * - endDate   → adds an endCondition + endAction that disables the rule
 * ruleId and environment are inferred from the calling context.
 */
export function buildScheduleRampAction(
  ruleId: string,
  environment: string,
  startDate?: string | null,
  endDate?: string | null,
): RevisionRampCreateAction {
  const enableAction: RampStepAction = {
    targetType: "feature-rule",
    targetId: ruleId,
    patch: { ruleId, enabled: true },
  };
  const disableAction: RampStepAction = {
    targetType: "feature-rule",
    targetId: ruleId,
    patch: { ruleId, enabled: false },
  };

  const steps: RampStep[] = startDate
    ? [
        {
          trigger: { type: "scheduled", at: new Date(startDate) },
          actions: [enableAction],
        },
      ]
    : [];

  const action: RevisionRampCreateAction = {
    mode: "create",
    name: "Rule schedule",
    ruleId,
    environment,
    steps,
  };

  if (endDate) {
    action.endCondition = { trigger: { type: "scheduled", at: endDate } };
    action.endActions = [disableAction];
  }

  return action;
}

export const validateCustomFields = async (
  customFieldValues: Record<string, unknown> | undefined,
  context: ApiReqContext,
  project?: string,
) => {
  await validateCustomFieldsForSection({
    customFieldValues,
    customFieldsModel: context.models.customFields,
    section: "feature",
    project,
  });
};
