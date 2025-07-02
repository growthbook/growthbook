import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { URLRedirectInterface } from "back-end/types/url-redirect";
import React, { useState } from "react";
import { Heading } from "@radix-ui/themes";
import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { FeatureInterface } from "back-end/types/feature";
import AddLinkedChanges from "@/components/Experiment/LinkedChanges/AddLinkedChanges";
import RedirectLinkedChanges from "@/components/Experiment/LinkedChanges/RedirectLinkedChanges";
import FeatureLinkedChanges from "@/components/Experiment/LinkedChanges/FeatureLinkedChanges";
import VisualLinkedChanges from "@/components/Experiment/LinkedChanges/VisualLinkedChanges";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import VariationsTable from "@/components/Experiment/VariationsTable";
import TrafficAndTargeting from "@/components/Experiment/TabbedPage/TrafficAndTargeting";
import AnalysisSettings from "@/components/Experiment/TabbedPage/AnalysisSettings";
import Callout from "@/components/Radix/Callout";
import Button from "@/components/Radix/Button";
import { Tabs, TabsList, TabsTrigger } from "@/components/Radix/Tabs";
import LinkedExperimentsTable from "@/components/Holdout/LinkedExperimentsTable";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterface;
  holdoutFeatures?: FeatureInterface[];
  holdoutExperiments?: ExperimentInterfaceStringDates[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  mutate: () => void;
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
  holdout,
  holdoutFeatures,
  holdoutExperiments,
  visualChangesets,
  urlRedirects,
  mutate,
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

  const showEditVariations = editVariations;

  const [tab, setTab] = useState<"experiments" | "features">("experiments");

  return (
    <div className="my-4">
      <h2>Implementation</h2>
      {experiment.type !== "holdout" && (
        <div className="box my-3 mb-4 px-2 py-3">
          <div className="d-flex flex-row align-items-center justify-content-between text-dark px-3 mb-3">
            <Heading as="h4" size="3" mb="0">
              Variations
            </Heading>
            <div className="flex-1" />
            {showEditVariations ? (
              <Button variant="ghost" onClick={editVariations}>
                Edit
              </Button>
            ) : null}
          </div>

          <VariationsTable
            experiment={experiment}
            canEditExperiment={canEditExperiment}
            mutate={mutate}
          />
        </div>
      )}
      {hasLinkedChanges && experiment.type !== "holdout" ? (
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
      {experiment.type !== "holdout" && (
        <AddLinkedChanges
          experiment={experiment}
          numLinkedChanges={0}
          hasLinkedFeatures={linkedFeatures.length > 0}
          setFeatureModal={setFeatureModal}
          setVisualEditorModal={setVisualEditorModal}
          setUrlRedirectModal={setUrlRedirectModal}
        />
      )}

      {experiment.type === "holdout" && holdout && (
        <div className="box p-4 my-4">
          <h3>Included Experiments & Features</h3>
          <Tabs
            value={tab}
            onValueChange={(value) =>
              setTab(value as "experiments" | "features")
            }
          >
            <TabsList size="2">
              <TabsTrigger value="experiments">Experiments</TabsTrigger>
              <TabsTrigger value="features">Features</TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === "experiments" && (
            <LinkedExperimentsTable
              holdout={holdout}
              experiments={holdoutExperiments ?? []}
            />
          )}
        </div>
      )}
      {experiment.status !== "draft" &&
      !hasLinkedChanges &&
      experiment.type !== "holdout" ? (
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
      <AnalysisSettings
        experiment={experiment}
        mutate={mutate}
        envs={envs}
        canEdit={!!editTargeting}
      />
    </div>
  );
}
