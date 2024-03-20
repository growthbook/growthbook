import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { URLRedirectInterface } from "back-end/types/url-redirect";
import usePermissions from "@/hooks/usePermissions";
import { StartExperimentBanner } from "@/components/Experiment/StartExperimentBanner";
import AddLinkedChanges from "@/components/Experiment/LinkedChanges/AddLinkedChanges";
import RedirectLinkedChanges from "@/components/Experiment/LinkedChanges/RedirectLinkedChanges";
import FeatureLinkedChanges from "@/components/Experiment/LinkedChanges/FeatureLinkedChanges";
import VisualLinkedChanges from "@/components/Experiment/LinkedChanges/VisualLinkedChanges";
import { ExperimentTab } from "@/components/Experiment/TabbedPage";
import TargetingInfo from "./TargetingInfo";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  mutate: () => void;
  editTargeting?: (() => void) | null;
  setFeatureModal: (open: boolean) => void;
  setVisualEditorModal: (open: boolean) => void;
  setUrlRedirectModal: (open: boolean) => void;
  linkedFeatures: LinkedFeatureInfo[];
  setTab: (tab: ExperimentTab) => void;
  connections: SDKConnectionInterface[];
}

export default function Implementation({
  experiment,
  visualChangesets,
  urlRedirects,
  mutate,
  editTargeting,
  setFeatureModal,
  setVisualEditorModal,
  setUrlRedirectModal,
  linkedFeatures,
  setTab,
  connections,
}: Props) {
  const phases = experiment.phases || [];

  const permissions = usePermissions();

  const canCreateAnalyses = permissions.check(
    "createAnalyses",
    experiment.project
  );
  const canEditExperiment = !experiment.archived && canCreateAnalyses;

  const hasVisualEditorPermission =
    canEditExperiment &&
    permissions.check("runExperiments", experiment.project, []);

  const canAddLinkedChanges =
    hasVisualEditorPermission && experiment.status === "draft";

  const hasLinkedChanges =
    visualChangesets.length > 0 ||
    linkedFeatures.length > 0 ||
    urlRedirects.length > 0;

  if (!hasLinkedChanges) {
    if (experiment.status === "draft") {
      return (
        <>
          <AddLinkedChanges
            experiment={experiment}
            numLinkedChanges={0}
            setFeatureModal={setFeatureModal}
            setVisualEditorModal={setVisualEditorModal}
            setUrlRedirectModal={setUrlRedirectModal}
          />
          <div className="mt-1">
            {/* TODO: Pipe through redirects */}
            <StartExperimentBanner
              experiment={experiment}
              mutateExperiment={mutate}
              linkedFeatures={linkedFeatures}
              visualChangesets={visualChangesets}
              onStart={() => setTab("results")}
              editTargeting={editTargeting}
              connections={connections}
              className="appbox p-4"
            />
          </div>
        </>
      );
    }
    return (
      <div className="alert alert-info mb-0">
        This experiment has no directly linked feature flag, visual editor
        changes, or redirects. Randomization, targeting, and implementation is
        either being managed by an external system or via legacy Feature Flags
        in GrowthBook.
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="pl-1 mb-3">
        <h2>Implementation</h2>
      </div>
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
      <AddLinkedChanges
        experiment={experiment}
        numLinkedChanges={0}
        hasLinkedFeatures={linkedFeatures.length > 0}
        hasLinkedRedirects={urlRedirects.length > 0}
        hasVisualChanges={visualChangesets.length > 0}
        setFeatureModal={setFeatureModal}
        setVisualEditorModal={setVisualEditorModal}
        setUrlRedirectModal={setUrlRedirectModal}
      />
      {hasLinkedChanges && (
        <div className="appbox p-3 h-100 mb-4">
          <TargetingInfo
            experiment={experiment}
            editTargeting={editTargeting}
            phaseIndex={phases.length - 1}
            horizontalView
          />
        </div>
      )}

      {experiment.status === "draft" && (
        <div className="mt-1">
          {/* TODO: Pipe through redirects */}
          <StartExperimentBanner
            experiment={experiment}
            mutateExperiment={mutate}
            linkedFeatures={linkedFeatures}
            visualChangesets={visualChangesets}
            onStart={() => setTab("results")}
            editTargeting={editTargeting}
            connections={connections}
            className="appbox p-4"
          />
        </div>
      )}
    </div>
  );
}
