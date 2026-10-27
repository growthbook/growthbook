import { v4 as uuidv4 } from "uuid";
import { getScopedSettings } from "shared/settings";
import { includeExperimentInPayload } from "shared/util";
import { Changeset, ExperimentInterface } from "shared/types/experiment";
import {
  ChangeAssessment,
  ExperimentChangeType,
  PostExperimentChangesBody,
  ReleasePlan,
  ReleasePlanUnavailableReason,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import {
  assertCanRunExperimentInAffectedEnvironments,
  assertValidBucketVersions,
  assertValidExperimentPhases,
  getExperimentAttributeScopeProjects,
  resetExperimentBanditSettings,
} from "back-end/src/services/experiments";
import { assertRegisteredAttributesScoped } from "back-end/src/services/attributes";
import { assertValidExperimentPrerequisites } from "back-end/src/services/prerequisiteParents";
import { validateChangedPhaseReferences } from "back-end/src/api/features/validations";
import { validateExperimentChange } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import {
  confirmationLink,
  experimentChangeActions,
  pinnedFields,
  requireConfirmation,
} from "back-end/src/services/confirmations";
import {
  BadRequestError,
  InvalidStatusError,
  ReleasePlanNotAllowedError,
  ReleasePlanRequiredError,
} from "back-end/src/util/errors";
import { assessChange, selectReleasePlan } from "./assessChange";
import {
  buildChange,
  currentDelivery,
  deliveryChanged,
  isNewPhasePlan,
  requestedDelivery,
} from "./buildChange";

const CHANGE_PHRASES: Record<ExperimentChangeType, string> = {
  coverage: "Decreasing traffic",
  weights: "Changing variation weights",
  targeting: "This targeting change",
  namespace: "This namespace change",
  "new-phase": "Starting a new phase",
  advanced: "This combination of changes",
};

const code = (s: string) => `\`${s}\``;

function availablePlansText(assessment: ChangeAssessment): string {
  return assessment.releasePlans
    .filter((p) => p.available)
    .map((p) => code(p.plan))
    .join(", ");
}

export function releasePlanRequiredMessage(
  changeType: ExperimentChangeType,
  assessment: ChangeAssessment,
): string {
  return [
    `${CHANGE_PHRASES[changeType]} needs a ${code("releasePlan")}.`,
    ...assessment.risks.map((r) => r.message),
    `Recommended: ${code(assessment.recommendedReleasePlan)}. Resend with a ${code("releasePlan")} from ${code("details.releasePlans")}; add ${code("dryRun: true")} to preview the result.`,
    `See ${assessment.docUrl}`,
  ].join(" ");
}

export function releasePlanNotAllowedMessage({
  changeType,
  plan,
  rejection,
  assessment,
  acceptedUnderAdvanced,
}: {
  changeType: ExperimentChangeType;
  plan: ReleasePlan;
  rejection: ReleasePlanUnavailableReason;
  assessment: ChangeAssessment;
  acceptedUnderAdvanced: boolean;
}): string {
  const recommended = `Recommended: ${code(assessment.recommendedReleasePlan)}.`;
  if (rejection === "requires-sticky-bucketing") {
    return `${code(plan)} needs Sticky Bucketing, which is off for this experiment. Available plans: ${availablePlansText(assessment)}. ${recommended} See ${assessment.docUrl}`;
  }
  if (acceptedUnderAdvanced) {
    return `${code(plan)} isn't offered for a ${code(changeType)} change because it can bias results or switch users' variations. ${recommended} To apply it anyway, resend with ${code('changeType: "advanced"')}; its response lists the risks you accept. See ${assessment.docUrl}`;
  }
  return `${code(plan)} isn't offered for a ${code(changeType)} change on this experiment. Available plans: ${availablePlansText(assessment)}. ${recommended} See ${assessment.docUrl}`;
}

function assertEligible(
  experiment: ExperimentInterface,
  changeType: ExperimentChangeType,
) {
  if (experiment.type === "holdout") {
    throw new BadRequestError(
      "Holdouts are not supported by Make Changes. Use the holdout endpoints instead.",
    );
  }
  if (experiment.archived || experiment.status === "stopped") {
    throw new InvalidStatusError(
      "Make Changes only applies to draft and running experiments.",
      experiment.archived ? "archived" : experiment.status,
      ["draft", "running"],
    );
  }
  if (changeType === "new-phase" && experiment.status === "draft") {
    throw new InvalidStatusError(
      "A draft has no phase to close. Start the experiment instead.",
      experiment.status,
      ["running"],
    );
  }
  if (changeType === "weights" && experiment.type === "multi-armed-bandit") {
    throw new BadRequestError(
      "A Bandit sets its own variation weights. Change its coverage, targeting, or namespace instead.",
    );
  }
}

export type MakeChangesResult = {
  assessment: ChangeAssessment;
  /** The plan applied; null when the change applied in place. */
  releasePlan: ReleasePlan | null;
  experiment: ExperimentInterface;
};

/**
 * Checks, assesses, and (unless `dryRun`) applies one Make Changes request.
 * A dry run fails wherever the real request would, and writes nothing.
 */
export async function makeExperimentChanges(
  context: ReqContext,
  experiment: ExperimentInterface,
  body: PostExperimentChangesBody,
): Promise<MakeChangesResult> {
  const { changeType } = body;
  assertEligible(experiment, changeType);

  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }
  await assertCanRunExperimentInAffectedEnvironments(context, experiment);

  const touched = requestedDelivery(
    body,
    experiment,
    context.org.settings?.namespaces ?? [],
  );
  const current = currentDelivery(experiment);
  const proposed = { ...current, ...touched };
  if (changeType !== "new-phase" && !deliveryChanged(current, proposed)) {
    throw new BadRequestError(
      "Nothing to change: the experiment already has these values.",
    );
  }

  const linkedFeatures = await getFeaturesByIds(
    context,
    experiment.linkedFeatures || [],
  );
  const isBandit = experiment.type === "multi-armed-bandit";
  const stickyBucketing =
    !!context.org.settings?.useStickyBucketing &&
    !experiment.disableStickyBucketing;
  const assessInput = {
    changeType,
    current,
    proposed,
    isBandit,
    stickyBucketing,
    live:
      experiment.status === "running" &&
      includeExperimentInPayload(experiment, linkedFeatures),
  };
  const assessment = assessChange(assessInput);

  const selection = selectReleasePlan(assessment, body.releasePlan);
  if (!selection.ok) {
    if (selection.reason === "required") {
      throw new ReleasePlanRequiredError(
        releasePlanRequiredMessage(changeType, assessment),
        assessment,
      );
    }
    const plan = body.releasePlan as ReleasePlan;
    const acceptedUnderAdvanced = !!assessChange({
      ...assessInput,
      changeType: "advanced",
    }).releasePlans.find((p) => p.plan === plan)?.available;
    throw new ReleasePlanNotAllowedError(
      releasePlanNotAllowedMessage({
        changeType,
        plan,
        rejection: selection.rejection,
        assessment,
        acceptedUnderAdvanced,
      }),
      { ...assessment, requestedPlan: plan, rejection: selection.rejection },
    );
  }
  const plan = selection.plan;
  if (isNewPhasePlan(plan) && experiment.status === "draft") {
    throw new InvalidStatusError(
      "A draft has no phase to close. Drop the releasePlan; changes to a draft apply in place.",
      experiment.status,
      ["running"],
    );
  }

  const lastPhase = experiment.phases[experiment.phases.length - 1];
  await assertRegisteredAttributesScoped(
    context,
    { condition: proposed.condition },
    "experiment",
    { condition: lastPhase?.condition },
    () =>
      getExperimentAttributeScopeProjects(context, experiment, linkedFeatures),
  );
  await validateChangedPhaseReferences(
    [
      {
        condition: proposed.condition,
        savedGroups: proposed.savedGroups,
        prerequisites: proposed.prerequisites,
      },
    ],
    experiment.phases.slice(-1),
    context,
  );
  await assertValidExperimentPrerequisites(
    context,
    proposed.prerequisites,
    lastPhase?.prerequisites,
  );

  const changes: Changeset = buildChange({
    experiment,
    touched,
    plan,
    stickyBucketing,
    newSeed: uuidv4(),
    now: new Date(),
    reason: body.reason,
  });
  if (isBandit) {
    const { settings } = getScopedSettings({
      organization: context.org,
      experiment,
    });
    Object.assign(
      changes,
      resetExperimentBanditSettings({ experiment, changes, settings }),
    );
  }

  // The write re-checks these; running them here keeps a dry run honest.
  if (changes.phases) {
    assertValidExperimentPhases(changes.phases, experiment.phases);
  }
  assertValidBucketVersions({ ...experiment, ...changes }, experiment);
  await validateExperimentChange({ context, experiment, changes });

  if (body.dryRun) {
    return {
      assessment,
      releasePlan: plan,
      experiment: { ...experiment, ...changes },
    };
  }

  const liveActions = experimentChangeActions(experiment, changes);
  await requireConfirmation(context, {
    actions: liveActions.length ? liveActions : ["experiment.draft"],
    project: experiment.project,
    summary: `Make changes to ${experiment.name}`,
    links: [confirmationLink("experiment", experiment.id, experiment.name)],
    pin: [experiment.status, pinnedFields(experiment, changes)],
  });

  // The plan was chosen against this exact state; a concurrent edit retries.
  const updated = await updateExperiment({
    context,
    experiment,
    changes,
    guard: { dateUpdated: experiment.dateUpdated },
  });
  return { assessment, releasePlan: plan, experiment: updated };
}
