import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { isAnalysisOnly } from "shared/util";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

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

  return {
    canEdit,
    editInline:
      canEdit && (experiment.status === "draft" || isAnalysisOnly(experiment)),
  };
}
