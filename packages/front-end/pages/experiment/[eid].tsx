import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import React, { ReactElement, useState } from "react";
import { IdeaInterface } from "back-end/types/idea";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import SinglePage from "@/components/Experiment/SinglePage";
import EditMetricsForm from "@/components/Experiment/EditMetricsForm";
import StopExperimentForm from "@/components/Experiment/StopExperimentForm";
import usePermissions from "@/hooks/usePermissions";
import EditVariationsForm from "@/components/Experiment/EditVariationsForm";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import EditProjectForm from "@/components/Experiment/EditProjectForm";
import { useAuth } from "@/services/auth";
import SnapshotProvider from "@/components/Experiment/SnapshotProvider";
import NewPhaseForm from "@/components/Experiment/NewPhaseForm";
import EditPhasesModal from "@/components/Experiment/EditPhasesModal";
import EditPhaseModal from "@/components/Experiment/EditPhaseModal";

const ExperimentPage = (): ReactElement => {
  const permissions = usePermissions();
  const router = useRouter();
  const { eid } = router.query;

  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [metricsModalOpen, setMetricsModalOpen] = useState(false);
  const [variationsModalOpen, setVariationsModalOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [phaseModalOpen, setPhaseModalOpen] = useState(false);
  const [editPhasesOpen, setEditPhasesOpen] = useState(false);
  const [editPhaseId, setEditPhaseId] = useState<number | null>(null);

  const { data, error, mutate } = useApi<{
    experiment: ExperimentInterfaceStringDates;
    idea?: IdeaInterface;
    visualChangesets: VisualChangesetInterface[];
  }>(`/experiment/${eid}`);

  // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
  useSwitchOrg(data?.experiment?.organization);

  const { apiCall } = useAuth();

  if (error) {
    return <div>There was a problem loading the experiment</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const { experiment, idea, visualChangesets = [] } = data;

  const canEdit =
    permissions.check("createAnalyses", experiment.project) &&
    !experiment.archived;

  const canEditProject =
    permissions.check("createAnalyses", "") && !experiment.archived;

  const editMetrics = canEdit ? () => setMetricsModalOpen(true) : null;
  const editResult = canEdit ? () => setStopModalOpen(true) : null;
  const editVariations = canEdit ? () => setVariationsModalOpen(true) : null;
  const duplicate = canEdit ? () => setDuplicateModalOpen(true) : null;
  const editTags = canEdit ? () => setTagsModalOpen(true) : null;
  const editProject = canEditProject ? () => setProjectModalOpen(true) : null;
  const newPhase = canEdit ? () => setPhaseModalOpen(true) : null;
  const editPhases = canEdit ? () => setEditPhasesOpen(true) : null;
  const editPhase = canEdit ? (i: number | null) => setEditPhaseId(i) : null;

  return (
    <div>
      {metricsModalOpen && (
        <EditMetricsForm
          experiment={experiment}
          cancel={() => setMetricsModalOpen(false)}
          mutate={mutate}
        />
      )}
      {stopModalOpen && (
        <StopExperimentForm
          close={() => setStopModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
        />
      )}
      {variationsModalOpen && (
        <EditVariationsForm
          experiment={experiment}
          cancel={() => setVariationsModalOpen(false)}
          mutate={mutate}
        />
      )}
      {duplicateModalOpen && (
        <NewExperimentForm
          onClose={() => setDuplicateModalOpen(false)}
          initialValue={{
            ...experiment,
            name: experiment.name + " (Copy)",
            trackingKey: "",
          }}
          source="duplicate"
        />
      )}
      {tagsModalOpen && (
        <EditTagsForm
          tags={experiment.tags}
          save={async (tags) => {
            await apiCall(`/experiment/${experiment.id}`, {
              method: "POST",
              body: JSON.stringify({ tags }),
            });
          }}
          cancel={() => setTagsModalOpen(false)}
          mutate={mutate}
        />
      )}
      {projectModalOpen && (
        <EditProjectForm
          cancel={() => setProjectModalOpen(false)}
          mutate={mutate}
          current={experiment.project}
          apiEndpoint={`/experiment/${experiment.id}`}
        />
      )}
      {phaseModalOpen && (
        <NewPhaseForm
          close={() => setPhaseModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
        />
      )}
      {editPhaseId !== null && (
        <EditPhaseModal
          close={() => setEditPhaseId(null)}
          experiment={experiment}
          mutate={mutate}
          i={editPhaseId}
        />
      )}
      {editPhasesOpen && (
        <EditPhasesModal
          close={() => setEditPhasesOpen(false)}
          mutateExperiment={mutate}
          experiment={experiment}
        />
      )}
      <div className="container-fluid">
        <SnapshotProvider experiment={experiment}>
          <SinglePage
            experiment={experiment}
            idea={idea}
            visualChangesets={visualChangesets}
            mutate={mutate}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '(() => void) | null' is not assignable to ty... Remove this comment to see the full error message
            editMetrics={editMetrics}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '(() => void) | null' is not assignable to ty... Remove this comment to see the full error message
            editResult={editResult}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '(() => void) | null' is not assignable to ty... Remove this comment to see the full error message
            editVariations={editVariations}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '(() => void) | null' is not assignable to ty... Remove this comment to see the full error message
            duplicate={duplicate}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '(() => void) | null' is not assignable to ty... Remove this comment to see the full error message
            editProject={editProject}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '(() => void) | null' is not assignable to ty... Remove this comment to see the full error message
            editTags={editTags}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '(() => void) | null' is not assignable to ty... Remove this comment to see the full error message
            newPhase={newPhase}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '(() => void) | null' is not assignable to ty... Remove this comment to see the full error message
            editPhases={editPhases}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '((i: number | null) => void) | null' is not ... Remove this comment to see the full error message
            editPhase={editPhase}
          />
        </SnapshotProvider>
      </div>
    </div>
  );
};

export default ExperimentPage;
