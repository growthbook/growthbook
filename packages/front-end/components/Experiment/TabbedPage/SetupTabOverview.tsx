import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import { useAuth } from "@/services/auth";
import { PreLaunchChecklist } from "@/components/Experiment/PreLaunchChecklist";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate: () => void;
  editTargeting?: (() => void) | null;
  linkedFeatures: LinkedFeatureInfo[];
  verifiedConnections: SDKConnectionInterface[];
  disableEditing?: boolean;
  checklistItemsRemaining: number | null;
  setChecklistItemsRemaining: (value: number | null) => void;
}

export default function SetupTabOverview({
  experiment,
  visualChangesets,
  mutate,
  editTargeting,
  linkedFeatures,
  verifiedConnections,
  disableEditing,
  checklistItemsRemaining,
  setChecklistItemsRemaining,
}: Props) {
  const { apiCall } = useAuth();

  const permissionsUtil = usePermissionsUtil();

  const canEditExperiment =
    !experiment.archived &&
    permissionsUtil.canViewExperimentModal(experiment.project) &&
    !disableEditing;

  const isBandit = experiment.type === "multi-armed-bandit";

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
          verifiedConnections={verifiedConnections}
          checklistItemsRemaining={checklistItemsRemaining}
          setChecklistItemsRemaining={setChecklistItemsRemaining}
        />
      ) : null}

      <div className="box px-4 py-3">
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
          label="description"
          header="Description"
          headerClassName="h4"
          containerClassName="mb-1"
        />
      </div>

      {!isBandit && (
        <div className="box px-4 py-3">
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
            header="Hypothesis"
            headerClassName="h4"
            containerClassName="mb-1"
          />
        </div>
      )}
    </div>
  );
}
