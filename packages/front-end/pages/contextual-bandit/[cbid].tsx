import { useRouter } from "next/router";
import React, { ReactElement, useMemo, useState } from "react";
import { includeExperimentInPayload } from "shared/util";
import { ApiContextualBanditInterface } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useContextualBandit } from "@/hooks/useContextualBandits";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import EditMetricsForm from "@/components/Experiment/EditMetricsForm";
import StopExperimentForm from "@/components/Experiment/StopExperimentForm";
import EditVariationsForm from "@/components/Experiment/EditVariationsForm";
import ContextualBanditForm from "@/enterprise/components/ContextualBandit/ContextualBanditForm";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import EditProjectForm from "@/components/Experiment/EditProjectForm";
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

// Project a CB API doc to the experiment shape legacy components on this page expect.
function contextualBanditToExperimentShape(
  cb: ApiContextualBanditInterface,
  org: { id: string },
): ExperimentInterfaceStringDates {
  return {
    id: cb.id,
    organization: org.id,
    dateCreated: cb.dateCreated,
    dateUpdated: cb.dateUpdated,
    name: cb.name,
    description: cb.description,
    hypothesis: cb.hypothesis,
    project: cb.project,
    owner: cb.owner,
    tags: cb.tags,
    archived: cb.archived,
    customFields: cb.customFields,
    status: cb.status,
    trackingKey: cb.trackingKey,
    hashAttribute: cb.hashAttribute,
    fallbackAttribute: cb.fallbackAttribute,
    hashVersion: cb.hashVersion,
    disableStickyBucketing: cb.disableStickyBucketing,
    // CB API omits `screenshots`; default to [] so experiment-shape consumers don't throw.
    variations: cb.variations.map((v) => ({ ...v, screenshots: [] })),
    // CB doc no longer carries a `phases` array; synthesize a single-element phase from the
    // lifted root fields so legacy experiment-form components on this page keep working.
    phases: [
      {
        dateStarted: cb.dateStarted ?? cb.dateCreated,
        dateEnded: cb.dateStopped ?? undefined,
        name: "Main",
        reason: "",
        coverage: cb.coverage ?? 1,
        condition: cb.condition ?? "",
        variationWeights: cb.variationWeights ?? cb.variations.map(() => 1),
        variations: cb.variations.map((v) => ({ id: v.id })),
        seed: cb.seed,
      },
    ],
    datasource: cb.datasource,
    exposureQueryId: cb.exposureQueryId,
    segment: cb.segment,
    queryFilter: cb.queryFilter,
    goalMetrics: cb.goalMetrics,
    secondaryMetrics: cb.secondaryMetrics,
    guardrailMetrics: cb.guardrailMetrics,
    activationMetric: cb.activationMetric,
    attributionModel: cb.attributionModel,
    skipPartialData: cb.skipPartialData,
    regressionAdjustmentEnabled: cb.regressionAdjustmentEnabled,
    type: "contextual-bandit",
    implementation: "code",
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    releasedVariationId: "",
    autoSnapshots: false,
    hasVisualChangesets: false,
    hasURLRedirects: false,
    linkedFeatures: [],
  } as unknown as ExperimentInterfaceStringDates;
}

const ContextualBanditExperimentPage = (): ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const router = useRouter();
  const { cbid } = router.query;
  const { organization, hasCommercialFeature } = useUser();
  const hasContextualBanditFeature = hasCommercialFeature("contextual-bandits");
  const environments = useEnvironments();
  const { apiCall } = useAuth();

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

  const rawId = typeof cbid === "string" ? cbid : "";
  const {
    contextualBandit: cb,
    loading,
    mutate,
  } = useContextualBandit(rawId || undefined);

  const orgId = organization.id ?? "";
  useSwitchOrg(cb?.id && orgId ? orgId : null);

  const experiment = useMemo(
    () => (cb ? contextualBanditToExperimentShape(cb, { id: orgId }) : null),
    [cb, orgId],
  );

  const envs = useMemo(() => environments.map((e) => e.id), [environments]);

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

  if (loading) {
    return <LoadingOverlay />;
  }
  if (!cb || !experiment) {
    return (
      <div className="contents container-fluid pagecontents">
        <Callout status="error" mt="4">
          Contextual Bandit not found.
        </Callout>
      </div>
    );
  }

  // Phase-shape modals still call legacy experiment routes; phase shape diverges.
  const cbUpdateEndpoint = `/api/v1/contextual-bandits/${cb.id}`;
  const cbStopEndpoint = `/api/v1/contextual-bandits/${cb.id}/stop`;

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

  // TODO(pr-8): plumb linked-feature info through the CB GET response.
  const linkedFeatures = [];

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
          source="cbid"
          updateEndpoint={cbUpdateEndpoint}
          updateMethod="PUT"
        />
      )}
      {stopModalOpen && (
        <StopExperimentForm
          close={() => setStopModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          source="cbid"
          updateEndpoint={cbUpdateEndpoint}
          updateMethod="PUT"
          stopEndpoint={cbStopEndpoint}
        />
      )}
      {variationsModalOpen && (
        <EditVariationsForm
          experiment={experiment}
          cancel={() => setVariationsModalOpen(false)}
          onlySafeToEditVariationMetadata={false}
          mutate={mutate}
          source="cbid"
          updateEndpoint={cbUpdateEndpoint}
          updateMethod="PUT"
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
            await apiCall(cbUpdateEndpoint, {
              method: "PUT",
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
          apiEndpoint={cbUpdateEndpoint}
          method="PUT"
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
      {/* TODO(pr-8): phase-shape modals still write through the legacy experiment phase route. */}
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
          updateEndpoint={cbUpdateEndpoint}
          updateMethod="PUT"
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

      <SnapshotProvider experiment={experiment}>
        <TabbedPage
          experiment={experiment}
          linkedFeatures={linkedFeatures}
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
          checklistHardBlockerCount={checklistHardBlockerCount}
          setChecklistItemsRemaining={setChecklistItemsRemaining}
          setChecklistHardBlockerCount={setChecklistHardBlockerCount}
        />
      </SnapshotProvider>
    </>
  );
};

export default ContextualBanditExperimentPage;
