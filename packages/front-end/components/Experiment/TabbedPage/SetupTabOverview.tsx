import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import VariationsTable from "../VariationsTable";
import { PreLaunchChecklist } from "../PreLaunchChecklist";
import { ExperimentTab } from ".";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate: () => void;
  safeToEdit: boolean;
  editTargeting?: (() => void) | null;
  setTab: (tab: ExperimentTab) => void;
  editVariations?: (() => void) | null;
  linkedFeatures: LinkedFeatureInfo[];
  connections: SDKConnectionInterface[];
  disableEditing?: boolean;
}

export default function SetupTabOverview({
  experiment,
  visualChangesets,
  mutate,
  setTab,
  editTargeting,
  safeToEdit,
  editVariations,
  linkedFeatures,
  connections,
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
      <h2>Overview</h2>
      {experiment.status === "draft" ? (
        <PreLaunchChecklist
          experiment={experiment}
          mutateExperiment={mutate}
          linkedFeatures={linkedFeatures}
          visualChangesets={visualChangesets}
          editTargeting={editTargeting}
          connections={connections}
        />
      ) : null}
      <div className="appbox bg-white my-2 mb-4 p-3">
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
