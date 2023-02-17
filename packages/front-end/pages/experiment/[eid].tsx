import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { ReactElement, useState } from "react";
import { IdeaInterface } from "back-end/types/idea";
import Link from "next/link";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import SinglePage from "@/components/Experiment/SinglePage";
import MultiTabPage from "@/components/Experiment/MultiTabPage";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import EditMetricsForm from "@/components/Experiment/EditMetricsForm";
import StopExperimentForm from "@/components/Experiment/StopExperimentForm";
import usePermissions from "@/hooks/usePermissions";
import EditVariationsForm from "@/components/Experiment/EditVariationsForm";
import EditInfoForm from "@/components/Experiment/EditInfoForm";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import EditProjectForm from "@/components/Experiment/EditProjectForm";
import { useAuth } from "@/services/auth";
import { GBCircleArrowLeft } from "@/components/Icons";
import SnapshotProvider from "@/components/Experiment/SnapshotProvider";
import NewPhaseForm from "@/components/Experiment/NewPhaseForm";
import track from "@/services/track";
import EditPhasesModal from "@/components/Experiment/EditPhasesModal";

const ExperimentPage = (): ReactElement => {
  const permissions = usePermissions();
  const router = useRouter();
  const { eid } = router.query;
  const [useSinglePage, setUseSinglePage] = useLocalStorage(
    "new-exp-page-layout",
    true
  );

  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [metricsModalOpen, setMetricsModalOpen] = useState(false);
  const [variationsModalOpen, setVariationsModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [phaseModalOpen, setPhaseModalOpen] = useState(false);
  const [editPhasesOpen, setEditPhasesOpen] = useState(false);

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

  // TODO: more cases where the new page won't work?
  const supportsSinglePage = experiment.implementation !== "visual";

  const canEdit =
    permissions.check("createAnalyses", experiment.project) &&
    !experiment.archived;

  const canEditProject =
    permissions.check("createAnalyses", "") && !experiment.archived;

  const editMetrics = canEdit ? () => setMetricsModalOpen(true) : null;
  const editResult = canEdit ? () => setStopModalOpen(true) : null;
  const editVariations = canEdit ? () => setVariationsModalOpen(true) : null;
  const editInfo = canEdit ? () => setEditModalOpen(true) : null;
  const duplicate = canEdit ? () => setDuplicateModalOpen(true) : null;
  const editTags = canEdit ? () => setTagsModalOpen(true) : null;
  const editProject = canEditProject ? () => setProjectModalOpen(true) : null;
  const newPhase = canEdit ? () => setPhaseModalOpen(true) : null;
  const editPhases = canEdit ? () => setEditPhasesOpen(true) : null;

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
      {editPhasesOpen && (
        <EditPhasesModal
          close={() => setEditPhasesOpen(false)}
          mutateExperiment={mutate}
          experiment={experiment}
        />
      )}
      <div className="container-fluid">
        {supportsSinglePage &&
          (useSinglePage ? (
            <div className="container-fluid pagecontents">
              <div className="bg-light border-bottom p-2 mb-3 d-flex">
                <div>
                  <Link href="/experiments">
                    <a>
                      <GBCircleArrowLeft /> Back to all experiments
                    </a>
                  </Link>
                </div>
                <div className="text-center ml-auto">
                  <strong>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        track("View Old Experiment Page");
                        setUseSinglePage(false);
                      }}
                    >
                      Switch back to the old page
                    </a>
                  </strong>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-info text-light p-2 text-center mb-3">
              <span>
                Try the new and improved experiment view!{" "}
                <strong>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      track("View New Experiment Page");
                      setUseSinglePage(true);
                    }}
                    className="text-white"
                  >
                    Switch Now
                  </a>
                </strong>
              </span>
            </div>
          ))}
        {!supportsSinglePage && <div className="mb-2" />}
        <SnapshotProvider experiment={experiment}>
          {supportsSinglePage && useSinglePage ? (
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
            />
          ) : (
            <MultiTabPage
              experiment={experiment}
              idea={idea}
              mutate={mutate}
              editMetrics={editMetrics}
              editResult={editResult}
              editInfo={editInfo}
              editVariations={editVariations}
              duplicate={duplicate}
              editProject={editProject}
              editTags={editTags}
              newPhase={newPhase}
              editPhases={editPhases}
            />
          )}
        </SnapshotProvider>
      </div>
    </div>
  );
};

export default ExperimentPage;
