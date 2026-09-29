import { ExperimentInterfaceStringDates } from "shared/types/experiment";
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
 * Whether the experiment can be edited at all, and whether the setup surfaces
 * should edit in place. They edit in place while it is still a draft and go
 * read-only once it has started, unless it is analysis only: nothing is served
 * from its setup, so that stays editable.
 */
export default function useExperimentEditing(
  experiment: ExperimentInterfaceStringDates,
  disableEditing?: boolean,
) {
  const permissionsUtil = usePermissionsUtil();
  const canEdit =
    !experiment.archived &&
    permissionsUtil.canViewExperimentModal(experiment.project) &&
    !disableEditing;

  const analysisOnly = isAnalysisOnly(experiment);

  return {
    canEdit,
    analysisOnly,
    editInline: canEdit && (experiment.status === "draft" || analysisOnly),
  };
}
