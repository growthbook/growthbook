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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HoldoutInterfaceStringDates,
  type ImplementationType,
} from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import {
  canEditDeliveryInPlace,
  experimentHasLinkedChanges,
  getImplementationType,
  getLinkedChangeEnvs,
  isManagedByExperiment,
} from "shared/util";
import {
  getActivePhaseIndex,
  getLatestPhaseVariations,
} from "shared/experiments";
import { Flex, Separator } from "@radix-ui/themes";
import UrlRedirectRows from "@/components/Experiment/LinkedChanges/RedirectLinkedChanges";
import {
  AddImplementationMenu,
  ImplementationTypePrompt,
} from "@/components/Experiment/LinkedChanges/AddLinkedChanges";
import VisualEditorRows from "@/components/Experiment/VisualChangesetTable";
import UrlRedirectModal from "@/components/Experiment/UrlRedirectModal";
import { ImplementationSection } from "@/components/Experiment/TabbedPage/ImplementationCard";
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
  useCheckExperimentChanges,
  useEditsBlockedReason,
  useLiveView,
  useRegisterExperimentEdit,
} from "./ExperimentEdits";
import {
  addRedirect,
  editRedirect,
  EMPTY_LINKED_CHANGES,
  hasSetAsideVisualChanges,
  LinkedChangesDraft,
  linkedChangesBody,
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
  "URL Redirects and Visual Editor changes serve in every environment, so changing them needs permission to run this experiment in all of them.";

type ImplementationKind = "feature" | "visual" | "urlredirect";

// Every kind a legacy mix has linked, otherwise the one chosen.
function isSetUpFor(
  experiment: ExperimentInterfaceStringDates,
  linkedFlagCount: number,
  kind: ImplementationKind,
): boolean {
  const type = getImplementationType(experiment);
  if (type !== "multi") return type === kind;
  if (kind === "feature") return linkedFlagCount > 0;
  return kind === "visual"
    ? !!experiment.hasVisualChangesets
    : !!experiment.hasURLRedirects;
}

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
  // Laid out like the variation cards above, staged edits included.
  const shownVariations = getLatestPhaseVariations(stagedExperiment);
  const shownVariationIds = shownVariations.map((v) => v.id);
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

  // URL Redirect and Visual Editor edits, staged like the rest.
  const [linkedDraft, setLinkedDraft] =
    useState<LinkedChangesDraft>(EMPTY_LINKED_CHANGES);
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
  // The change shows in the view it's staged in.
  const updateLinked = useCallback(
    (update: (draft: LinkedChangesDraft) => LinkedChangesDraft) => {
      setLive(false);
      setLinkedDraft(update);
    },
    [setLive],
  );
  const onStageVisualTargeting = useCallback(
    (stored: VisualChangesetInterface, targeting: VisualTargeting) =>
      updateLinked((d) => stageVisualTargeting(d, stored, targeting)),
    [updateLinked],
  );
  const onStageVisualChange = useCallback(
    (stored: VisualChangesetInterface, change: VisualChange) =>
      updateLinked((d) => stageVisualChange(d, stored, change)),
    [updateLinked],
  );
  const checkChanges = useCheckExperimentChanges();
  const newRedirectKeys = useRef(0);
  const [redirectModal, setRedirectModal] = useState<{
    // Null to add one.
    target: ShownRedirect | null;
  } | null>(null);
  // Every check the save runs, so a refusal shows in the modal, not at Save.
  const stageRedirect = async (
    target: ShownRedirect | null,
    fields: RedirectFields,
  ) => {
    const key = `new-redirect-${++newRedirectKeys.current}`;
    const change = (d: LinkedChangesDraft) =>
      target ? editRedirect(d, target, fields) : addRedirect(d, key, fields);
    await checkChanges?.(
      LINKED_CHANGES_EDIT_ID,
      linkedChangesBody(change(stagedLinked), shownVariationIds),
    );
    updateLinked(change);
  };
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
  const holdoutInReach = !!holdoutDraft && !viewingLive && canEditType;
  // Leaving needs nothing more; joining or switching needs the feature.
  const canStageHoldout = holdoutInReach && holdoutEditable;
  const canJoinHoldout = canStageHoldout && hasCommercialFeature("holdouts");
  // Said rather than hidden: a Values experiment's own flag counts as linked.
  const holdoutLockedReason =
    holdoutInReach &&
    storedExperiment.type !== "holdout" &&
    storedExperiment.status === "draft" &&
    experimentHasLinkedChanges(storedExperiment)
      ? "A holdout can only change while nothing is linked to this experiment."
      : null;
  // A staged holdout the experiment has since outgrown (started, or gained a
  // linked change) couldn't save, so it goes rather than blocking the rest.
  const stagedHoldout = holdoutDraft?.value ?? null;
  const setStagedHoldout = holdoutDraft?.set;
  useEffect(() => {
    if (!holdoutEditable && stagedHoldout !== null) setStagedHoldout?.(null);
  }, [holdoutEditable, stagedHoldout, setStagedHoldout]);
  // Draft-era targeting and variations can't land on an experiment that has
  // since started; they would rewrite its running phase in place.
  const startedFrom = useRef(storedExperiment.status);
  const setTargetingDraft = targetingDraft?.set;
  useEffect(() => {
    const was = startedFrom.current;
    startedFrom.current = storedExperiment.status;
    if (was !== "draft" || storedExperiment.status === "draft") return;
    setVariationsDraft(null);
    setTargetingDraft?.(null);
    setLinkedDraft(EMPTY_LINKED_CHANGES);
  }, [storedExperiment.status, setTargetingDraft]);
  // Opened from the implementation headers' menus, which the Live view keeps;
  // the change shows in the view it's staged in.
  const chooseType = canChangeType
    ? (initialType?: ImplementationType) => {
        setLive(false);
        setChangingType(initialType ?? "current");
      }
    : null;
  const typeLockedReason = implementationTypeLockedReason(
    // A staged redirect counts: the save can't add one and change the type.
    stagedLinked.addedRedirects.length
      ? { ...storedExperiment, hasURLRedirects: true }
      : storedExperiment,
    storedLinkedFeatures,
  );
  // Only where unarchiving would let it change; without permission the menu
  // would hold nothing but a no.
  const typeUnavailableReason =
    !chooseType &&
    !!implementationTypeDraft &&
    !disableEditing &&
    storedExperiment.type !== "holdout" &&
    storedExperiment.archived
      ? "Unarchive this experiment to change its implementation type."
      : null;

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
  const stagesLinkedChanges = !viewingLive && !disableEditing;
  const editsBlocked = useEditsBlockedReason();

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

  // The funnel's environments describe exactly one implementation.
  const soleLinkedFeature =
    linkedFeatures.length === 1 &&
    !experiment.hasVisualChangesets &&
    !experiment.hasURLRedirects
      ? linkedFeatures[0]
      : null;

  // What shows follows the staged type, as the rows above do; adding follows
  // the stored one, and a staged type locks it: the save can't do both.
  const canAddAny =
    canAddLinkedChanges && !stagedType && !viewingLive && !disableEditing;
  // A legacy mix adds from one menu rather than under each section.
  const legacyMix = getImplementationType(storedExperiment) === "multi";
  const canAdd = (kind: ImplementationKind) =>
    canAddAny &&
    !legacyMix &&
    isSetUpFor(storedExperiment, storedLinkedFeatures.length, kind);
  // Linking a Feature Flag writes at once, which would strand it: a holdout
  // changes only with nothing linked.
  const addBlockedReason =
    stagedHoldout !== null
      ? "Save or discard the holdout change first. A holdout can only change while nothing is linked."
      : null;
  const settingUp =
    experiment.status === "draft" &&
    !experiment.nextScheduledStatusUpdate &&
    !experiment.archived;
  // An empty section is there to add to, or to change the type from.
  const shownEmpty = (kind: ImplementationKind) =>
    settingUp &&
    isSetUpFor(experiment, linkedFeatures.length, kind) &&
    (canAdd(kind) || !!chooseType);
  // The Live view shows what's stored, and edits nothing.
  const shownLinked = viewingLive ? EMPTY_LINKED_CHANGES : stagedLinked;
  const shownRedirects = shownUrlRedirects(shownLinked, urlRedirects);
  const shownChangesets = shownVisualChangesets(shownLinked, visualChangesets);
  // Creating changes and opening the Visual Editor write at once, and opening
  // it leaves the page.
  const visualAddBlockedReason = linkedChangesLockedReason ?? editsBlocked;
  const otherImplementations = (
    <>
      {shownRedirects.length > 0 || shownEmpty("urlredirect") ? (
        <UrlRedirectRows
          experiment={experiment}
          variations={shownVariations}
          urlRedirects={shownRedirects}
          canEdit={canAddLinkedChanges && stagesLinkedChanges}
          lockedReason={linkedChangesLockedReason}
          environmentStates={urlRedirectEnvStates}
          onAdd={
            canAdd("urlredirect")
              ? () => setRedirectModal({ target: null })
              : null
          }
          addBlockedReason={linkedChangesLockedReason}
          onEdit={(target) => setRedirectModal({ target })}
          onRemove={(target) => updateLinked((d) => removeRedirect(d, target))}
          onUndo={(target) => updateLinked((d) => undoRedirect(d, target.key))}
        />
      ) : null}
      {shownChangesets.length > 0 || shownEmpty("visual") ? (
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
          launchBlockedReason={editsBlocked}
          environmentStates={visualChangesetEnvStates}
          onAdd={canAdd("visual") ? () => setVisualEditorModal(true) : null}
          addBlockedReason={visualAddBlockedReason}
          onStageTargeting={onStageVisualTargeting}
          onStageChange={onStageVisualChange}
          onRemove={(id) => updateLinked((d) => removeVisual(d, id))}
          onUndo={(id) => updateLinked((d) => undoVisual(d, id))}
        />
      ) : null}
      {legacyMix && canAddAny ? (
        <ImplementationSection
          cols={Math.min(shownVariations.length, 3)}
          add={
            <AddImplementationMenu
              experiment={experiment}
              onFeatureFlag={isManaged ? null : () => setFeatureModal(true)}
              onVisualEditor={() => setVisualEditorModal(true)}
              onUrlRedirect={() => setRedirectModal({ target: null })}
              blockedReasons={{
                feature: addBlockedReason,
                visual: visualAddBlockedReason,
                urlredirect: linkedChangesLockedReason,
              }}
            />
          }
        />
      ) : null}
      {/* Until a kind is chosen, choosing one takes their place. */}
      {settingUp &&
      chooseType &&
      (!implementationType || implementationType === "none") ? (
        <ImplementationSection cols={Math.min(shownVariations.length, 3)}>
          <ImplementationTypePrompt
            analysisOnly={implementationType === "none"}
            onChooseType={() => chooseType()}
          />
        </ImplementationSection>
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
    <ImplementationTypeChooserContext.Provider
      value={{ choose: chooseType, unavailableReason: typeUnavailableReason }}
    >
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
          analysisOnly={implementationType === "none"}
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
              !isManaged && canAdd("feature")
                ? () => setFeatureModal(true)
                : null
            }
            addFeatureFlagBlockedReason={addBlockedReason}
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
            feature flag, visual editor changes, or URL redirect).{" "}
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
