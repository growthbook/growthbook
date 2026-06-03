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
import useApi from "@/hooks/useApi";
import { useContextualBanditByExperiment } from "@/hooks/useContextualBandits";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import EditMetricsForm from "@/components/Experiment/EditMetricsForm";
import StopExperimentForm from "@/components/Experiment/StopExperimentForm";
import EditVariationsForm from "@/components/Experiment/EditVariationsForm";
import ContextualBanditForm from "@/enterprise/components/ContextualBandit/ContextualBanditForm";
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
import Callout from "@/ui/Callout";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import { useUser } from "@/services/UserContext";

/**
 * Defensive warning when the underlying CB-typed experiment isn't paired
 * with a CB doc. Should be vacuously true once PR-8's migration has run;
 * dropped alongside the experiment-id URL scheme.
 */
function CbPairCheck({ experimentId }: { experimentId: string }): ReactElement {
  const cb = useContextualBanditByExperiment(experimentId);
  if (cb) return <></>;
  return (
    <Callout status="warning" mb="3">
      No Contextual Bandit doc is paired with this experiment. Results, weights,
      and start/stop actions may not behave as expected. Run the CB-decoupling
      migration (
      <code>pnpm --filter back-end migrate-cb-decoupling --apply</code>) or
      re-create the CB to repair the pairing.
    </Callout>
  );
}

const ContextualBanditExperimentPage = (): ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const router = useRouter();
  const { cbid } = router.query;
  const { hasCommercialFeature } = useUser();
  const hasContextualBanditFeature = hasCommercialFeature("contextual-bandits");

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
  const [checklistHardBlockerCount, setChecklistHardBlockerCount] = useState(0);

  const { data, error, mutate } = useApi<{
    experiment: ExperimentInterfaceStringDates;
    idea?: IdeaInterface;
    visualChangesets: VisualChangesetInterface[];
    linkedFeatures: LinkedFeatureInfo[];
    envs: string[];
    urlRedirects: URLRedirectInterface[];
    visualChangesetEnvStates?: LinkedChangeEnvStates;
    urlRedirectEnvStates?: LinkedChangeEnvStates;
  }>(`/experiment/${cbid}`);

  useSwitchOrg(data?.experiment?.organization ?? null);

  const { apiCall } = useAuth();

  useEffect(() => {
    if (!data?.experiment) return;
    if (!data.experiment?.type || data.experiment.type === "standard") {
      router.replace(
        window.location.href.replace("contextual-bandit/", "experiment/"),
      );
    }
    if (data?.experiment?.type === "holdout") {
      let url = window.location.href.replace(
        /(.*)\/contextual-bandit\/.*/,
        "$1/holdout/",
      );
      url += data?.experiment?.holdoutId;
      router.replace(url);
    }
    if (data.experiment.type === "multi-armed-bandit") {
      router.replace(
        window.location.href.replace("contextual-bandit/", "bandit/"),
      );
    }
  }, [data, router]);

  if (error) {
    return <div>There was a problem loading the experiment</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }
  if (!hasContextualBanditFeature) {
    return (
      <div className="contents container-fluid pagecontents">
        <PremiumEmptyState
          h1="Contextual Bandits"
          title="Run Context-Aware Adaptive Experiments with Contextual Bandits"
          description="Contextual Bandits automatically guide more traffic to better variants based on user context."
          commercialFeature="contextual-bandits"
          learnMoreLink="https://docs.growthbook.io/bandits/overview"
        />
      </div>
    );
  }

  const {
    experiment,
    visualChangesets = [],
    linkedFeatures = [],
    urlRedirects = [],
    visualChangesetEnvStates,
    urlRedirectEnvStates,
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
          source="cbid"
        />
      )}
      {stopModalOpen && (
        <StopExperimentForm
          close={() => setStopModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          source="cbid"
        />
      )}
      {variationsModalOpen && (
        <EditVariationsForm
          experiment={experiment}
          cancel={() => setVariationsModalOpen(false)}
          onlySafeToEditVariationMetadata={false}
          mutate={mutate}
          source="cbid"
        />
      )}
      {duplicateModalOpen && (
        <ContextualBanditForm
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
          source="duplicate-cbid"
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
          source="cbid"
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
              <Callout status="error" mb="2">
                Changing the project may prevent your linked Feature Flags,
                Visual Changes, and URL Redirects from being sent to users.
              </Callout>
            ) : null
          }
          source="cbid"
        />
      )}
      {phaseModalOpen && (
        <NewPhaseForm
          close={() => setPhaseModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          source="cbid"
        />
      )}
      {editPhaseId !== null && (
        <EditPhaseModal
          close={() => setEditPhaseId(null)}
          experiment={experiment}
          mutate={mutate}
          i={editPhaseId}
          editTargeting={editTargeting}
          source="cbid"
        />
      )}
      {editPhasesOpen && (
        <EditPhasesModal
          close={() => setEditPhasesOpen(false)}
          mutateExperiment={mutate}
          experiment={experiment}
          editTargeting={editTargeting}
          source="cbid"
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
            display: "Contextual Bandits",
            href: `/contextual-bandits`,
          },
          { display: experiment.name },
        ]}
      />

      {/*
       * Defensive pair-check: the page is keyed by experiment id during
       * the decoupling window and the existing /experiment/${id} fetch
       * doesn't know whether a CB doc actually exists for this id.
       * Warn (don't block) so users can spot orphaned state — typically
       * the result of a half-completed CB create, a mis-routed link, or
       * a row left behind by an aborted migration.
       *
       * Removed in PR-8 alongside the URL switch to CB ids.
       */}
      <CbPairCheck experimentId={experiment.id} />

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
          checklistHardBlockerCount={checklistHardBlockerCount}
          setChecklistItemsRemaining={setChecklistItemsRemaining}
          setChecklistHardBlockerCount={setChecklistHardBlockerCount}
          visualChangesetEnvStates={visualChangesetEnvStates}
          urlRedirectEnvStates={urlRedirectEnvStates}
        />
      </SnapshotProvider>
    </>
  );
};

export default ContextualBanditExperimentPage;
