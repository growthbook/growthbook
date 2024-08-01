import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import React from "react";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import { useAuth } from "@/services/auth";
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import { PreLaunchChecklist } from "@/components/Experiment/PreLaunchChecklist";
import VariationsTable from "@/components/Experiment/VariationsTable";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate: () => void;
  safeToEdit: boolean;
  editTargeting?: (() => void) | null;
  editVariations?: (() => void) | null;
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
  safeToEdit,
  editVariations,
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
          <CustomFieldDisplay
            target={experiment}
            canEdit={canEditExperiment}
            mutate={mutate}
            section="experiment"
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
