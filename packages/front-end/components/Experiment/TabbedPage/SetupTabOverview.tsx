import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import React from "react";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { PreLaunchChecklist } from "@/components/Experiment/PreLaunchChecklist";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ExperimentDescription from "./ExperimentDescription";
import ExperimentHypothesis from "./ExperimentHypothesis";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate: () => void;
  editTargeting?: (() => void) | null;
  linkedFeatures: LinkedFeatureInfo[];
  matchingConnections: SDKConnectionInterface[];
  disableEditing?: boolean;
  checklistItemsRemaining: number | null;
  setChecklistItemsRemaining: (value: number | null) => void;
  envs: string[];
}

export default function SetupTabOverview({
  experiment,
  visualChangesets,
  mutate,
  editTargeting,
  linkedFeatures,
  matchingConnections,
  disableEditing,
  checklistItemsRemaining,
  setChecklistItemsRemaining,
  envs,
}: Props) {
  const permissionsUtil = usePermissionsUtil();

  const canEditExperiment =
    !experiment.archived &&
    permissionsUtil.canViewExperimentModal(experiment.project) &&
    !disableEditing;

  const isBandit = experiment.type === "multi-armed-bandit";

  return (
    <>
      <div>
        <h2>Overview</h2>
        {experiment.status === "draft" ? (
          <PreLaunchChecklist
            experiment={experiment}
            envs={envs}
            mutateExperiment={mutate}
            linkedFeatures={linkedFeatures}
            visualChangesets={visualChangesets}
            editTargeting={editTargeting}
            connections={matchingConnections}
            checklistItemsRemaining={checklistItemsRemaining}
            setChecklistItemsRemaining={setChecklistItemsRemaining}
          />
        ) : null}
        <ExperimentDescription
          experiment={experiment}
          canEditExperiment={canEditExperiment}
          mutate={mutate}
        />

        {!isBandit && (
          <ExperimentHypothesis
            experiment={experiment}
            canEditExperiment={canEditExperiment}
            mutate={mutate}
          />
        )}
        <CustomFieldDisplay
          target={experiment}
          canEdit={canEditExperiment}
          mutate={mutate}
          section="experiment"
        />
      </div>
    </>
  );
}
