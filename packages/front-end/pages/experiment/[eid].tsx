import { useRouter } from "next/router";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import React, { ReactElement, useState } from "react";
import { IdeaInterface } from "back-end/types/idea";
import {
  getAffectedEnvsForExperiment,
  includeExperimentInPayload,
} from "shared/util";
import { BsChatSquareQuote } from "react-icons/bs";
import { FaCheck, FaMagic, FaUndo } from "react-icons/fa";
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
import EditTargetingModal from "@/components/Experiment/EditTargetingModal";
import TabbedPage from "@/components/Experiment/TabbedPage";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import FeedbackModal from "@/components/FeedbackModal";
import track from "@/services/track";
import PageHead from "@/components/Layout/PageHead";

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
  const [targetingModalOpen, setTargetingModalOpen] = useState(false);

  const { data, error, mutate } = useApi<{
    experiment: ExperimentInterfaceStringDates;
    idea?: IdeaInterface;
    visualChangesets: VisualChangesetInterface[];
    linkedFeatures: LinkedFeatureInfo[];
  }>(`/experiment/${eid}`);

  useSwitchOrg(data?.experiment?.organization ?? null);

  const [newUi, setNewUi] = useLocalStorage<boolean>(
    "experiment-results-new-ui-v2",
    true
  );
  const [showFeedbackBanner, setShowFeedbackBanner] = useState<boolean>(true);
  const [showFeedbackModal, setShowFeedbackModal] = useState<boolean>(false);

  const { apiCall } = useAuth();

  if (error) {
    return <div>There was a problem loading the experiment</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const { experiment, idea, visualChangesets = [], linkedFeatures = [] } = data;

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
  const editTargeting = canRunExperiment
    ? () => setTargetingModalOpen(true)
    : null;

  const safeToEdit =
    experiment.status !== "running" ||
    !includeExperimentInPayload(
      experiment,
      linkedFeatures.map((f) => f.feature)
    );

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
          additionalMessage={
            experiment.status !== "draft" &&
            (experiment.linkedFeatures?.length ||
              experiment.hasVisualChangesets) ? (
              <div className="alert alert-danger">
                Changing the project may prevent your linked Feature Flags and
                Visual Changes from being sent to users.
              </div>
            ) : null
          }
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
          editTargeting={editTargeting}
        />
      )}
      {editPhasesOpen && (
        <EditPhasesModal
          close={() => setEditPhasesOpen(false)}
          mutateExperiment={mutate}
          experiment={experiment}
          editTargeting={editTargeting}
        />
      )}
      {targetingModalOpen && (
        <EditTargetingModal
          close={() => setTargetingModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          safeToEdit={safeToEdit}
        />
      )}

      <PageHead
        breadcrumb={[
          {
            display: "Experiments",
            href: `/experiments`,
          },
          { display: experiment.name },
        ]}
      />

      <div className="container-fluid position-relative">
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 840,
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <div className="bg-light d-inline-flex border-bottom border-left border-right rounded py-1 px-3 experiment-switch-page">
            <div className="switch-back">
              <a
                className="a"
                role="button"
                onClick={() => {
                  setNewUi(!newUi);
                  track("Switched Experiment Page V2", {
                    switchTo: newUi ? "old" : "new",
                  });
                }}
              >
                <span className="text mr-1">
                  switch to {newUi ? "old" : "new"} design
                </span>
                {newUi ? <FaUndo /> : <FaMagic />}
              </a>
            </div>
            {showFeedbackBanner ? (
              <div className="border-left pl-3 ml-3 give-feedback">
                <a
                  className="a"
                  role="button"
                  onClick={() => {
                    setShowFeedbackModal(true);
                  }}
                >
                  tell us your thoughts
                  <BsChatSquareQuote size="18" className="ml-1" />
                </a>
              </div>
            ) : null}
          </div>
        </div>
        <SnapshotProvider experiment={experiment}>
          {newUi ? (
            <TabbedPage
              experiment={experiment}
              linkedFeatures={linkedFeatures}
              mutate={mutate}
              visualChangesets={visualChangesets}
              editMetrics={editMetrics}
              editResult={editResult}
              editVariations={editVariations}
              duplicate={duplicate}
              editProject={editProject}
              editTags={editTags}
              newPhase={newPhase}
              editPhases={editPhases}
              editPhase={editPhase}
              editTargeting={editTargeting}
            />
          ) : (
            <SinglePage
              experiment={experiment}
              linkedFeatures={linkedFeatures}
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
              editTargeting={editTargeting}
            />
          )}
        </SnapshotProvider>

        <FeedbackModal
          open={showFeedbackModal}
          close={() => setShowFeedbackModal(false)}
          submitCallback={() => setShowFeedbackBanner(false)}
          header={
            <>
              <BsChatSquareQuote size="20" className="mr-2" />
              Tell us your thoughts about the new experiment page design
            </>
          }
          prompt="What could be improved? What did you like?"
          cta="Send feedback"
          sentCta={
            <>
              <FaCheck /> Sent
            </>
          }
          source="experiment-page-feedback"
        />
      </div>
    </div>
  );
};

export default ExperimentPage;
