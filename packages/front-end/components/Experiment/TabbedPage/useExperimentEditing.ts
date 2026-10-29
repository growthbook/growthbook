import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { isAnalysisOnly } from "shared/util";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

/**
 * A draft Values experiment's flag holds its setup, not a change to anything
 * live, so the page shows it as the only version until the experiment starts.
 */
export function valuesAreSetup(
  experiment: Pick<
    ExperimentInterfaceStringDates,
    "status" | "implementationType"
  >,
) {
  return (
    experiment.status === "draft" && experiment.implementationType === "values"
  );
}

/**
 * Whether the experiment can be edited, and edited in place: drafts only,
 * unless it is analysis only, where nothing is served from its setup.
 */
export default function useExperimentEditing(
  experiment: ExperimentInterfaceStringDates,
  disableEditing?: boolean,
  holdout?: HoldoutInterfaceStringDates,
) {
  const permissionsUtil = usePermissionsUtil();
  // A holdout's experiment has no project; its scope lives on the holdout.
  const canUpdate = holdout
    ? permissionsUtil.canUpdateHoldout(holdout, { projects: holdout.projects })
    : permissionsUtil.canViewExperimentModal(experiment.project);
  const canEdit = !experiment.archived && canUpdate && !disableEditing;

  const analysisOnly = isAnalysisOnly(experiment);

  return {
    canEdit,
    analysisOnly,
    editInline: canEdit && (experiment.status === "draft" || analysisOnly),
  };
}
