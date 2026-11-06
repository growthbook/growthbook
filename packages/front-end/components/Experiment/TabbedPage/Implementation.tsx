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
import {
  HoldoutInterfaceStringDates,
  HoldoutMissingLinkage,
} from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import {
  canEditDeliveryInPlace,
  experimentHasLinkedChanges,
  getLinkedChangeEnvs,
  hasPendingScheduledStart,
} from "shared/util";
import {
  getActivePhaseIndex,
  getLatestPhaseVariations,
  getStorableVariations,
} from "shared/experiments";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiWarningFill } from "react-icons/pi";
import UrlRedirectColumn from "@/components/Experiment/LinkedChanges/RedirectLinkedChanges";
import {
  ADDABLE_KINDS,
  AddImplementationMenu,
} from "@/components/Experiment/LinkedChanges/AddLinkedChanges";
import VisualChangesetColumn from "@/components/Experiment/VisualChangesetColumn";
import VariationsTable from "@/components/Experiment/VariationsTable";
import UrlRedirectModal from "@/components/Experiment/UrlRedirectModal";
import {
  ColumnLayout,
  ImplementationColumn,
} from "@/components/Experiment/TabbedPage/ImplementationColumn";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import EditVariationMetadataModal from "@/components/Experiment/EditVariationMetadataModal";
import EditVariationKeysModal from "@/components/Experiment/EditVariationKeysModal";
import ConfirmDialog from "@/ui/ConfirmDialog";
import HoldoutTrafficAndTargeting from "@/components/Holdout/HoldoutTrafficAndTargeting";
import TrafficAllocationFunnel, {
  changesVariationList,
  TargetingDraft,
} from "@/components/Experiment/TabbedPage/TrafficAllocationFunnel";
import AnalysisSettings from "@/components/Experiment/TabbedPage/AnalysisSettings";
import AnalysisPlan from "@/components/Experiment/TabbedPage/AnalysisPlan";
import Callout from "@/ui/Callout";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import LinkedExperimentsTable from "@/components/Holdout/LinkedExperimentsTable";
import LinkedFeaturesTable from "@/components/Holdout/LinkedFeaturesTable";
import MissingLinkageTable from "@/components/Holdout/MissingLinkageTable";
import EditEnvironmentsModal from "@/components/Holdout/EditEnvironmentsModal";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Frame from "@/ui/Frame";
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import type { AnalysisFormFocus } from "@/components/Experiment/AnalysisForm";
import HoldoutEnvironments from "./HoldoutEnvironments";
import {
  FlagEnvironmentsDraft,
  HoldoutDraft,
  useExperimentEdits,
  useExperimentFieldEdit,
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
  rebaseLinkedChanges,
  RedirectFields,
  removeRedirect,
  removeVisual,
  ShownRedirect,
  shownUrlRedirects,
  redirectServedValues,
  visualServedValues,
  shownVisualChangesets,
  stageVisualChange,
  stageVisualTargeting,
  undoRedirect,
  undoVisual,
  VisualTargeting,
} from "./linkedChangesDraft";
import { useAddedFlags } from "./addedFlags";

const LINKED_CHANGES_EDIT_ID = "linked-changes";

/** Where the pre-launch checklist sends you to add linked changes. */
export const IMPLEMENTATION_ID = "experiment-implementation";

const LINKED_CHANGES_LOCKED_REASON =
  "URL Redirects and AI Visual Editor changes serve in every environment, so changing them needs permission to run this experiment in all of them.";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  datasourceMissing?: boolean;
  // Viewing an old phase: nothing staged here can change.
  disableEditing?: boolean;
  holdoutDraft?: HoldoutDraft;
  holdout?: HoldoutInterfaceStringDates;
  holdoutFeatures?: FeatureInterface[];
  holdoutExperiments?: ExperimentInterfaceStringDates[];
  holdoutMissingLinkage?: HoldoutMissingLinkage;
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  mutate: () => void;
  editTargeting?: (() => void) | null;
  targetingDraft?: TargetingDraft;
  analysisSettingsOpen: boolean;
  setAnalysisSettingsOpen: (open: boolean) => void;
  analysisSettingsFocus: AnalysisFormFocus | null;
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
  datasourceMissing = false,
  disableEditing,
  holdoutDraft,
  holdout,
  holdoutExperiments,
  holdoutFeatures,
  holdoutMissingLinkage,
  visualChangesets,
  urlRedirects,
  mutate,
  editTargeting,
  targetingDraft,
  analysisSettingsOpen,
  setAnalysisSettingsOpen,
  analysisSettingsFocus,
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
  const [editingKeys, setEditingKeys] = useState(false);
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
  useExperimentFieldEdit("variations", !!variationsDraft, experiment, {
    label: "Variations",
    statusBound: true,
    fields: () => ({
      variations: variationsDraft ?? experiment.variations,
      // The split the page shows, so both writes agree on the count.
      variationWeights:
        targetingDraft?.value?.variationWeights ??
        phases[phases.length - 1]?.variationWeights,
    }),
    discard: () => {
      setVariationsDraft(null);
      if (changesVariationList(targetingDraft?.value ?? null, experiment)) {
        targetingDraft?.set(null);
      }
    },
  });

  // Only a pending scheduled START should lock down editing (the experiment is
  // about to launch). A scheduled STOP (an end date on a running experiment)
  // must not block normal mid-flight traffic/targeting/variation edits.
  const pendingScheduledStart = hasPendingScheduledStart(experiment);

  const permissionsUtil = usePermissionsUtil();

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
    {
      label: "URL redirects and visual changes",
      statusBound: true,
      changes: () => linkedBody,
      discard: clearLinked,
      rebase: () =>
        setLinkedDraft((d) =>
          rebaseLinkedChanges(d, urlRedirects, visualChangesets),
        ),
    },
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
  const edits = useExperimentEdits();
  const checkChanges = edits?.checkChanges;
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
  const { canEdit: canEditExperiment } = useExperimentEditing(experiment);
  const canEdit = canEditExperiment && !disableEditing;
  const { hasCommercialFeature } = useUser();
  const unscheduledDraft =
    experiment.status === "draft" && !experiment.nextScheduledStatusUpdate;
  // Mirrors the server: a holdout changes only on a draft with nothing linked.
  const holdoutEditable =
    experiment.type !== "holdout" &&
    unscheduledDraft &&
    !experimentHasLinkedChanges(experiment);
  const holdoutInReach = !!holdoutDraft && canEdit;
  // Leaving needs nothing more; joining or switching needs the feature.
  const canStageHoldout = holdoutInReach && holdoutEditable;
  const canJoinHoldout = canStageHoldout && hasCommercialFeature("holdouts");
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

  const hasVisualEditorPermission =
    canEditExperiment && permissionsUtil.canRunExperiment(experiment, []);
  // Shown, but locked, to someone who can run it in only some environments.
  const linkedChangesLockedReason =
    hasVisualEditorPermission &&
    !permissionsUtil.canRunExperiment(experiment, getLinkedChangeEnvs())
      ? LINKED_CHANGES_LOCKED_REASON
      : null;
  const stagesLinkedChanges = !disableEditing;
  const canAddAny =
    hasVisualEditorPermission && unscheduledDraft && stagesLinkedChanges;

  const hasLinkedChanges =
    experiment.hasVisualChangesets ||
    linkedFeatures.length > 0 ||
    experiment.hasURLRedirects;

  // Linking a Feature Flag writes at once, which would strand it: a holdout
  // changes only with nothing linked.
  const addBlockedReason =
    stagedHoldout !== null
      ? "Save or discard the holdout change first. A holdout can only change while nothing is linked."
      : null;
  const shownRedirects = shownUrlRedirects(stagedLinked, urlRedirects);
  const shownChangesets = shownVisualChangesets(stagedLinked, visualChangesets);
  const [addedFlags] = useAddedFlags();
  const hasFlags = linkedFeatures.length > 0 || addedFlags.length > 0;
  const hasVisual = shownChangesets.length > 0;
  const hasRedirects = shownRedirects.length > 0;
  const shownKinds = ADDABLE_KINDS.filter(
    (kind) =>
      ({ feature: hasFlags, visual: hasVisual, urlredirect: hasRedirects })[
        kind
      ],
  );
  const implementationColumns: ImplementationColumn[] = [
    ...shownRedirects.map((r) => ({
      key: `redirect:${r.key}`,
      served: redirectServedValues(r, shownVariationIds),
      render: (layout: ColumnLayout) => (
        <UrlRedirectColumn
          layout={layout}
          redirect={r}
          project={experiment.project ?? ""}
          canEdit={canAddAny}
          lockedReason={linkedChangesLockedReason}
          environmentStates={urlRedirectEnvStates}
          onEdit={() => setRedirectModal({ target: r })}
          onRemove={() => setLinkedDraft((d) => removeRedirect(d, r))}
          onUndo={() => setLinkedDraft((d) => undoRedirect(d, r.key))}
        />
      ),
    })),
    ...shownChangesets.map((shown) => ({
      key: `visual:${shown.stored.id}`,
      served: visualServedValues(shown.changeset, shownVariationIds),
      render: (layout: ColumnLayout) => (
        <VisualChangesetColumn
          layout={layout}
          shown={shown}
          experiment={experiment}
          canEdit={hasVisualEditorPermission && stagesLinkedChanges}
          lockedReason={linkedChangesLockedReason}
          canLaunch={unscheduledDraft}
          environmentStates={visualChangesetEnvStates}
          onStageTargeting={onStageVisualTargeting}
          onStageChange={onStageVisualChange}
          onRemove={(id) => setLinkedDraft((d) => removeVisual(d, id))}
          onUndo={(id) => setLinkedDraft((d) => undoVisual(d, id))}
        />
      ),
    })),
  ];
  // A visual change is written as it's added, against the saved variations;
  // a flag or redirect saves with the staged variations instead.
  const variationsUnsaved =
    shownVariationIds.join() !==
    getLatestPhaseVariations(experiment)
      .map((v) => v.id)
      .join();
  const [saveBeforeVisual, setSaveBeforeVisual] = useState(false);
  const addImplementation = canAddAny ? (
    <AddImplementationMenu
      experiment={experiment}
      onAdd={{
        feature: () => setFeatureModal(true),
        visual: () =>
          variationsUnsaved
            ? setSaveBeforeVisual(true)
            : setVisualEditorModal(true),
        urlredirect: () => setRedirectModal({ target: null }),
      }}
      // In priority order, the first kind it already has.
      primary={shownKinds[0] ?? null}
      blockedReasons={{
        feature: addBlockedReason,
        visual: linkedChangesLockedReason,
        urlredirect: linkedChangesLockedReason,
      }}
    />
  ) : null;

  const holdoutHasLinkedExpOrFeatures =
    holdoutExperiments?.length || holdoutFeatures?.length;

  const [tab, setTab] = useState<"experiments" | "features">(
    holdoutExperiments?.length ? "experiments" : "features",
  );

  const isHoldout = experiment.type === "holdout";
  const isBandit = experiment.type === "multi-armed-bandit";

  const safeToEdit = canEditDeliveryInPlace(experiment);
  const canEditSettings = !!editTargeting;

  const canEditHoldoutDefaultState =
    isHoldout &&
    !!holdout &&
    !experiment.archived &&
    experiment.status !== "stopped" &&
    permissionsUtil.canUpdateHoldout(holdout, { projects: holdout.projects });
  const missingCount =
    (holdoutMissingLinkage?.experiments.length ?? 0) +
    (holdoutMissingLinkage?.features.length ?? 0);

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
      {saveBeforeVisual ? (
        <ConfirmDialog
          title="Save changes first?"
          content="Visual changes are added to the saved experiment, so its variation changes need saving first. This saves all your staged changes."
          yesText="Save and continue"
          onConfirm={async () => {
            setSaveBeforeVisual(false);
            // A refused save shows why on the save bar.
            if ((await edits?.saveAll()) === null) setVisualEditorModal(true);
          }}
          onCancel={() => setSaveBeforeVisual(false)}
        />
      ) : null}
      {editingKeys && canEditExperiment && (
        <EditVariationKeysModal
          experiment={stagedExperiment}
          close={() => setEditingKeys(false)}
          stage={setVariationsDraft}
        />
      )}
      {/* Divides it from the description and hypothesis above. */}
      <Separator size="4" my="2" />
      <div
        id={IMPLEMENTATION_ID}
        className="my-4"
        style={{ scrollMarginTop: "100px" }}
      >
        <Heading as="h4" size="sm" color="text-high" mb="2">
          Implementation
        </Heading>
        {!isHoldout ? (
          <>
            <TrafficAllocationFunnel
              holdoutDraft={holdoutDraft}
              canStageHoldout={canStageHoldout}
              canJoinHoldout={canJoinHoldout}
              holdoutLockedReason={holdoutLockedReason}
              experiment={stagedExperiment}
              stageVariations={setVariationsDraft}
              flagEnvironments={flagEnvironments}
              editTargeting={
                pendingScheduledStart || !canEdit ? null : editTargeting
              }
              targetingDraft={targetingDraft}
              editNamespace={
                pendingScheduledStart || !canEdit ? null : editNamespace
              }
              canAddVariation={
                !pendingScheduledStart && canEdit && !!canAddVariation
              }
              editVariationKeys={() => setEditingKeys(true)}
              canEditExperiment={canEdit}
              safeToEdit={safeToEdit}
              linkedFeatures={linkedFeatures}
              // Values land in drafts in every status; publishing them is what
              // goes through review.
              canEditFlagValues={canEdit}
              implementationColumns={implementationColumns}
              addImplementation={addImplementation}
            />
            <Box mt="5" mb="4">
              <Heading as="h4" size="sm" color="text-high" mb="3">
                Variation Summary
              </Heading>
              <VariationsTable
                experiment={stagedExperiment}
                canEditExperiment={canEdit}
                onEditMetadata={setEditMetadataIndex}
                stageScreenshot={(variationId, screenshot) =>
                  setVariationsDraft((prev) =>
                    (prev ?? getStorableVariations(experiment)).map((v) =>
                      v.id === variationId
                        ? { ...v, screenshots: [...v.screenshots, screenshot] }
                        : v,
                    ),
                  )
                }
                mutate={mutate}
                showSplit={false}
                noMargin
                fill
              />
            </Box>
          </>
        ) : (
          <HoldoutTrafficAndTargeting
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
            <Flex align="center" gap="2">
              <Heading color="text-high" as="h4" size="sm" mb="0">
                Included Experiments & Features
              </Heading>
              {missingCount ? (
                <Badge
                  label={
                    <Flex align="center" gap="1">
                      <PiWarningFill />
                      {missingCount} missing
                    </Flex>
                  }
                  color="amber"
                  variant="soft"
                />
              ) : null}
            </Flex>
            {/* What joins from here on, ahead of what already has. */}
            <Box mt="2" mb="3">
              <Checkbox
                value={!holdout.skipAsDefaultHoldout}
                disabled={!canEditHoldoutDefaultState}
                setValue={(isDefault) => {
                  void setHoldoutDefaultState(isDefault);
                }}
                label="Preselect for new experiments and Feature Flags"
                description="When someone creates one, this holdout is picked for it unless they choose another."
                weight="regular"
              />
            </Box>
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
            {holdoutMissingLinkage ? (
              <MissingLinkageTable
                holdoutId={holdout.id}
                missing={holdoutMissingLinkage}
                canEdit={permissionsUtil.canUpdateHoldout(holdout, {
                  projects: holdout.projects,
                })}
                mutate={mutate}
              />
            ) : null}
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
            datasourceMissing={datasourceMissing}
            canEdit={canEditExperiment}
            settingsOpen={analysisSettingsOpen}
            setSettingsOpen={setAnalysisSettingsOpen}
            settingsFocus={analysisSettingsFocus}
            targetingDraft={targetingDraft}
            canEditTargeting={!!editTargeting}
            canEditSchedule={canEditSettings}
            mutate={mutate}
            envs={envs}
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
            settingsFocus={analysisSettingsFocus}
          />
        )}
      </div>
    </>
  );
}

export function withStagedVariations(
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
