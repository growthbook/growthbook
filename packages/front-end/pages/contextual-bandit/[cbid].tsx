import { useRouter } from "next/router";
import React, { ReactElement, useState } from "react";
import { useContextualBandit } from "@/hooks/useContextualBandits";
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
import ContextualBanditMetricsModal from "@/components/ContextualBandit/ContextualBanditMetricsModal";
import ContextualBanditTargetingModal from "@/components/ContextualBandit/ContextualBanditTargetingModal";
import ContextualBanditVariationsModal from "@/components/ContextualBandit/ContextualBanditVariationsModal";

const ContextualBanditPage = (): ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const router = useRouter();
  const { cbid } = router.query;
  const { organization, hasCommercialFeature } = useUser();
  const hasContextualBanditFeature = hasCommercialFeature("contextual-bandits");
  const environments = useEnvironments();
  const { apiCall } = useAuth();

  const [metricsModalOpen, setMetricsModalOpen] = useState(false);
  const [variationsModalOpen, setVariationsModalOpen] = useState(false);
  const [targetingModalOpen, setTargetingModalOpen] = useState(false);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);

  const rawId = typeof cbid === "string" ? cbid : "";
  const {
    contextualBandit: cb,
    loading,
    mutate,
  } = useContextualBandit(rawId || undefined);

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
          editMetrics={canEdit ? () => setMetricsModalOpen(true) : undefined}
          editVariations={
            canEdit ? () => setVariationsModalOpen(true) : undefined
          }
          editTargeting={
            canEdit ? () => setTargetingModalOpen(true) : undefined
          }
          editTags={canEdit ? () => setTagsModalOpen(true) : undefined}
          editProject={canEdit ? () => setProjectModalOpen(true) : undefined}
          duplicate={canEdit ? () => setDuplicateModalOpen(true) : undefined}
        />
      </div>

      {metricsModalOpen && (
        <ContextualBanditMetricsModal
          cb={cb}
          mutate={mutate}
          close={() => setMetricsModalOpen(false)}
        />
      )}
      {variationsModalOpen && (
        <ContextualBanditVariationsModal
          cb={cb}
          mutate={mutate}
          close={() => setVariationsModalOpen(false)}
        />
      )}
      {targetingModalOpen && (
        <ContextualBanditTargetingModal
          cb={cb}
          mutate={mutate}
          close={() => setTargetingModalOpen(false)}
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
            hypothesis: cb.hypothesis,
            hashAttribute: cb.hashAttribute,
            hashVersion: cb.hashVersion,
            datasource: cb.datasource,
            exposureQueryId: cb.exposureQueryId,
            goalMetrics: cb.goalMetrics,
            secondaryMetrics: cb.secondaryMetrics,
            guardrailMetrics: cb.guardrailMetrics,
            activationMetric: cb.activationMetric,
            attributionModel: cb.attributionModel,
            regressionAdjustmentEnabled: cb.regressionAdjustmentEnabled,
            coverage: cb.coverage,
            condition: cb.condition,
            variationWeights: cb.variationWeights,
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
