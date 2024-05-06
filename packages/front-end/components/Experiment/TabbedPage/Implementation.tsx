import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { URLRedirectInterface } from "@back-end/types/url-redirect";
import usePermissions from "@/hooks/usePermissions";
import AddLinkedChanges from "@/components/Experiment/LinkedChanges/AddLinkedChanges";
import RedirectLinkedChanges from "@/components/Experiment/LinkedChanges/RedirectLinkedChanges";
import FeatureLinkedChanges from "@/components/Experiment/LinkedChanges/FeatureLinkedChanges";
import VisualLinkedChanges from "@/components/Experiment/LinkedChanges/VisualLinkedChanges";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
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
}: Props) {
  const phases = experiment.phases || [];

  const permissions = usePermissions();
  const permissionsUtil = usePermissionsUtil();

  const canEditExperiment =
    !experiment.archived &&
    permissionsUtil.canViewExperimentModal(experiment.project);

  const hasVisualEditorPermission =
    canEditExperiment &&
    permissions.check("runExperiments", experiment.project, []);

  const canAddLinkedChanges =
    hasVisualEditorPermission && experiment.status === "draft";

  const hasLinkedChanges =
    experiment.hasVisualChangesets ||
    linkedFeatures.length > 0 ||
    experiment.hasURLRedirects;

  if (!hasLinkedChanges) {
    if (experiment.status === "draft") {
      return (
        <AddLinkedChanges
          experiment={experiment}
          numLinkedChanges={0}
          setFeatureModal={setFeatureModal}
          setVisualEditorModal={setVisualEditorModal}
          setUrlRedirectModal={setUrlRedirectModal}
        />
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
    </div>
  );
}
