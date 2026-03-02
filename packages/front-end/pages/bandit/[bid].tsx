import { useRouter } from "next/router";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { URLRedirectInterface } from "shared/types/url-redirect";
import React, { ReactElement, useEffect, useState } from "react";
import { IdeaInterface } from "shared/types/idea";
import { includeExperimentInPayload } from "shared/util";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import EditMetricsForm from "@/components/Experiment/EditMetricsForm";
import StopExperimentForm from "@/components/Experiment/StopExperimentForm";
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
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";

const BanditExperimentPage = (): ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const router = useRouter();
  const { bid } = router.query;

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
  const [checklistItemsRemaining, setChecklistItemsRemaining] = useState<
    number | null
  >(null);

  const { data, error, mutate } = useApi<{
    experiment: ExperimentInterfaceStringDates;
    idea?: IdeaInterface;
    visualChangesets: VisualChangesetInterface[];
    linkedFeatures: LinkedFeatureInfo[];
    envs: string[];
    urlRedirects: URLRedirectInterface[];
  }>(`/experiment/${bid}`);

  useSwitchOrg(data?.experiment?.organization ?? null);

  const { apiCall } = useAuth();

  useEffect(() => {
    if (!data?.experiment) return;
    if (!data.experiment?.type || data.experiment.type === "standard") {
      router.replace(window.location.href.replace("bandit/", "experiment/"));
    }
    if (data?.experiment?.type === "holdout") {
      let url = window.location.href.replace(/(.*)\/bandit\/.*/, "$1/holdout/");
      url += data?.experiment?.holdoutId;
      router.replace(url);
    }
  }, [data, router]);

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
  } = data;

  const canEditExperiment =
    permissionsUtil.canViewExperimentModal(experiment.project) &&
    !experiment.archived;

  let canRunExperiment = !experiment.archived;
  if (data.envs.length > 0) {
    if (!permissionsUtil.canRunExperiment(experiment, data.envs)) {
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
      linkedFeatures.map((f) => f.feature),
    );

  return (
    <>
      {metricsModalOpen && (
        <EditMetricsForm
          experiment={experiment}
          cancel={() => setMetricsModalOpen(false)}
          mutate={mutate}
          source="bid"
        />
      )}
      {stopModalOpen && (
        <StopExperimentForm
          close={() => setStopModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          source="bid"
        />
      )}
      {variationsModalOpen && (
        <EditVariationsForm
          experiment={experiment}
          cancel={() => setVariationsModalOpen(false)}
          onlySafeToEditVariationMetadata={false}
          mutate={mutate}
          source="bid"
        />
      )}
      {duplicateModalOpen && (
        <NewExperimentForm
          onClose={() => setDuplicateModalOpen(false)}
          initialValue={{
            ...experiment,
            name: experiment.name + " (Copy)",
            trackingKey: "",
            status: "draft",
            phases: experiment.phases.map((p, i) => {
              if (i < experiment.phases.length - 1) {
                return p;
              }
              return {
                ...p,
                dateStarted: new Date().toISOString(),
                dateEnded: undefined,
                variationWeights: p.variationWeights.map(
                  () => 1 / (p.variationWeights.length || 2),
                ),
                banditEvents: undefined,
              };
            }),
          }}
          duplicate={true}
          source="duplicate-bid"
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
          source="bid"
        />
      )}
      {projectModalOpen && (
        <EditProjectForm
          label={
            <>
              Projects{" "}
              <Tooltip
                body={
                  "The dropdown below has been filtered to only include projects where you have permission to update Experiments"
                }
              />
            </>
          }
          cancel={() => setProjectModalOpen(false)}
          permissionRequired={(project) =>
            permissionsUtil.canUpdateExperiment({ project }, {})
          }
          mutate={mutate}
          current={experiment.project}
          apiEndpoint={`/experiment/${experiment.id}`}
          additionalMessage={
            experiment.status !== "draft" &&
            (experiment.linkedFeatures?.length ||
              experiment.hasVisualChangesets ||
              experiment.hasURLRedirects) ? (
              <div className="alert alert-danger">
                Changing the project may prevent your linked Feature Flags,
                Visual Changes, and URL Redirects from being sent to users.
              </div>
            ) : null
          }
          source="bid"
        />
      )}
      {phaseModalOpen && (
        <NewPhaseForm
          close={() => setPhaseModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          source="bid"
        />
      )}
      {editPhaseId !== null && (
        <EditPhaseModal
          close={() => setEditPhaseId(null)}
          experiment={experiment}
          mutate={mutate}
          i={editPhaseId}
          editTargeting={editTargeting}
          source="bid"
        />
      )}
      {editPhasesOpen && (
        <EditPhasesModal
          close={() => setEditPhasesOpen(false)}
          mutateExperiment={mutate}
          experiment={experiment}
          editTargeting={editTargeting}
          source="bid"
        />
      )}
      {targetingModalOpen && (
        <EditTargetingModal
          close={() => setTargetingModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          safeToEdit={safeToEdit}
          // source="bid"
        />
      )}

      <PageHead
        breadcrumb={[
          {
            display: "Bandits",
            href: `/bandits`,
          },
          { display: experiment.name },
        ]}
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
          envs={data.envs}
          editTargeting={editTargeting}
          checklistItemsRemaining={checklistItemsRemaining}
          setChecklistItemsRemaining={setChecklistItemsRemaining}
        />
      </SnapshotProvider>
    </>
  );
};

export default BanditExperimentPage;
