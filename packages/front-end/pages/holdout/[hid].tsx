import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import React, { ReactElement, useState } from "react";
import { includeHoldoutInPayload } from "shared/util";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import EditMetricsForm from "@/components/Experiment/EditMetricsForm";
import EditVariationsForm from "@/components/Experiment/EditVariationsForm";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import { useAuth } from "@/services/auth";
import SnapshotProvider from "@/components/Experiment/SnapshotProvider";
import NewPhaseForm from "@/components/Experiment/NewPhaseForm";
import EditPhasesModal from "@/components/Experiment/EditPhasesModal";
import EditPhaseModal from "@/components/Experiment/EditPhaseModal";
import TabbedPage from "@/components/Experiment/TabbedPage";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import StartAnalysisModal from "@/components/Experiment/TabbedPage/startHoldoutAnalysisModal";
import EditHoldoutTargetingModal from "@/components/Holdout/EditHoldoutTargetingModal";
import NewHoldoutForm from "@/components/Holdout/NewHoldoutForm";
import StopHoldoutModal from "@/components/Holdout/StopHoldoutModal";
import EditScheduleModal from "@/components/Holdout/EditScheduleModal";

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
  const [startAnalysisModalOpen, setStartAnalysisModalOpen] = useState(false);
  const [editHoldoutScheduleModalOpen, setEditHoldoutScheduleModalOpen] =
    useState(false);
  const [checklistItemsRemaining, setChecklistItemsRemaining] = useState<
    number | null
  >(null);

  const { data, error, mutate } = useApi<{
    holdout: HoldoutInterfaceStringDates;
    experiment: ExperimentInterfaceStringDates;
    linkedFeatures: FeatureInterface[];
    linkedExperiments: ExperimentInterfaceStringDates[];
    envs: string[];
  }>(`/holdout/${hid}`);

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

  const startAnalysis = async () => {
    await apiCall(`/holdout/${hid}/edit-status`, {
      method: "POST",
      body: JSON.stringify({
        status: "running",
        holdoutRunningStatus: "analysis-period",
      }),
    });
    mutate();
  };

  const canEditExperiment =
    permissionsUtil.canViewHoldoutModal(holdout.projects) &&
    !experiment.archived;

  let canRunExperiment = !experiment.archived;
  if (envs.length > 0) {
    if (!permissionsUtil.canRunHoldout(holdout, envs)) {
      canRunExperiment = false;
    }
  }

  const editMetrics = canEditExperiment
    ? () => setMetricsModalOpen(true)
    : null;
  const stop = canRunExperiment ? () => setStopModalOpen(true) : null;
  const editResult = canRunExperiment
    ? () => {
        if (holdout?.analysisStartDate) {
          setStopModalOpen(true);
        } else {
          setStartAnalysisModalOpen(true);
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
  const editHoldoutSchedule = canRunExperiment
    ? () => setEditHoldoutScheduleModalOpen(true)
    : null;

  const safeToEdit =
    experiment.status !== "running" ||
    !includeHoldoutInPayload(holdout, experiment);

  return (
    <>
      {startAnalysisModalOpen && (
        <StartAnalysisModal
          close={() => setStartAnalysisModalOpen(false)}
          startAnalysis={startAnalysis}
        />
      )}
      {metricsModalOpen && (
        <EditMetricsForm
          experiment={experiment}
          cancel={() => setMetricsModalOpen(false)}
          mutate={mutate}
          source="hid"
        />
      )}
      {stopModalOpen && (
        <StopHoldoutModal
          close={() => setStopModalOpen(false)}
          mutate={mutate}
          holdout={holdout}
          experiment={experiment}
        />
      )}
      {variationsModalOpen && (
        <EditVariationsForm
          experiment={experiment}
          cancel={() => setVariationsModalOpen(false)}
          onlySafeToEditVariationMetadata={!safeToEdit}
          mutate={mutate}
          source="hid"
        />
      )}
      {duplicateModalOpen && (
        <NewHoldoutForm
          onClose={() => setDuplicateModalOpen(false)}
          initialHoldout={{ ...holdout, name: holdout.name + " (Copy)" }}
          initialExperiment={experiment}
          source="duplicate-hid"
          duplicate
          isNewHoldout
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
          source="hid"
        />
      )}
      {phaseModalOpen && (
        <NewPhaseForm
          close={() => setPhaseModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          source="hid"
        />
      )}
      {editPhaseId !== null && (
        <EditPhaseModal
          close={() => setEditPhaseId(null)}
          experiment={experiment}
          mutate={mutate}
          i={editPhaseId}
          editTargeting={editTargeting}
          source="hid"
        />
      )}
      {editPhasesOpen && (
        <EditPhasesModal
          close={() => setEditPhasesOpen(false)}
          mutateExperiment={mutate}
          experiment={experiment}
          editTargeting={editTargeting}
          source="hid"
        />
      )}
      {targetingModalOpen && (
        <EditHoldoutTargetingModal
          close={() => setTargetingModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
        />
      )}
      {editHoldoutScheduleModalOpen && (
        <EditScheduleModal
          close={() => setEditHoldoutScheduleModalOpen(false)}
          holdout={holdout}
          experiment={experiment}
          mutate={mutate}
        />
      )}

      <PageHead
        breadcrumb={[
          {
            display: "Holdouts",
            href: `/holdouts`,
          },
          { display: holdout.name },
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
          stop={stop}
          editHoldoutSchedule={editHoldoutSchedule}
        />
      </SnapshotProvider>
    </>
  );
};

export default HoldoutPage;
