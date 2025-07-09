import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { ReactElement, useState } from "react";
import { includeExperimentInPayload } from "shared/util";
import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { FeatureInterface } from "back-end/types/feature";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import EditMetricsForm from "@/components/Experiment/EditMetricsForm";
import StopExperimentForm from "@/components/Experiment/StopExperimentForm";
import EditVariationsForm from "@/components/Experiment/EditVariationsForm";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import { useAuth } from "@/services/auth";
import SnapshotProvider from "@/components/Experiment/SnapshotProvider";
import NewPhaseForm from "@/components/Experiment/NewPhaseForm";
import EditPhasesModal from "@/components/Experiment/EditPhasesModal";
import EditPhaseModal from "@/components/Experiment/EditPhaseModal";
import EditTargetingModal from "@/components/Experiment/EditTargetingModal";
import TabbedPage from "@/components/Experiment/TabbedPage";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";

const HoldoutPage = (): ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const router = useRouter();
  const { hid } = router.query;

  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [metricsModalOpen, setMetricsModalOpen] = useState(false);
  const [variationsModalOpen, setVariationsModalOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [phaseModalOpen, setPhaseModalOpen] = useState(false);
  const [editPhasesOpen, setEditPhasesOpen] = useState(false);
  const [editPhaseId, setEditPhaseId] = useState<number | null>(null);
  const [targetingModalOpen, setTargetingModalOpen] = useState(false);
  const [checklistItemsRemaining, setChecklistItemsRemaining] = useState<
    number | null
  >(null);

  const { data, error, mutate } = useApi<{
    holdout: HoldoutInterface;
    experiment: ExperimentInterfaceStringDates;
    linkedFeatures: FeatureInterface[];
    linkedExperiments: ExperimentInterfaceStringDates[];
    envs: string[];
  }>(`/holdout/${hid}`);

  const {
    getDecisionCriteria,
    getRunningExperimentResultStatus,
  } = useRunningExperimentStatus();

  const decisionCriteria = getDecisionCriteria(
    data?.experiment?.decisionFrameworkSettings?.decisionCriteriaId
  );

  useSwitchOrg(data?.experiment?.organization ?? null);

  const { apiCall } = useAuth();

  if (error) {
    return <div>There was a problem loading the holdout</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }
  const {
    experiment,
    holdout,
    linkedFeatures = [],
    envs = [],
    linkedExperiments = [],
  } = data;

  const runningExperimentStatus = getRunningExperimentResultStatus(experiment);

  const startAnalysis = async () => {
    await apiCall(`/holdout/${hid}/start-analysis`, {
      method: "POST",
    });
    mutate();
  };

  const canEditExperiment =
    permissionsUtil.canViewExperimentModal(experiment.project) &&
    !experiment.archived;

  let canRunExperiment = !experiment.archived;
  if (envs.length > 0) {
    if (!permissionsUtil.canRunExperiment(experiment, envs)) {
      canRunExperiment = false;
    }
  }

  const editMetrics = canEditExperiment
    ? () => setMetricsModalOpen(true)
    : null;
  const editResult = canRunExperiment
    ? () => {
        if (holdout?.analysisStartDate) {
          setStopModalOpen(true);
        } else {
          startAnalysis();
        }
      }
    : null;
  const editVariations = canRunExperiment
    ? () => setVariationsModalOpen(true)
    : null;
  const duplicate = canEditExperiment
    ? () => setDuplicateModalOpen(true)
    : null;
  const editTags = canEditExperiment ? () => setTagsModalOpen(true) : null;
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
    !includeExperimentInPayload(experiment, []);

  return (
    <>
      {metricsModalOpen && (
        <EditMetricsForm
          experiment={experiment}
          cancel={() => setMetricsModalOpen(false)}
          mutate={mutate}
          source="eid"
        />
      )}
      {stopModalOpen && (
        <StopExperimentForm
          close={() => setStopModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          runningExperimentStatus={runningExperimentStatus}
          decisionCriteria={decisionCriteria}
          source="eid"
        />
      )}
      {variationsModalOpen && (
        <EditVariationsForm
          experiment={experiment}
          cancel={() => setVariationsModalOpen(false)}
          onlySafeToEditVariationMetadata={!safeToEdit}
          mutate={mutate}
          source="eid"
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
          source="duplicate-eid"
          duplicate={true}
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
          source="eid"
        />
      )}
      {phaseModalOpen && (
        <NewPhaseForm
          close={() => setPhaseModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          source="eid"
        />
      )}
      {editPhaseId !== null && (
        <EditPhaseModal
          close={() => setEditPhaseId(null)}
          experiment={experiment}
          mutate={mutate}
          i={editPhaseId}
          editTargeting={editTargeting}
          source="eid"
        />
      )}
      {editPhasesOpen && (
        <EditPhasesModal
          close={() => setEditPhasesOpen(false)}
          mutateExperiment={mutate}
          experiment={experiment}
          editTargeting={editTargeting}
          source="eid"
        />
      )}
      {targetingModalOpen && (
        <EditTargetingModal
          close={() => setTargetingModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          safeToEdit={safeToEdit}
          // source="eid"
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

      <SnapshotProvider experiment={experiment}>
        <TabbedPage
          experiment={experiment}
          holdout={holdout}
          linkedFeatures={[]}
          holdoutFeatures={linkedFeatures}
          holdoutExperiments={linkedExperiments}
          mutate={mutate}
          visualChangesets={[]}
          urlRedirects={[]}
          editMetrics={editMetrics}
          editResult={editResult}
          editVariations={editVariations}
          duplicate={duplicate}
          editTags={editTags}
          newPhase={newPhase}
          editPhases={editPhases}
          editPhase={editPhase}
          envs={envs}
          editTargeting={editTargeting}
          checklistItemsRemaining={checklistItemsRemaining}
          setChecklistItemsRemaining={setChecklistItemsRemaining}
        />
      </SnapshotProvider>
    </>
  );
};

export default HoldoutPage;
