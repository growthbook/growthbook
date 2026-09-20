import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

/**
 * Whether the experiment can be edited at all, and whether the setup surfaces
 * should edit in place. They edit in place while it is still a draft and go
 * read-only once it has started.
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

  return { canEdit, editInline: canEdit && experiment.status === "draft" };
}
