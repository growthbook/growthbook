import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
  Variation,
} from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { useEffect, useMemo, useState } from "react";
import {
  HoldoutInterfaceStringDates,
  type ImplementationType,
} from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import {
  canEditDeliveryInPlace,
  experimentHasLinkedChanges,
  getImplementationType,
  isManagedByExperiment,
} from "shared/util";
import { getActivePhaseIndex } from "shared/experiments";
import { Flex, Separator } from "@radix-ui/themes";
import LinkedChanges from "@/components/Experiment/LinkedChanges/LinkedChanges";
import { useManagedExperimentFlags } from "@/hooks/useManagedExperimentFlags";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import EditVariationMetadataModal from "@/components/Experiment/EditVariationMetadataModal";
import EditVariationKeyModal from "@/components/Experiment/EditVariationKeyModal";
import TrafficAndTargeting from "@/components/Experiment/TabbedPage/TrafficAndTargeting";
import TrafficAllocationFunnel, {
  TargetingDraft,
} from "@/components/Experiment/TabbedPage/TrafficAllocationFunnel";
import AnalysisSettings from "@/components/Experiment/TabbedPage/AnalysisSettings";
import AnalysisPlan from "@/components/Experiment/TabbedPage/AnalysisPlan";
import DecisionPlan from "@/components/Experiment/TabbedPage/DecisionPlan";
import Callout from "@/ui/Callout";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import LinkedExperimentsTable from "@/components/Holdout/LinkedExperimentsTable";
import LinkedFeaturesTable from "@/components/Holdout/LinkedFeaturesTable";
import EditEnvironmentsModal from "@/components/Holdout/EditEnvironmentsModal";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Frame from "@/ui/Frame";
import ChangeImplementationTypeModal, {
  ImplementationTypeChooserContext,
  implementationTypeLockedReason,
} from "@/components/Experiment/ChangeImplementationTypeModal";
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import HoldoutEnvironments from "./HoldoutEnvironments";
import {
  experimentFieldChanges,
  FlagEnvironmentsDraft,
  HoldoutDraft,
  ImplementationTypeDraft,
  useLiveView,
  useRegisterExperimentEdit,
} from "./ExperimentEdits";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  /** The page's staged implementation type; this section renders as if saved. */
  implementationTypeDraft?: ImplementationTypeDraft;
  /** Viewing an old phase: nothing staged here can change. */
  disableEditing?: boolean;
  /** The page's staged holdout, which the traffic funnel edits. */
  holdoutDraft?: HoldoutDraft;
  holdout?: HoldoutInterfaceStringDates;
  holdoutFeatures?: FeatureInterface[];
  holdoutExperiments?: ExperimentInterfaceStringDates[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  mutate: () => void;
  editTargeting?: (() => void) | null;
  targetingDraft?: TargetingDraft;
  analysisSettingsOpen?: boolean;
  setAnalysisSettingsOpen?: (open: boolean) => void;
  editTraffic?: (() => void) | null;
  canAddVariation?: boolean;
  editNamespace?: (() => void) | null;
  setFeatureModal: (open: boolean) => void;
  setVisualEditorModal: (open: boolean) => void;
  setUrlRedirectModal: (open: boolean) => void;
  linkedFeatures: LinkedFeatureInfo[];
  envs: string[];
  visualChangesetEnvStates?: LinkedChangeEnvStates;
  urlRedirectEnvStates?: LinkedChangeEnvStates;
}

export default function Implementation({
  experiment: storedExperiment,
  implementationTypeDraft,
  disableEditing,
  holdoutDraft,
  holdout,
  holdoutExperiments,
  holdoutFeatures,
  visualChangesets,
  urlRedirects,
  mutate,
  editTargeting,
  targetingDraft,
  analysisSettingsOpen,
  setAnalysisSettingsOpen,
  editTraffic,
  canAddVariation,
  editNamespace,
  setFeatureModal,
  setVisualEditorModal,
  setUrlRedirectModal,
  linkedFeatures: storedLinkedFeatures,
  envs,
  visualChangesetEnvStates,
  urlRedirectEnvStates,
}: Props) {
  const stagedType = implementationTypeDraft?.value?.type;
  const managedId =
    storedLinkedFeatures.find((f) =>
      isManagedByExperiment(f.feature, storedExperiment.id),
    )?.feature.id ?? null;
  // A staged type that deletes the managed flag hides it until the save.
  const hidesManagedFlag =
    !!managedId &&
    !!stagedType &&
    stagedType !== "values" &&
    stagedType !== "feature";
  // Linkages decide a derived type, so the flag leaves them too.
  const experiment = useMemo(
    () =>
      stagedType
        ? {
            ...storedExperiment,
            implementationType: stagedType,
            ...(hidesManagedFlag && {
              linkedFeatures: (storedExperiment.linkedFeatures ?? []).filter(
                (id) => id !== managedId,
              ),
            }),
          }
        : storedExperiment,
    [storedExperiment, stagedType, hidesManagedFlag, managedId],
  );
  const linkedFeatures = useMemo(
    () =>
      hidesManagedFlag
        ? storedLinkedFeatures.filter((f) => f.feature.id !== managedId)
        : storedLinkedFeatures,
    [storedLinkedFeatures, hidesManagedFlag, managedId],
  );
  // Filled by the traffic funnel's values toggle.
  const [headerActions, setHeaderActions] = useState<HTMLDivElement | null>(
    null,
  );
  const [showEditEnvironmentsModal, setShowEditEnvironmentsModal] =
    useState(false);
  const [editMetadataIndex, setEditMetadataIndex] = useState<number | null>(
    null,
  );
  const [editKeyIndex, setEditKeyIndex] = useState<number | null>(null);
  const phases = experiment.phases || [];
  const { apiCall } = useAuth();

  // Variation changes wait for the page's Save, like targeting; everything
  // that shows the variations reads them from here meanwhile.
  const [variationsDraft, setVariationsDraft] = useState<Variation[] | null>(
    null,
  );
  const stagedExperiment = useMemo(
    () => withStagedVariations(experiment, variationsDraft),
    [experiment, variationsDraft],
  );
  const [environmentScopes, setEnvironmentScopes] = useState<
    FlagEnvironmentsDraft["value"]
  >({});
  const flagEnvironments: FlagEnvironmentsDraft = useMemo(
    () => ({
      value: environmentScopes,
      set: (featureId, scope) =>
        setEnvironmentScopes((prev) => {
          const next = { ...prev };
          if (scope) next[featureId] = scope;
          else delete next[featureId];
          return next;
        }),
    }),
    [environmentScopes],
  );
  useRegisterExperimentEdit("variations", !!variationsDraft, {
    changes: () =>
      experimentFieldChanges(experiment, {
        variations: variationsDraft ?? experiment.variations,
        // The split the page shows, so both writes agree on the count.
        variationWeights:
          targetingDraft?.value?.variationWeights ??
          phases[phases.length - 1]?.variationWeights,
      }),
    onSaved: () => setVariationsDraft(null),
    discard: () => setVariationsDraft(null),
  });

  // Only a pending scheduled START should lock down editing (the experiment is
  // about to launch). A scheduled STOP (an end date on a running experiment)
  // must not block normal mid-flight traffic/targeting/variation edits.
  const pendingScheduledStart =
    experiment.nextScheduledStatusUpdate?.type === "start";

  const permissionsUtil = usePermissionsUtil();

  // Staged like the page's other edits; the modal says why when it's locked.
  // "current" opens on the stored type; a type opens preselected on it.
  const [changingType, setChangingType] = useState<
    ImplementationType | "current" | null
  >(null);
  const { live: viewingLive, setLive } = useLiveView();
  const { canEdit: canEditType } = useExperimentEditing(
    storedExperiment,
    disableEditing,
  );
  const canChangeType =
    !!implementationTypeDraft &&
    canEditType &&
    storedExperiment.type !== "holdout";
  const { hasCommercialFeature } = useUser();
  // Mirrors the server: a holdout changes only on a draft with nothing linked,
  // judged on what's stored rather than on a type change still staged.
  const holdoutEditable =
    storedExperiment.type !== "holdout" &&
    storedExperiment.status === "draft" &&
    !storedExperiment.nextScheduledStatusUpdate &&
    !experimentHasLinkedChanges(storedExperiment);
  // Leaving needs nothing more; joining or switching needs the feature.
  const canStageHoldout =
    !!holdoutDraft && !viewingLive && canEditType && holdoutEditable;
  const canJoinHoldout = canStageHoldout && hasCommercialFeature("holdouts");
  // A staged holdout the experiment has since outgrown (started, or gained a
  // linked change) couldn't save, so it goes rather than blocking the rest.
  const stagedHoldout = holdoutDraft?.value ?? null;
  const setStagedHoldout = holdoutDraft?.set;
  useEffect(() => {
    if (!holdoutEditable && stagedHoldout !== null) setStagedHoldout?.(null);
  }, [holdoutEditable, stagedHoldout, setStagedHoldout]);
  // Opened from the implementation headers' menus, which the Live view keeps;
  // the change shows in the view it's staged in.
  const chooseType = canChangeType
    ? (initialType?: ImplementationType) => {
        setLive(false);
        setChangingType(initialType ?? "current");
      }
    : null;
  const typeLockedReason = implementationTypeLockedReason(
    storedExperiment,
    storedLinkedFeatures,
  );

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

  // Keyed on the flag existing, not the org default: an experiment without one
  // chose manual, and suppressing the chooser would strand it.
  const { isManaged } = useManagedExperimentFlags({
    experiment,
    linkedFeatures,
  });
  const implementationType = getImplementationType(experiment);

  // Values experiments get their flag on create. One that lacks it still shows
  // its values, and saving them creates the flag.
  const pendingManagedFlag =
    !isManaged &&
    implementationType === "values" &&
    linkedFeatures.length === 0 &&
    !experiment.hasVisualChangesets &&
    !experiment.hasURLRedirects &&
    canEditExperiment &&
    experiment.status === "draft" &&
    !experiment.archived &&
    !experiment.nextScheduledStatusUpdate &&
    permissionsUtil.canViewFeatureModal(experiment.project);

  // The funnel's environments and draft toggle describe exactly one implementation.
  const soleLinkedFeature =
    linkedFeatures.length === 1 &&
    !experiment.hasVisualChangesets &&
    !experiment.hasURLRedirects
      ? linkedFeatures[0]
      : null;

  // The value rows above already show every flag, managed or linked, so the
  // box below is only for redirects, visual changes and choosing a type.
  // A Feature Flag experiment with none yet offers adding one there too.
  const flagsShownAbove =
    isManaged ||
    implementationType === "values" ||
    ((linkedFeatures.length > 0 || implementationType === "feature") &&
      !experiment.hasVisualChangesets &&
      !experiment.hasURLRedirects);

  const holdoutHasLinkedExpOrFeatures =
    holdoutExperiments?.length || holdoutFeatures?.length;

  const [tab, setTab] = useState<"experiments" | "features">(
    holdoutExperiments?.length ? "experiments" : "features",
  );

  const isHoldout = experiment.type === "holdout";
  const isBandit = experiment.type === "multi-armed-bandit";

  const safeToEdit = canEditDeliveryInPlace(experiment);

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
    <ImplementationTypeChooserContext.Provider value={chooseType}>
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
          experiment={stagedExperiment}
          variationIndex={editMetadataIndex}
          close={() => setEditMetadataIndex(null)}
          stage={setVariationsDraft}
          source="implementation-tab"
        />
      )}
      {editKeyIndex !== null && canEditExperiment && (
        <EditVariationKeyModal
          experiment={stagedExperiment}
          variationIndex={editKeyIndex}
          analysisOnly={implementationType === "none"}
          close={() => setEditKeyIndex(null)}
          stage={setVariationsDraft}
        />
      )}
      {/* Divides it from the hypothesis, which bandits don't have. */}
      {!isBandit ? <Separator size="4" my="2" /> : null}
      <div className="my-4">
        <Flex justify="between" align="center" gap="3" mb="2">
          <Heading as="h4" size="sm" color="text-high" mb="0">
            Implementation
          </Heading>
          <div ref={setHeaderActions} />
        </Flex>
        {changingType && implementationTypeDraft ? (
          <ChangeImplementationTypeModal
            initialType={changingType === "current" ? undefined : changingType}
            experiment={storedExperiment}
            managedFeature={
              storedLinkedFeatures.find((f) => f.feature.id === managedId) ??
              null
            }
            lockedReason={typeLockedReason}
            draft={implementationTypeDraft}
            close={() => setChangingType(null)}
          />
        ) : null}
        {showTrafficFunnel ? (
          <TrafficAllocationFunnel
            headerActionsTarget={headerActions}
            holdoutDraft={holdoutDraft}
            canStageHoldout={canStageHoldout}
            canJoinHoldout={canJoinHoldout}
            experiment={stagedExperiment}
            stageVariations={setVariationsDraft}
            flagEnvironments={flagEnvironments}
            editTargeting={pendingScheduledStart ? null : editTargeting}
            targetingDraft={targetingDraft}
            editNamespace={pendingScheduledStart ? null : editNamespace}
            canAddVariation={!pendingScheduledStart && !!canAddVariation}
            pendingManagedFlag={pendingManagedFlag && !pendingScheduledStart}
            setEditVariationIndex={setEditMetadataIndex}
            setEditKeyIndex={setEditKeyIndex}
            canEditExperiment={canEditExperiment}
            safeToEdit={safeToEdit}
            mutate={mutate}
            phaseIndex={phases.length - 1}
            servedValueFeature={soleLinkedFeature}
            linkedFeatures={linkedFeatures}
            // Values land in drafts in every status; publishing them is what
            // goes through review.
            canEditFlagValues={canEditExperiment}
            addFeatureFlag={
              // The stored type: adding a flag writes at once, so it can't
              // follow a type that is only staged.
              canAddLinkedChanges &&
              !isManaged &&
              !stagedType &&
              getImplementationType(storedExperiment) === "feature"
                ? () => setFeatureModal(true)
                : null
            }
          />
        ) : (
          <TrafficAndTargeting
            experiment={experiment}
            editTraffic={pendingScheduledStart ? null : editTraffic}
            editTargeting={pendingScheduledStart ? null : editTargeting}
            phaseIndex={getActivePhaseIndex(experiment)}
          />
        )}
        {!isHoldout &&
        !flagsShownAbove &&
        (hasLinkedChanges ||
          canAddLinkedChanges ||
          // Its type chooser needs less than adding changes does.
          (!!chooseType &&
            experiment.status === "draft" &&
            !experiment.nextScheduledStatusUpdate)) ? (
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
            onChooseType={
              chooseType && !typeLockedReason ? () => chooseType() : undefined
            }
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
            <Heading color="text-high" as="h4" size="sm" mb="0">
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
                  <TabsList size="md">
                    <TabsTrigger value="experiments">
                      Experiments
                      {!!holdoutExperiments?.length && (
                        <Badge
                          label={holdoutExperiments.length.toString()}
                          color="gray"
                          variant="soft"
                          radius="full"
                          ml="2"
                        />
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="features">
                      Features
                      {!!holdoutFeatures?.length && (
                        <Badge
                          label={holdoutFeatures.length.toString()}
                          color="gray"
                          variant="soft"
                          radius="full"
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
        {/* Bandits and holdouts keep the old card: their analysis is a decision
            metric and a schedule, not this plan. */}
        {!isHoldout && !isBandit ? (
          <AnalysisPlan
            experiment={experiment}
            mutate={mutate}
            canEdit={canEditExperiment}
            envs={envs}
            settingsOpen={analysisSettingsOpen}
            setSettingsOpen={setAnalysisSettingsOpen}
          />
        ) : (
          <AnalysisSettings
            experiment={experiment}
            mutate={mutate}
            envs={envs}
            canEdit={!!editTargeting && !pendingScheduledStart}
          />
        )}
        <DecisionPlan
          experiment={experiment}
          mutate={mutate}
          canEdit={!!editTargeting && !pendingScheduledStart}
          envs={envs}
        />
      </div>
    </ImplementationTypeChooserContext.Provider>
  );
}

function withStagedVariations(
  experiment: ExperimentInterfaceStringDates,
  variations: Variation[] | null,
): ExperimentInterfaceStringDates {
  if (!variations) return experiment;
  const phases = [...experiment.phases];
  if (phases.length) {
    phases[phases.length - 1] = {
      ...phases[phases.length - 1],
      variations: variations.map((v) => ({ id: v.id, status: "active" })),
    };
  }
  return { ...experiment, variations, phases };
}
