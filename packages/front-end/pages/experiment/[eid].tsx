import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import React, { ReactElement, useState } from "react";
import { IdeaInterface } from "back-end/types/idea";
import { getAffectedEnvsForExperiment } from "shared/util";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import SinglePage from "@/components/Experiment/SinglePage";
import SinglePage_old from "@/components/Experiment/SinglePage_old";
import EditMetricsForm from "@/components/Experiment/EditMetricsForm";
import StopExperimentForm from "@/components/Experiment/StopExperimentForm";
import { useLocalStorage } from "@/hooks/useLocalStorage";
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
import track from "@/services/track";

const ExperimentPage = (): ReactElement => {
  const [newUi, setNewUi] = useLocalStorage<boolean>(
    "single-page-new-ui-v1",
    true
  );
  const SinglePageComponent = newUi ? SinglePage : SinglePage_old;

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

  useSwitchOrg(data?.experiment?.organization ?? null);

  const { apiCall } = useAuth();

  if (error) {
    return <div>There was a problem loading the experiment</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const { experiment, idea, visualChangesets = [] } = data;

  const canEditExperiment =
    permissions.check("createAnalyses", experiment.project) &&
    !experiment.archived;

  let canRunExperiment = !experiment.archived;
  const envs = getAffectedEnvsForExperiment({ experiment });
  if (envs.length > 0) {
    if (!permissions.check("runExperiments", experiment.project, envs)) {
      canRunExperiment = false;
    }
  }

  const editMetrics = canEditExperiment
    ? () => setMetricsModalOpen(true)
    : null;
  const editResult = canRunExperiment ? () => setStopModalOpen(true) : null;
  const editVariations = canRunExperiment
    ? () => setVariationsModalOpen(true)
    : null;
  const duplicate = canEditExperiment
    ? () => setDuplicateModalOpen(true)
    : null;
  const editTags = canEditExperiment ? () => setTagsModalOpen(true) : null;
  const editProject = canRunExperiment ? () => setProjectModalOpen(true) : null;
  const newPhase = canRunExperiment ? () => setPhaseModalOpen(true) : null;
  const editPhases = canRunExperiment ? () => setEditPhasesOpen(true) : null;
  const editPhase = canRunExperiment
    ? (i: number | null) => setEditPhaseId(i)
    : null;

  return (
    <div>
      <div
        className="alert-secondary p-2 mb-2 text-center"
        style={{ marginTop: -5 }}
      >
        This is the {newUi ? "new" : "old"} experiment page.{" "}
        <a
          role="button"
          className="a"
          onClick={() => {
            track("Switched Experiment Page UI", {
              to: newUi ? "old" : "new",
            });
            setNewUi(!newUi);
          }}
        >
          {newUi
            ? "Switch back to the old page?"
            : "Try the new experiment page?"}
        </a>
      </div>
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
          <SinglePageComponent
            experiment={experiment}
            idea={idea}
            visualChangesets={visualChangesets}
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
