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
import EditTargetingModal from "@/components/Experiment/EditTargetingModal";
import TabbedPage from "@/components/Experiment/TabbedPage";
import { useStagedTargeting } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const BanditExperimentPage = (): ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const router = useRouter();
  const { bid } = router.query;

  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [metricsModalOpen, setMetricsModalOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [targetingModalOpen, setTargetingModalOpen] = useState(false);

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
  }>(`/experiment/${bid}`);
  const targeting = useStagedTargeting(data?.experiment);

  useSwitchOrg(data?.experiment?.organization ?? null);

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
    visualChangesetEnvStates,
    urlRedirectEnvStates,
  } = data;

  const canEditExperiment =
    permissionsUtil.canViewExperimentModal(experiment.project) &&
    !experiment.archived;

  // The server asks for both: edit rights, and run rights where it serves.
  let canRunExperiment = canEditExperiment;
  if (data.envs.length > 0) {
    if (!permissionsUtil.canRunExperiment(experiment, data.envs)) {
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
  const editTargeting = canRunExperiment
    ? () => setTargetingModalOpen(true)
    : null;

  const safeToEdit = canEditDeliveryInPlace(experiment);

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
      {targetingModalOpen && (
        <EditTargetingModal
          close={() => setTargetingModalOpen(false)}
          mutate={mutate}
          experiment={experiment}
          linkedFeatures={linkedFeatures}
          safeToEdit={safeToEdit}
          stageChanges={targeting.stage}
          draft={targeting.value}
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
          datasourceMissing={!!data?.datasourceMissing}
          linkedFeatures={linkedFeatures}
          mutate={mutate}
          visualChangesets={visualChangesets}
          urlRedirects={urlRedirects}
          editMetrics={editMetrics}
          editResult={editResult}
          duplicate={duplicate}
          envs={data.envs}
          editTargeting={editTargeting}
          targetingDraft={targeting}
          canAddVariation={canRunExperiment}
          visualChangesetEnvStates={visualChangesetEnvStates}
          urlRedirectEnvStates={urlRedirectEnvStates}
        />
      </SnapshotProvider>
    </>
  );
};

export default BanditExperimentPage;
