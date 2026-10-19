import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
  Variation,
} from "shared/types/experiment";
import {
  VisualChange,
  VisualChangesetInterface,
} from "shared/types/visual-changeset";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import {
  canEditDeliveryInPlace,
  experimentHasLinkedChanges,
  getLinkedChangeEnvs,
} from "shared/util";
import {
  getActivePhaseIndex,
  getLatestPhaseVariations,
} from "shared/experiments";
import { Flex, Separator } from "@radix-ui/themes";
import UrlRedirectRows from "@/components/Experiment/LinkedChanges/RedirectLinkedChanges";
import {
  ADDABLE_KINDS,
  AddImplementationMenu,
} from "@/components/Experiment/LinkedChanges/AddLinkedChanges";
import VisualEditorRows from "@/components/Experiment/VisualChangesetTable";
import UrlRedirectModal from "@/components/Experiment/UrlRedirectModal";
import { ImplementationSection } from "@/components/Experiment/TabbedPage/ImplementationCard";
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
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import HoldoutEnvironments from "./HoldoutEnvironments";
import {
  experimentFieldChanges,
  FlagEnvironmentsDraft,
  HoldoutDraft,
  useCheckExperimentChanges,
  useRegisterExperimentEdit,
  useStagedState,
} from "./ExperimentEdits";
import {
  addRedirect,
  editRedirect,
  EMPTY_LINKED_CHANGES,
  hasSetAsideVisualChanges,
  LinkedChangesDraft,
  linkedChangesBody,
  newRedirectKey,
  pruneLinkedChanges,
  RedirectFields,
  removeRedirect,
  removeVisual,
  ShownRedirect,
  shownUrlRedirects,
  shownVisualChangesets,
  stageVisualChange,
  stageVisualTargeting,
  undoRedirect,
  undoVisual,
  VisualTargeting,
} from "./linkedChangesDraft";

const LINKED_CHANGES_EDIT_ID = "linked-changes";

/** Where the pre-launch checklist sends you to add linked changes. */
export const IMPLEMENTATION_ID = "experiment-implementation";

const LINKED_CHANGES_LOCKED_REASON =
  "URL Redirects and AI Visual Editor changes serve in every environment, so changing them needs permission to run this experiment in all of them.";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
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
  analysisSettingsOpen: boolean;
  setAnalysisSettingsOpen: (open: boolean) => void;
  editTraffic?: (() => void) | null;
  canAddVariation?: boolean;
  editNamespace?: (() => void) | null;
  setFeatureModal: (open: boolean) => void;
  setVisualEditorModal: (open: boolean) => void;
  linkedFeatures: LinkedFeatureInfo[];
  envs: string[];
  visualChangesetEnvStates?: LinkedChangeEnvStates;
  urlRedirectEnvStates?: LinkedChangeEnvStates;
}

export default function Implementation({
  experiment,
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
  const [editKeyIndex, setEditKeyIndex] = useState<number | null>(null);
  const phases = experiment.phases || [];
  const { apiCall } = useAuth();

  // Variation changes wait for the page's Save, like targeting; everything
  // that shows the variations reads them from here meanwhile.
  const [variationsDraft, setVariationsDraft] = useStagedState<
    Variation[] | null
  >("variations", null);
  const stagedExperiment = useMemo(
    () => withStagedVariations(experiment, variationsDraft),
    [experiment, variationsDraft],
  );
  // Laid out like the variation cards above, staged edits included.
  const shownVariations = getLatestPhaseVariations(stagedExperiment);
  const shownVariationIds = shownVariations.map((v) => v.id);
  const [environmentScopes, setEnvironmentScopes] = useStagedState<
    FlagEnvironmentsDraft["value"]
  >("flag-environments", {});
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
    [environmentScopes, setEnvironmentScopes],
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

  // URL Redirect and Visual Editor edits, staged like the rest.
  const [linkedDraft, setLinkedDraft] = useStagedState<LinkedChangesDraft>(
    LINKED_CHANGES_EDIT_ID,
    EMPTY_LINKED_CHANGES,
  );
  const stagedLinked = pruneLinkedChanges(
    linkedDraft,
    urlRedirects,
    visualChangesets,
    shownVariationIds,
  );
  const linkedBody = linkedChangesBody(stagedLinked, shownVariationIds);
  const clearLinked = () => setLinkedDraft(EMPTY_LINKED_CHANGES);
  // One set aside by a staged variation removal stays registered, so Discard
  // and Save still clear it.
  useRegisterExperimentEdit(
    LINKED_CHANGES_EDIT_ID,
    Object.keys(linkedBody).length > 0 ||
      (!!variationsDraft &&
        hasSetAsideVisualChanges(
          linkedDraft,
          visualChangesets,
          shownVariationIds,
        )),
    { changes: () => linkedBody, onSaved: clearLinked, discard: clearLinked },
  );
  const onStageVisualTargeting = useCallback(
    (stored: VisualChangesetInterface, targeting: VisualTargeting) =>
      setLinkedDraft((d) => stageVisualTargeting(d, stored, targeting)),
    [setLinkedDraft],
  );
  const onStageVisualChange = useCallback(
    (stored: VisualChangesetInterface, change: VisualChange) =>
      setLinkedDraft((d) => stageVisualChange(d, stored, change)),
    [setLinkedDraft],
  );
  const checkChanges = useCheckExperimentChanges();
  const [redirectModal, setRedirectModal] = useState<{
    // Null to add one.
    target: ShownRedirect | null;
  } | null>(null);
  // Every check the save runs, so a refusal shows in the modal, not at Save.
  const stageRedirect = async (
    target: ShownRedirect | null,
    fields: RedirectFields,
  ) => {
    const key = newRedirectKey(linkedDraft);
    const change = (d: LinkedChangesDraft) =>
      target ? editRedirect(d, target, fields) : addRedirect(d, key, fields);
    await checkChanges?.(
      LINKED_CHANGES_EDIT_ID,
      linkedChangesBody(change(stagedLinked), shownVariationIds),
    );
    setLinkedDraft(change);
  };
  const { canEdit } = useExperimentEditing(experiment, disableEditing);
  const { hasCommercialFeature } = useUser();
  // Mirrors the server: a holdout changes only on a draft with nothing linked.
  const holdoutEditable =
    experiment.type !== "holdout" &&
    experiment.status === "draft" &&
    !experiment.nextScheduledStatusUpdate &&
    !experimentHasLinkedChanges(experiment);
  const holdoutInReach = !!holdoutDraft && canEdit;
  // Leaving needs nothing more; joining or switching needs the feature.
  const canStageHoldout = holdoutInReach && holdoutEditable;
  const canJoinHoldout = canStageHoldout && hasCommercialFeature("holdouts");
  // Said rather than hidden.
  const holdoutLockedReason =
    holdoutInReach &&
    experiment.type !== "holdout" &&
    experiment.status === "draft" &&
    experimentHasLinkedChanges(experiment)
      ? "A holdout can only change while nothing is linked to this experiment."
      : null;
  // A staged holdout the experiment has since outgrown (started, or gained a
  // linked change) couldn't save, so it goes rather than blocking the rest.
  const stagedHoldout = holdoutDraft?.value ?? null;
  const setStagedHoldout = holdoutDraft?.set;
  useEffect(() => {
    if (!holdoutEditable && stagedHoldout !== null) setStagedHoldout?.(null);
  }, [holdoutEditable, stagedHoldout, setStagedHoldout]);
  const canEditExperiment =
    !experiment.archived &&
    permissionsUtil.canViewExperimentModal(experiment.project);

  const hasVisualEditorPermission =
    canEditExperiment && permissionsUtil.canRunExperiment(experiment, []);
  // Shown, but locked, to someone who can run it in only some environments.
  const linkedChangesLockedReason =
    hasVisualEditorPermission &&
    !permissionsUtil.canRunExperiment(experiment, getLinkedChangeEnvs())
      ? LINKED_CHANGES_LOCKED_REASON
      : null;
  const stagesLinkedChanges = !disableEditing;

  const canAddLinkedChanges =
    hasVisualEditorPermission &&
    experiment.status === "draft" &&
    !experiment.nextScheduledStatusUpdate;

  const hasLinkedChanges =
    experiment.hasVisualChangesets ||
    linkedFeatures.length > 0 ||
    experiment.hasURLRedirects;

  // The funnel's environments describe exactly one implementation.
  const soleLinkedFeature =
    linkedFeatures.length === 1 &&
    !experiment.hasVisualChangesets &&
    !experiment.hasURLRedirects
      ? linkedFeatures[0]
      : null;

  const canAddAny = canAddLinkedChanges && !disableEditing;
  // Linking a Feature Flag writes at once, which would strand it: a holdout
  // changes only with nothing linked.
  const addBlockedReason =
    stagedHoldout !== null
      ? "Save or discard the holdout change first. A holdout can only change while nothing is linked."
      : null;
  const shownRedirects = shownUrlRedirects(stagedLinked, urlRedirects);
  const shownChangesets = shownVisualChangesets(stagedLinked, visualChangesets);
  const hasFlags = linkedFeatures.length > 0;
  const hasVisual = shownChangesets.length > 0;
  const hasRedirects = shownRedirects.length > 0;
  // With just one kind on the experiment, adding more of it comes first.
  const shownKinds = ADDABLE_KINDS.filter(
    (kind) =>
      ({ feature: hasFlags, visual: hasVisual, urlredirect: hasRedirects })[
        kind
      ],
  );
  const otherImplementations = (
    <>
      {hasRedirects ? (
        <UrlRedirectRows
          experiment={experiment}
          variations={shownVariations}
          urlRedirects={shownRedirects}
          canEdit={canAddLinkedChanges && stagesLinkedChanges}
          lockedReason={linkedChangesLockedReason}
          environmentStates={urlRedirectEnvStates}
          onEdit={(target) => setRedirectModal({ target })}
          onRemove={(target) =>
            setLinkedDraft((d) => removeRedirect(d, target))
          }
          onUndo={(target) =>
            setLinkedDraft((d) => undoRedirect(d, target.key))
          }
        />
      ) : null}
      {hasVisual ? (
        <VisualEditorRows
          experiment={experiment}
          variations={shownVariations}
          visualChangesets={shownChangesets}
          canEdit={hasVisualEditorPermission && stagesLinkedChanges}
          lockedReason={linkedChangesLockedReason}
          canLaunch={
            experiment.status === "draft" &&
            !experiment.nextScheduledStatusUpdate
          }
          environmentStates={visualChangesetEnvStates}
          onStageTargeting={onStageVisualTargeting}
          onStageChange={onStageVisualChange}
          onRemove={(id) => setLinkedDraft((d) => removeVisual(d, id))}
          onUndo={(id) => setLinkedDraft((d) => undoVisual(d, id))}
        />
      ) : null}
      {canAddAny ? (
        <ImplementationSection
          cols={Math.min(shownVariations.length, 3)}
          add={
            <AddImplementationMenu
              experiment={experiment}
              onAdd={{
                feature: () => setFeatureModal(true),
                visual: () => setVisualEditorModal(true),
                urlredirect: () => setRedirectModal({ target: null }),
              }}
              primary={shownKinds.length === 1 ? shownKinds[0] : null}
              blockedReasons={{
                feature: addBlockedReason,
                visual: linkedChangesLockedReason,
                urlredirect: linkedChangesLockedReason,
              }}
            />
          }
        />
      ) : null}
    </>
  );

  const holdoutHasLinkedExpOrFeatures =
    holdoutExperiments?.length || holdoutFeatures?.length;

  const [tab, setTab] = useState<"experiments" | "features">(
    holdoutExperiments?.length ? "experiments" : "features",
  );

  const isHoldout = experiment.type === "holdout";
  const isBandit = experiment.type === "multi-armed-bandit";

  const safeToEdit = canEditDeliveryInPlace(experiment);
  const canEditSettings = !!editTargeting && !pendingScheduledStart;

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
          experiment={stagedExperiment}
          variationIndex={editMetadataIndex}
          close={() => setEditMetadataIndex(null)}
          stage={setVariationsDraft}
          mutate={mutate}
          source="implementation-tab"
        />
      )}
      {redirectModal ? (
        <UrlRedirectModal
          mode={redirectModal.target ? "edit" : "add"}
          experiment={experiment}
          variations={shownVariations}
          urlRedirect={redirectModal.target ?? undefined}
          stage={(fields) => stageRedirect(redirectModal.target, fields)}
          close={() => setRedirectModal(null)}
          source={
            redirectModal.target ? "redirect-linked-changes" : "tabbed-page"
          }
        />
      ) : null}
      {editKeyIndex !== null && canEditExperiment && (
        <EditVariationKeyModal
          experiment={stagedExperiment}
          variationIndex={editKeyIndex}
          close={() => setEditKeyIndex(null)}
          stage={setVariationsDraft}
        />
      )}
      {/* Divides it from the hypothesis, which bandits don't have. */}
      {!isBandit ? <Separator size="4" my="2" /> : null}
      <div
        id={IMPLEMENTATION_ID}
        className="my-4"
        style={{ scrollMarginTop: "100px" }}
      >
        <Heading as="h4" size="sm" color="text-high" mb="2">
          Implementation
        </Heading>
        {showTrafficFunnel ? (
          <TrafficAllocationFunnel
            holdoutDraft={holdoutDraft}
            canStageHoldout={canStageHoldout}
            canJoinHoldout={canJoinHoldout}
            holdoutLockedReason={holdoutLockedReason}
            experiment={stagedExperiment}
            stageVariations={setVariationsDraft}
            flagEnvironments={flagEnvironments}
            editTargeting={pendingScheduledStart ? null : editTargeting}
            targetingDraft={targetingDraft}
            editNamespace={pendingScheduledStart ? null : editNamespace}
            canAddVariation={!pendingScheduledStart && !!canAddVariation}
            setEditVariationIndex={setEditMetadataIndex}
            setEditKeyIndex={setEditKeyIndex}
            canEditExperiment={canEditExperiment}
            safeToEdit={safeToEdit}
            phaseIndex={phases.length - 1}
            servedValueFeature={soleLinkedFeature}
            linkedFeatures={linkedFeatures}
            // Values land in drafts in every status; publishing them is what
            // goes through review.
            canEditFlagValues={canEditExperiment}
            otherImplementations={otherImplementations}
          />
        ) : (
          <TrafficAndTargeting
            experiment={experiment}
            editTraffic={pendingScheduledStart ? null : editTraffic}
            editTargeting={pendingScheduledStart ? null : editTargeting}
            phaseIndex={getActivePhaseIndex(experiment)}
          />
        )}
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
            feature flag, AI Visual Editor changes, or URL redirect).{" "}
            {experiment.status === "stopped"
              ? "Either the implementation was deleted or the implementation, traffic, and targeting were managed by an external system."
              : "The implementation, traffic, and targeting may be managed by an external system."}
          </Callout>
        ) : null}
        {/* Bandits and holdouts analyse by a decision metric and a schedule,
            not this plan. */}
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
            canEdit={canEditSettings}
            holdoutProjects={holdout?.projects}
            settingsOpen={analysisSettingsOpen}
            setSettingsOpen={setAnalysisSettingsOpen}
          />
        )}
        <DecisionPlan
          experiment={experiment}
          mutate={mutate}
          canEdit={canEditSettings}
          envs={envs}
        />
      </div>
    </>
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
