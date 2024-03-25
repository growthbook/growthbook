import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import MarkdownInlineEdit from "@front-end/components/Markdown/MarkdownInlineEdit";
import { useAuth } from "@front-end/services/auth";
import usePermissions from "@front-end/hooks/usePermissions";
import HeaderWithEdit from "@front-end/components/Layout/HeaderWithEdit";
import VariationsTable from "@front-end/components/Experiment/VariationsTable";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  safeToEdit: boolean;
  editVariations?: (() => void) | null;
  disableEditing?: boolean;
}

export default function SetupTabOverview({
  experiment,
  mutate,
  safeToEdit,
  editVariations,
  disableEditing,
}: Props) {
  const { apiCall } = useAuth();

  const permissions = usePermissions();

  const canCreateAnalyses =
    !disableEditing && permissions.check("createAnalyses", experiment.project);
  const canEditExperiment =
    !experiment.archived && !disableEditing && canCreateAnalyses;

  return (
    <div>
      <div className="pl-1 mb-3">
        <h2>About this test</h2>
      </div>

      <div className="appbox bg-white mb-4 p-3">
        <div>
          <MarkdownInlineEdit
            value={experiment.description ?? ""}
            save={async (description) => {
              await apiCall(`/experiment/${experiment.id}`, {
                method: "POST",
                body: JSON.stringify({ description }),
              });
              mutate();
            }}
            canCreate={canEditExperiment}
            canEdit={canEditExperiment}
            className="mb-3"
            label="description"
            header="Description"
            headerClassName="h4"
          />

          <MarkdownInlineEdit
            value={experiment.hypothesis ?? ""}
            save={async (hypothesis) => {
              await apiCall(`/experiment/${experiment.id}`, {
                method: "POST",
                body: JSON.stringify({ hypothesis }),
              });
              mutate();
            }}
            canCreate={canEditExperiment}
            canEdit={canEditExperiment}
            label="hypothesis"
            header={<>Hypothesis</>}
            headerClassName="h4"
            className="mb-3"
            containerClassName="mb-1"
          />

          <HeaderWithEdit
            edit={editVariations && safeToEdit ? editVariations : undefined}
            containerClassName="mb-2"
            className="h4"
            disabledMessage={
              !safeToEdit &&
              "Cannot edit variations while the experiment is running."
            }
          >
            Variations
          </HeaderWithEdit>
          <div>
            <VariationsTable
              experiment={experiment}
              canEditExperiment={canEditExperiment}
              mutate={mutate}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
