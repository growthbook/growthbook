import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
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
import EditInfoForm from "@/components/Experiment/EditInfoForm";
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
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [phaseModalOpen, setPhaseModalOpen] = useState(false);
  const [editPhasesOpen, setEditPhasesOpen] = useState(false);
  const [editPhaseId, setEditPhaseId] = useState<number | null>(null);

  const { data, error, mutate } = useApi<{
    experiment: ExperimentInterfaceStringDates;
    idea?: IdeaInterface;
  }>(`/experiment/${eid}`);

  useSwitchOrg(data?.experiment?.organization);

  const { apiCall } = useAuth();

  if (error) {
    return <div>There was a problem loading the experiment</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const { experiment, idea } = data;

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
      {editModalOpen && (
        <EditInfoForm
          experiment={experiment}
          cancel={() => setEditModalOpen(false)}
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
            mutate={mutate}
            editMetrics={editMetrics}
            editResult={editResult}
            editVariations={editVariations}
            duplicate={duplicate}
            editProject={editProject}
            editTags={editTags}
            newPhase={newPhase}
            editPhases={editPhases}
            editPhase={editPhase}
          />
        </SnapshotProvider>
      </div>
    </div>
  );
};

export default ExperimentPage;
