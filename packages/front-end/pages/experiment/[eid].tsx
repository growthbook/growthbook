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
import { includeExperimentInPayload } from "shared/util";
import { isContextualBanditMeasurementArm } from "shared/experiments";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import EditMetricsForm from "@/components/Experiment/EditMetricsForm";
import MeasurementArmMetricsForm from "@/components/ContextualBandit/MeasurementArmMetricsForm";
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
import EditTrafficModal from "@/components/Experiment/EditTrafficModal";
import EditNamespaceModal from "@/components/Experiment/EditNamespaceModal";
import TabbedPage from "@/components/Experiment/TabbedPage";
import PageHead from "@/components/Layout/PageHead";
import type { BreadcrumbItem } from "@/ui/Breadcrumbs";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";
import { useHoldouts } from "@/hooks/useHoldouts";
import EditScheduleModal from "@/components/Experiment/EditScheduleModal";

export type ExperimentPageProps = {
  // When rendered inside another page (the contextual bandit measurement-arm
  // sub-page), the experiment id and breadcrumb come from the host page
  // instead of the route.
  experimentId?: string;
  breadcrumb?: BreadcrumbItem[];
};

const ExperimentPage = ({
  experimentId,
  breadcrumb,
}: ExperimentPageProps = {}): ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const router = useRouter();
  const eid = experimentId ?? router.query.eid;

  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [metricsModalOpen, setMetricsModalOpen] = useState(false);
  const [variationsModalOpen, setVariationsModalOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [phaseModalOpen, setPhaseModalOpen] = useState(false);
  const [editPhasesOpen, setEditPhasesOpen] = useState(false);
  const [editPhaseId, setEditPhaseId] = useState<number | null>(null);
  const [targetingModalOpen, setTargetingModalOpen] = useState(false);
  const [trafficModalOpen, setTrafficModalOpen] = useState(false);
  const [trafficFocusVariation, setTrafficFocusVariation] = useState<
    string | null
  >(null);
  const [addVariationOnOpen, setAddVariationOnOpen] = useState(false);
  const [namespaceModalOpen, setNamespaceModalOpen] = useState(false);
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
  }>(`/experiment/${eid}`);

  const { getDecisionCriteria, getRunningExperimentResultStatus } =
    useRunningExperimentStatus();

  const decisionCriteria = getDecisionCriteria(
    data?.experiment?.decisionFrameworkSettings?.decisionCriteriaId,
  );

  useSwitchOrg(data?.experiment?.organization ?? null);

  const { apiCall } = useAuth();

  const { experimentToHoldoutsMap } = useHoldouts();

  useEffect(() => {
    if (data?.experiment?.type === "multi-armed-bandit") {
      router.replace(window.location.href.replace("experiment/", "bandit/"));
    }
    if (data?.experiment?.type === "holdout") {
      const holdoutId = experimentToHoldoutsMap.get(data?.experiment?.id)?.id;
      let url = window.location.href.replace(
        /(.*)\/experiment\/.*/,
        "$1/holdout/",
      );
      url += holdoutId;
      router.replace(url);
    }
    if (
      !experimentId &&
      data?.experiment &&
      isContextualBanditMeasurementArm(data.experiment) &&
      data.experiment.contextualBanditId
    ) {
      router.replace(
        window.location.href.replace(
          /(.*)\/experiment\/[^#?]*/,
          `$1/contextual-bandit/${data.experiment.contextualBanditId}/measurement-arm`,
        ),
      );
    }
  }, [data, experimentId, experimentToHoldoutsMap, router]);

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

  // A measurement-arm experiment is owned by its contextual bandit: only the
  // secondary and guardrail metrics are editable here; everything else is
  // managed from the CB.
  const isMeasurementArm = isContextualBanditMeasurementArm(experiment);

  const canEditAnalysisSettings =
    permissionsUtil.canUpdateExperiment(experiment, {}) && !experiment.archived;
  const canEditExperiment = canEditAnalysisSettings && !isMeasurementArm;

  let canRunExperiment = !experiment.archived && !isMeasurementArm;
  if (envs.length > 0) {
    if (!permissionsUtil.canRunExperiment(experiment, envs)) {
      canRunExperiment = false;
    }
  }

  const editMetrics = canEditAnalysisSettings
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
  const newPhase = canRunExperiment ? () => setPhaseModalOpen(true) : null;
  const editPhases = canRunExperiment ? () => setEditPhasesOpen(true) : null;
  const editPhase = canRunExperiment
    ? (i: number | null) => setEditPhaseId(i)
    : null;
  const editTargeting = canRunExperiment
    ? () => setTargetingModalOpen(true)
    : null;
  const editTraffic = canRunExperiment
    ? (variationId?: string) => {
        setTrafficFocusVariation(variationId ?? null);
        setTrafficModalOpen(true);
      }
    : null;
  const addVariation = canRunExperiment
    ? () => {
        setTrafficFocusVariation(null);
        setAddVariationOnOpen(true);
        setTrafficModalOpen(true);
      }
    : null;
  const editNamespace = canRunExperiment
    ? () => setNamespaceModalOpen(true)
    : null;
  const editSchedule = canEditExperiment
    ? () => setEditScheduleModalOpen(true)
    : null;

  const safeToEdit =
    experiment.status !== "running" ||
    !includeExperimentInPayload(
      experiment,
      linkedFeatures.map((f) => f.feature),
    );

  return (
    <>
      {metricsModalOpen && isMeasurementArm && (
        <MeasurementArmMetricsForm
          experiment={experiment}
          cancel={() => setMetricsModalOpen(false)}
          mutate={mutate}
          source="eid"
        />
      )}
      {metricsModalOpen && !isMeasurementArm && (
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
          linkedFeatures={linkedFeatures}
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
          linkedFeatures={linkedFeatures}
          editTargeting={editTargeting}
          source="eid"
        />
      )}
      {targetingModalOpen && (
        <EditTargetingModal
          close={() => setTargetingModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          linkedFeatures={linkedFeatures}
          safeToEdit={safeToEdit}
          // source="eid"
        />
      )}
      {trafficModalOpen && (
        <EditTrafficModal
          close={() => {
            setTrafficModalOpen(false);
            setTrafficFocusVariation(null);
            setAddVariationOnOpen(false);
          }}
          mutate={mutate}
          experiment={experiment}
          linkedFeatures={linkedFeatures}
          safeToEdit={safeToEdit}
          focusVariationId={trafficFocusVariation}
          addVariationOnOpen={addVariationOnOpen}
        />
      )}
      {namespaceModalOpen && (
        <EditNamespaceModal
          close={() => setNamespaceModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          linkedFeatures={linkedFeatures}
          safeToEdit={safeToEdit}
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
        breadcrumb={
          breadcrumb ?? [
            {
              display: "Experiments",
              href: `/experiments`,
            },
            { display: experiment.name },
          ]
        }
      />

      <SnapshotProvider experiment={experiment}>
        <TabbedPage
          experiment={experiment}
          linkedFeatures={linkedFeatures}
          mutate={mutate}
          visualChangesets={visualChangesets}
          urlRedirects={urlRedirects}
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
          editTraffic={editTraffic}
          addVariation={addVariation}
          editNamespace={editNamespace}
          visualChangesetEnvStates={visualChangesetEnvStates}
          urlRedirectEnvStates={urlRedirectEnvStates}
          editSchedule={editSchedule}
        />
      </SnapshotProvider>
    </>
  );
};

export default ExperimentPage;
