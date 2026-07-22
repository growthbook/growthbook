import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { useState } from "react";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { experimentHasLiveLinkedChanges } from "shared/util";
import { Flex } from "@radix-ui/themes";
import LinkedChanges from "@/components/Experiment/LinkedChanges/LinkedChanges";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import EditVariationMetadataModal from "@/components/Experiment/EditVariationMetadataModal";
import TrafficAndTargeting from "@/components/Experiment/TabbedPage/TrafficAndTargeting";
import TrafficAllocationFunnel from "@/components/Experiment/TabbedPage/TrafficAllocationFunnel";
import AnalysisSettings from "@/components/Experiment/TabbedPage/AnalysisSettings";
import DecisionMakingSettings from "@/components/Experiment/TabbedPage/DecisionMakingSettings";
import Callout from "@/ui/Callout";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import LinkedExperimentsTable from "@/components/Holdout/LinkedExperimentsTable";
import LinkedFeaturesTable from "@/components/Holdout/LinkedFeaturesTable";
import EditEnvironmentsModal from "@/components/Holdout/EditEnvironmentsModal";
import Link from "@/ui/Link";
import CounterBadge from "@/ui/Badge/CounterBadge";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Frame from "@/ui/Frame";
import HoldoutEnvironments from "./HoldoutEnvironments";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterfaceStringDates;
  holdoutFeatures?: FeatureInterface[];
  holdoutExperiments?: ExperimentInterfaceStringDates[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  mutate: () => void;
  editTargeting?: (() => void) | null;
  editTraffic?: ((variationId?: string) => void) | null;
  addVariation?: (() => void) | null;
  editNamespace?: (() => void) | null;
  editVariations?: (() => void) | null;
  setFeatureModal: (open: boolean) => void;
  setVisualEditorModal: (open: boolean) => void;
  setUrlRedirectModal: (open: boolean) => void;
  linkedFeatures: LinkedFeatureInfo[];
  envs: string[];
  visualChangesetEnvStates?: LinkedChangeEnvStates;
  urlRedirectEnvStates?: LinkedChangeEnvStates;
}

export default function Implementation({
  experiment,
  holdout,
  holdoutExperiments,
  holdoutFeatures,
  visualChangesets,
  urlRedirects,
  mutate,
  editTargeting,
  editTraffic,
  addVariation,
  editNamespace,
  editVariations,
  setFeatureModal,
  setVisualEditorModal,
  setUrlRedirectModal,
  linkedFeatures,
  envs,
  visualChangesetEnvStates,
  urlRedirectEnvStates,
}: Props) {
  const [showEditEnvironmentsModal, setShowEditEnvironmentsModal] =
    useState(false);
  const [editMetadataIndex, setEditMetadataIndex] = useState<number | null>(
    null,
  );
  const phases = experiment.phases || [];
  const { apiCall } = useAuth();

  const permissionsUtil = usePermissionsUtil();

  const canEditExperiment =
    !experiment.archived &&
    permissionsUtil.canViewExperimentModal(experiment.project);

  const hasVisualEditorPermission =
    canEditExperiment && permissionsUtil.canRunExperiment(experiment, []);

  const canAddLinkedChanges =
    hasVisualEditorPermission &&
    experiment.status === "draft" &&
    !experiment.nextScheduledStatusUpdate;

  const hasLinkedChanges =
    experiment.hasVisualChangesets ||
    linkedFeatures.length > 0 ||
    experiment.hasURLRedirects;

  const holdoutHasLinkedExpOrFeatures =
    holdoutExperiments?.length || holdoutFeatures?.length;

  const [tab, setTab] = useState<"experiments" | "features">(
    holdoutExperiments?.length ? "experiments" : "features",
  );

  const isHoldout = experiment.type === "holdout";

  const safeToEdit =
    experiment.status !== "running" ||
    !experimentHasLiveLinkedChanges(experiment, linkedFeatures);

  // Temporary check while we test the new traffic funnel
  // TODO: Remove this once we're ready to support holdouts in the new traffic funnel UI.
  const showTrafficFunnel = !isHoldout;
  const canEditHoldoutDefaultState =
    isHoldout &&
    !!holdout &&
    !experiment.archived &&
    experiment.status !== "stopped" &&
    permissionsUtil.canUpdateHoldout(holdout, { projects: holdout.projects });

  async function setHoldoutDefaultState(isDefault: boolean) {
    if (!holdout) return;
    await apiCall(`/holdout/${holdout.id}`, {
      method: "PUT",
      body: JSON.stringify({
        skipAsDefaultHoldout: !isDefault,
      }),
    });
    await mutate();
  }

  return (
    <>
      {showEditEnvironmentsModal && holdout && (
        <EditEnvironmentsModal
          holdout={holdout}
          experiment={experiment}
          handleCloseModal={() => setShowEditEnvironmentsModal(false)}
          mutate={mutate}
        />
      )}
      {editMetadataIndex !== null && canEditExperiment && (
        <EditVariationMetadataModal
          experiment={experiment}
          variationIndex={editMetadataIndex}
          close={() => setEditMetadataIndex(null)}
          mutate={mutate}
          source="implementation-tab"
        />
      )}
      <div className="my-4">
        <Heading as="h2" size="large" color="text-high" mb="2">
          Implementation
        </Heading>
        {showTrafficFunnel ? (
          <TrafficAllocationFunnel
            experiment={experiment}
            editTraffic={
              experiment.nextScheduledStatusUpdate ? null : editTraffic
            }
            editTargeting={
              experiment.nextScheduledStatusUpdate ? null : editTargeting
            }
            editNamespace={
              experiment.nextScheduledStatusUpdate ? null : editNamespace
            }
            addVariation={
              experiment.nextScheduledStatusUpdate ? null : addVariation
            }
            setEditVariationIndex={setEditMetadataIndex}
            canEditExperiment={canEditExperiment}
            safeToEdit={safeToEdit}
            mutate={mutate}
            phaseIndex={phases.length - 1}
          />
        ) : (
          <TrafficAndTargeting
            experiment={experiment}
            editTraffic={
              experiment.nextScheduledStatusUpdate ? null : editTraffic
            }
            editTargeting={
              experiment.nextScheduledStatusUpdate ? null : editTargeting
            }
            phaseIndex={phases.length - 1}
          />
        )}
        {!isHoldout &&
        (!showTrafficFunnel || hasLinkedChanges || canAddLinkedChanges) ? (
          <LinkedChanges
            linkedFeatures={linkedFeatures}
            experiment={experiment}
            canAddChanges={canAddLinkedChanges}
            visualChangesets={visualChangesets}
            urlRedirects={urlRedirects}
            mutate={mutate}
            canEditVisualChangesets={hasVisualEditorPermission}
            visualChangesetEnvStates={visualChangesetEnvStates}
            urlRedirectEnvStates={urlRedirectEnvStates}
            setVisualEditorModal={setVisualEditorModal}
            setFeatureModal={setFeatureModal}
            setUrlRedirectModal={setUrlRedirectModal}
            onAddVariation={editVariations ?? undefined}
            canEditExperiment={canEditExperiment}
            setEditVariationIndex={setEditMetadataIndex}
            hideVariations={showTrafficFunnel}
          />
        ) : null}

        {isHoldout && holdout ? (
          <HoldoutEnvironments
            editEnvironments={() => setShowEditEnvironmentsModal(true)}
            environments={holdout.environmentSettings ?? {}}
          />
        ) : null}
        {isHoldout && holdout ? (
          <Frame>
            <Heading color="text-high" as="h4" size="small" mb="0">
              Included Experiments & Features
            </Heading>
            {/* TODO: Add a state for a stopped holdout with no experiments or features? */}
            {experiment.status === "draft" ? (
              <Text>
                <em>
                  Start the Holdout to allow new Experiments and Features to be
                  added.
                </em>
              </Text>
            ) : !holdoutHasLinkedExpOrFeatures ? (
              <Text>
                <em>
                  Add new <Link href="/experiments">Experiments</Link> and{" "}
                  <Link href="/features">Features</Link> to this Holdout.
                </em>
              </Text>
            ) : (
              <>
                <Tabs
                  value={tab}
                  onValueChange={(value) =>
                    setTab(value as "experiments" | "features")
                  }
                >
                  <TabsList size="2">
                    <TabsTrigger value="experiments">
                      Experiments
                      {!!holdoutExperiments?.length && (
                        <CounterBadge
                          color="slate"
                          count={holdoutExperiments.length}
                          ml="2"
                        />
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="features">
                      Features
                      {!!holdoutFeatures?.length && (
                        <CounterBadge
                          color="slate"
                          count={holdoutFeatures.length}
                          ml="2"
                        />
                      )}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                {tab === "experiments" && (
                  <LinkedExperimentsTable
                    holdout={holdout}
                    experiments={holdoutExperiments ?? []}
                  />
                )}
                {tab === "features" && (
                  <LinkedFeaturesTable
                    holdout={holdout}
                    features={holdoutFeatures ?? []}
                  />
                )}
              </>
            )}
            <Flex align="center" justify="between" mt="3">
              <Checkbox
                value={!holdout.skipAsDefaultHoldout}
                disabled={!canEditHoldoutDefaultState}
                setValue={(isDefault) => {
                  void setHoldoutDefaultState(isDefault);
                }}
                label="Use this holdout as a default for new experiments or features."
                weight="regular"
              />
            </Flex>
          </Frame>
        ) : null}
        {(experiment.status !== "draft" ||
          !!experiment.nextScheduledStatusUpdate) &&
        !hasLinkedChanges &&
        !isHoldout ? (
          <Callout status="info" mb="4">
            This experiment has no linked GrowthBook implementation (linked
            feature flag, visual editor changes, or URL redirect).{" "}
            {experiment.status === "stopped"
              ? "Either the implementation was deleted or the implementation, traffic, and targeting were managed by an external system."
              : "The implementation, traffic, and targeting may be managed by an external system."}
          </Callout>
        ) : null}
        <AnalysisSettings
          experiment={experiment}
          mutate={mutate}
          envs={envs}
          canEdit={!!editTargeting && !experiment.nextScheduledStatusUpdate}
        />
        <DecisionMakingSettings
          experiment={experiment}
          mutate={mutate}
          canEdit={!!editTargeting && !experiment.nextScheduledStatusUpdate}
        />
      </div>
    </>
  );
}
