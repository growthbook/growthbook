import { useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import useProjectOptions from "@/hooks/useProjectOptions";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

// Edits only the experiment's project, from the Setup page's rail.
//
// The selector is copied from EditExperimentInfoModal so both behave the
// same: the same permission-filtered options, tooltip, "None" option and
// move warning. That includes its component: the legacy
// components/Forms/SelectField, a FALLBACK. @/ui/Select has no equivalent of
// its initialOption/options API, and the point here is an identical selector.
// Its size prop is left at the default ("legacy", the same as Edit Info),
// since passing size="legacy" explicitly is lint-banned in new code.
//
// With onApply (a draft experiment, set in review), Apply hands the project
// to the Setup page's draft, starting from `initial` (the draft's), and the
// save bar saves it. Without it, Apply saves it straight away.
export default function EditProjectModal({
  experiment,
  close,
  mutate,
  initial,
  onApply,
}: {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  mutate: () => void;
  initial?: string;
  onApply?: (project: string) => void;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const canUpdateExperimentProject = (project: string) =>
    permissionsUtil.canUpdateExperiment({ project }, {});
  const initialProjectOption = canUpdateExperimentProject("") ? "None" : "";

  const startProject = initial ?? (experiment.project || "");
  const [project, setProject] = useState(startProject);

  const options = useProjectOptions(
    (p) => canUpdateExperimentProject(p),
    experiment.project ? [experiment.project] : [],
  );

  return (
    <ModalStandard
      open
      close={close}
      header="Edit Project"
      cta="Apply"
      ctaEnabled={project !== startProject}
      trackingEventModalType="edit-experiment-project"
      trackingEventModalSource="experiment-setup-rail"
      submit={async () => {
        if (onApply) {
          onApply(project);
          return;
        }
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({ project }),
        });
        mutate();
      }}
    >
      <SelectField
        label={
          <>
            <Text weight="semibold">Project</Text>
            <Tooltip
              className="pl-1"
              body={
                "The dropdown below has been filtered to only include projects where you have permission to update Experiments"
              }
            />
          </>
        }
        autoFocus
        value={project}
        onChange={setProject}
        options={options}
        initialOption={initialProjectOption}
      />
      {(experiment.project || "") !== project ? (
        <Callout status="warning">
          Moving to a different Project may prevent your linked Feature Flags,
          Visual Changes, and URL Redirects from being sent to users, and could
          restrict use of some Data Sources and Metrics.
        </Callout>
      ) : null}
    </ModalStandard>
  );
}
