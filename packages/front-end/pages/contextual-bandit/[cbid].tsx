import { useRouter } from "next/router";
import React, { ReactElement, useState } from "react";
import {
  useContextualBandit,
  useContextualBanditLinkedFeatures,
} from "@/hooks/useContextualBandits";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import ContextualBanditForm from "@/enterprise/components/ContextualBandit/ContextualBanditForm";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import EditProjectForm from "@/components/Experiment/EditProjectForm";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import ContextualBanditDetailPage from "@/components/ContextualBandit/ContextualBanditDetailPage";
import ContextualBanditDescriptionModal from "@/components/ContextualBandit/ContextualBanditDescriptionModal";
import ContextualBanditOverviewModal from "@/components/ContextualBandit/ContextualBanditOverviewModal";
import ContextualBanditAnalysisMetricsModal from "@/components/ContextualBandit/ContextualBanditAnalysisMetricsModal";
import ContextualBanditTrafficTargetingModal from "@/components/ContextualBandit/ContextualBanditTrafficTargetingModal";
import ContextualBanditVariationsModal from "@/components/ContextualBandit/ContextualBanditVariationsModal";
import LinkFeatureToContextualBanditModal from "@/components/Features/FeatureModal/LinkFeatureToContextualBanditModal";

const ContextualBanditPage = (): ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const router = useRouter();
  const { cbid } = router.query;
  const { organization, hasCommercialFeature } = useUser();
  const hasContextualBanditFeature = hasCommercialFeature("contextual-bandits");
  const environments = useEnvironments();
  const { apiCall } = useAuth();

  const [overviewModalOpen, setOverviewModalOpen] = useState(false);
  const [analysisMetricsModalOpen, setAnalysisMetricsModalOpen] =
    useState(false);
  const [variationsModalOpen, setVariationsModalOpen] = useState(false);
  const [trafficTargetingModalOpen, setTrafficTargetingModalOpen] =
    useState(false);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [featureModalOpen, setFeatureModalOpen] = useState(false);

  const rawId = typeof cbid === "string" ? cbid : "";
  const {
    contextualBandit: cb,
    loading,
    mutate,
  } = useContextualBandit(rawId || undefined);
  const { linkedFeatures, mutate: mutateLinkedFeatures } =
    useContextualBanditLinkedFeatures(rawId || undefined);

  const orgId = organization.id ?? "";
  useSwitchOrg(cb?.id && orgId ? orgId : null);

  const envs = environments.map((e) => e.id);

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
  if (!cb) {
    return (
      <div className="contents container-fluid pagecontents">
        <Callout status="error" mt="4">
          Contextual Bandit not found.
        </Callout>
      </div>
    );
  }

  const updateEndpoint = `/api/v1/contextual-bandits/${cb.id}`;
  const canEdit =
    permissionsUtil.canViewContextualBanditModal(cb.project) && !cb.archived;
  // Variation edits are additionally blocked once the bandit is stopped: its
  // arm set + weights are frozen, and there's no live payload to reconcile.
  const canEditVariations = canEdit && cb.status !== "stopped";
  const canRun =
    !cb.archived &&
    permissionsUtil.canRunContextualBandit({ project: cb.project }, envs);

  return (
    <>
      <PageHead
        breadcrumb={[
          { display: "Contextual Bandits", href: `/contextual-bandits` },
          { display: cb.name },
        ]}
      />

      <div className="contents container-fluid pagecontents">
        <ContextualBanditDetailPage
          cb={cb}
          mutate={mutate}
          canRun={canRun}
          editOverview={canEdit ? () => setOverviewModalOpen(true) : undefined}
          editAnalysisMetrics={
            canEdit ? () => setAnalysisMetricsModalOpen(true) : undefined
          }
          editVariations={
            canEditVariations ? () => setVariationsModalOpen(true) : undefined
          }
          editTrafficTargeting={
            canEdit ? () => setTrafficTargetingModalOpen(true) : undefined
          }
          editTags={canEdit ? () => setTagsModalOpen(true) : undefined}
          editProject={canEdit ? () => setProjectModalOpen(true) : undefined}
          editDescription={
            canEdit ? () => setDescriptionModalOpen(true) : undefined
          }
          duplicate={canEdit ? () => setDuplicateModalOpen(true) : undefined}
          linkedFeatures={linkedFeatures}
          linkedFeaturesMutate={mutateLinkedFeatures}
          canAddFeature={canEdit}
          setFeatureModal={
            canEdit ? (open) => setFeatureModalOpen(open) : undefined
          }
        />
      </div>

      {overviewModalOpen && (
        <ContextualBanditOverviewModal
          cb={cb}
          mutate={mutate}
          close={() => setOverviewModalOpen(false)}
        />
      )}
      {descriptionModalOpen && (
        <ContextualBanditDescriptionModal
          cb={cb}
          mutate={mutate}
          close={() => setDescriptionModalOpen(false)}
        />
      )}
      {analysisMetricsModalOpen && (
        <ContextualBanditAnalysisMetricsModal
          cb={cb}
          mutate={mutate}
          close={() => setAnalysisMetricsModalOpen(false)}
        />
      )}
      {variationsModalOpen && (
        <ContextualBanditVariationsModal
          cb={cb}
          linkedFeatures={linkedFeatures}
          mutate={() => {
            mutate();
            mutateLinkedFeatures();
          }}
          close={() => setVariationsModalOpen(false)}
        />
      )}
      {trafficTargetingModalOpen && (
        <ContextualBanditTrafficTargetingModal
          cb={cb}
          mutate={mutate}
          close={() => setTrafficTargetingModalOpen(false)}
        />
      )}
      {tagsModalOpen && (
        <EditTagsForm
          tags={cb.tags}
          save={async (tags) => {
            await apiCall(updateEndpoint, {
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
                  "The dropdown below has been filtered to only include projects where you have permission to update Contextual Bandits"
                }
              />
            </>
          }
          cancel={() => setProjectModalOpen(false)}
          permissionRequired={(project) =>
            permissionsUtil.canUpdateContextualBandit(
              { project: cb.project },
              { project },
            )
          }
          mutate={mutate}
          current={cb.project}
          apiEndpoint={updateEndpoint}
          method="PUT"
          source="cbid"
        />
      )}
      {featureModalOpen && (
        <LinkFeatureToContextualBanditModal
          cb={cb}
          existingLinkedFeatureIds={linkedFeatures.map(
            (info) => info.feature.id,
          )}
          mutate={() => {
            mutate();
            mutateLinkedFeatures();
          }}
          close={() => setFeatureModalOpen(false)}
          source="cbid"
        />
      )}
      {duplicateModalOpen && (
        <ContextualBanditForm
          onClose={() => setDuplicateModalOpen(false)}
          initialValue={{
            name: cb.name + " (Copy)",
            trackingKey: "",
            status: "draft",
            project: cb.project,
            tags: cb.tags,
            description: cb.description,
            hashAttribute: cb.hashAttribute,
            datasource: cb.datasource,
            exposureQueryId: cb.contextualBanditQueryId,
            decisionMetric: cb.decisionMetric,
            coverage: cb.coverage,
            condition: cb.condition,
            variationWeights: cb.variations.map(
              (v) =>
                cb.variationWeights?.find((w) => w.variationId === v.id)
                  ?.weight ?? 1 / cb.variations.length,
            ),
            variations: cb.variations.map((v) => ({
              id: v.id,
              key: v.key,
              name: v.name,
              description: v.description,
              screenshots: [],
            })),
          }}
          duplicate={true}
          source="duplicate-cbid"
        />
      )}
    </>
  );
};

export default ContextualBanditPage;
