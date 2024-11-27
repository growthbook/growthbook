import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { URLRedirectInterface } from "back-end/types/url-redirect";
import React from "react";
import AddLinkedChanges from "@/components/Experiment/LinkedChanges/AddLinkedChanges";
import RedirectLinkedChanges from "@/components/Experiment/LinkedChanges/RedirectLinkedChanges";
import FeatureLinkedChanges from "@/components/Experiment/LinkedChanges/FeatureLinkedChanges";
import VisualLinkedChanges from "@/components/Experiment/LinkedChanges/VisualLinkedChanges";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import VariationsTable from "@/components/Experiment/VariationsTable";
import Tooltip from "@/components/Tooltip/Tooltip";
import TrafficAndTargeting from "@/components/Experiment/TabbedPage/TrafficAndTargeting";
import AnalysisSettings from "@/components/Experiment/TabbedPage/AnalysisSettings";
import Callout from "@/components/Radix/Callout";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  mutate: () => void;
  safeToEdit: boolean;
  editTargeting?: (() => void) | null;
  editVariations?: (() => void) | null;
  setFeatureModal: (open: boolean) => void;
  setVisualEditorModal: (open: boolean) => void;
  setUrlRedirectModal: (open: boolean) => void;
  linkedFeatures: LinkedFeatureInfo[];
  envs: string[];
}

export default function Implementation({
  experiment,
  visualChangesets,
  urlRedirects,
  mutate,
  safeToEdit,
  editTargeting,
  editVariations,
  setFeatureModal,
  setVisualEditorModal,
  setUrlRedirectModal,
  linkedFeatures,
  envs,
}: Props) {
  const phases = experiment.phases || [];

  const permissionsUtil = usePermissionsUtil();

  const canEditExperiment =
    !experiment.archived &&
    permissionsUtil.canViewExperimentModal(experiment.project);

  const hasVisualEditorPermission =
    canEditExperiment && permissionsUtil.canRunExperiment(experiment, []);

  const canAddLinkedChanges =
    hasVisualEditorPermission && experiment.status === "draft";

  const hasLinkedChanges =
    experiment.hasVisualChangesets ||
    linkedFeatures.length > 0 ||
    experiment.hasURLRedirects;

  const showEditVariations = editVariations && safeToEdit;

  return (
    <div className="my-4">
      <h2>Implementation</h2>

      <div className="box my-3 mb-4 px-2 py-3">
        <div className="d-flex flex-row align-items-center justify-content-between text-dark px-3 mb-2">
          <h4 className="m-0">Variations</h4>
          <div className="flex-1" />
          {showEditVariations ? (
            <Tooltip
              shouldDisplay={!safeToEdit}
              body="Cannot edit variations while the experiment is running."
            >
              <button
                className="btn p-0 link-purple"
                disabled={!safeToEdit}
                onClick={editVariations}
              >
                <span className="text-purple">Edit</span>
              </button>
            </Tooltip>
          ) : null}
        </div>

        <VariationsTable
          experiment={experiment}
          canEditExperiment={canEditExperiment}
          mutate={mutate}
        />
      </div>

      {hasLinkedChanges ? (
        <>
          <VisualLinkedChanges
            setVisualEditorModal={setVisualEditorModal}
            visualChangesets={visualChangesets}
            canAddChanges={canAddLinkedChanges}
            canEditVisualChangesets={hasVisualEditorPermission}
            mutate={mutate}
            experiment={experiment}
          />
          <FeatureLinkedChanges
            setFeatureModal={setFeatureModal}
            linkedFeatures={linkedFeatures}
            experiment={experiment}
            canAddChanges={canAddLinkedChanges}
          />
          <RedirectLinkedChanges
            setUrlRedirectModal={setUrlRedirectModal}
            urlRedirects={urlRedirects}
            experiment={experiment}
            canAddChanges={canAddLinkedChanges}
            mutate={mutate}
          />
        </>
      ) : null}

      <AddLinkedChanges
        experiment={experiment}
        numLinkedChanges={0}
        hasLinkedFeatures={linkedFeatures.length > 0}
        setFeatureModal={setFeatureModal}
        setVisualEditorModal={setVisualEditorModal}
        setUrlRedirectModal={setUrlRedirectModal}
      />

      {experiment.status !== "draft" && !hasLinkedChanges ? (
        <Callout status="info" mb="4">
          This experiment has no linked GrowthBook implementation (linked
          feature flag, visual editor changes, or URL redirect).{" "}
          {experiment.status === "stopped"
            ? "Either the implementation was deleted or the implementation, traffic, and targeting were managed by an external system."
            : "The implementation, traffic, and targeting may be managed by an external system."}
        </Callout>
      ) : null}

      <TrafficAndTargeting
        experiment={experiment}
        editTargeting={editTargeting}
        phaseIndex={phases.length - 1}
      />

      <AnalysisSettings experiment={experiment} mutate={mutate} envs={envs} />
    </div>
  );
}
