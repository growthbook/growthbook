import { useRouter } from "next/router";
import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { URLRedirectInterface } from "shared/types/url-redirect";
import React, { ReactElement, useEffect, useState } from "react";
import { IdeaInterface } from "shared/types/idea";
import { canEditDeliveryInPlace } from "shared/util";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import EditMetricsForm from "@/components/Experiment/EditMetricsForm";
import StopExperimentForm from "@/components/Experiment/StopExperimentForm";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import SnapshotProvider from "@/components/Experiment/SnapshotProvider";
import EditPhasesModal from "@/components/Experiment/EditPhasesModal";
import EditTargetingModal from "@/components/Experiment/EditTargetingModal";
import TabbedPage from "@/components/Experiment/TabbedPage";
import { useStagedTargeting } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";
import { useHoldouts } from "@/hooks/useHoldouts";
import EditScheduleModal from "@/components/Experiment/EditScheduleModal";

const ExperimentPage = (): ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const router = useRouter();
  const { eid } = router.query;

  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [metricsModalOpen, setMetricsModalOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [editPhasesOpen, setEditPhasesOpen] = useState(false);
  const [targetingModal, setTargetingModal] = useState<
    null | "targeting" | "namespace"
  >(null);
  const [editScheduleModalOpen, setEditScheduleModalOpen] = useState(false);

  const { data, error, mutate } = useApi<{
    experiment: ExperimentInterfaceStringDates;
    idea?: IdeaInterface;
    visualChangesets: VisualChangesetInterface[];
    linkedFeatures: LinkedFeatureInfo[];
    envs: string[];
    urlRedirects: URLRedirectInterface[];
    visualChangesetEnvStates?: LinkedChangeEnvStates;
    urlRedirectEnvStates?: LinkedChangeEnvStates;
    datasourceMissing?: boolean;
  }>(`/experiment/${eid}`);
  const targeting = useStagedTargeting(data?.experiment);

  const { getDecisionCriteria, getRunningExperimentResultStatus } =
    useRunningExperimentStatus();

  const decisionCriteria = getDecisionCriteria(
    data?.experiment?.decisionFrameworkSettings?.decisionCriteriaId,
  );

  useSwitchOrg(data?.experiment?.organization ?? null);

  const { experimentToHoldoutsMap } = useHoldouts();

  useEffect(() => {
    if (data?.experiment?.type === "multi-armed-bandit") {
      router.replace(window.location.href.replace("experiment/", "bandit/"));
    }
    if (data?.experiment?.type === "holdout") {
      const holdoutId = experimentToHoldoutsMap.get(data.experiment.id)?.id;
      // Wait for the holdouts list, or this redirects to /holdout/undefined.
      if (!holdoutId) return;
      const base = window.location.href.replace(
        /(.*)\/experiment\/.*/,
        "$1/holdout/",
      );
      router.replace(base + holdoutId);
    }
  }, [data, experimentToHoldoutsMap, router]);

  if (error) {
    return <div>There was a problem loading the experiment</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }
  const {
    experiment,
    visualChangesets = [],
    linkedFeatures = [],
    urlRedirects = [],
    envs = [],
    visualChangesetEnvStates,
    urlRedirectEnvStates,
  } = data;

  const runningExperimentStatus = getRunningExperimentResultStatus(experiment);

  const canEditExperiment =
    permissionsUtil.canUpdateExperiment(experiment, {}) && !experiment.archived;

  // The server asks for both: edit rights, and run rights where it serves.
  let canRunExperiment = canEditExperiment;
  if (envs.length > 0) {
    if (!permissionsUtil.canRunExperiment(experiment, envs)) {
      canRunExperiment = false;
    }
  }

  const editMetrics = canEditExperiment
    ? () => setMetricsModalOpen(true)
    : null;
  const editResult = canRunExperiment ? () => setStopModalOpen(true) : null;
  const duplicate = canEditExperiment
    ? () => setDuplicateModalOpen(true)
    : null;
  const editPhases = canRunExperiment ? () => setEditPhasesOpen(true) : null;
  const editTargeting = canRunExperiment
    ? () => setTargetingModal("targeting")
    : null;
  const editNamespace = canRunExperiment
    ? () => setTargetingModal("namespace")
    : null;
  const editSchedule = canEditExperiment
    ? () => setEditScheduleModalOpen(true)
    : null;

  const safeToEdit = canEditDeliveryInPlace(experiment);

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
      {editPhasesOpen && (
        <EditPhasesModal
          close={() => setEditPhasesOpen(false)}
          mutateExperiment={mutate}
          experiment={experiment}
          linkedFeatures={linkedFeatures}
          editTargeting={editTargeting}
          source="eid"
        />
      )}
      {targetingModal && (
        <EditTargetingModal
          section={targetingModal}
          close={() => setTargetingModal(null)}
          mutate={mutate}
          experiment={experiment}
          linkedFeatures={linkedFeatures}
          safeToEdit={safeToEdit}
          stageChanges={targeting.stage}
          draft={targeting.value}
        />
      )}
      {editScheduleModalOpen && (
        <EditScheduleModal
          experiment={experiment}
          close={() => setEditScheduleModalOpen(false)}
          mutate={mutate}
          envs={envs}
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
          datasourceMissing={!!data?.datasourceMissing}
          linkedFeatures={linkedFeatures}
          mutate={mutate}
          visualChangesets={visualChangesets}
          urlRedirects={urlRedirects}
          editMetrics={editMetrics}
          editResult={editResult}
          duplicate={duplicate}
          editPhases={editPhases}
          envs={envs}
          editTargeting={editTargeting}
          targetingDraft={targeting}
          canAddVariation={canRunExperiment}
          editNamespace={editNamespace}
          visualChangesetEnvStates={visualChangesetEnvStates}
          urlRedirectEnvStates={urlRedirectEnvStates}
          editSchedule={editSchedule}
        />
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
      </SnapshotProvider>
    </>
  );
};

export default ExperimentPage;
