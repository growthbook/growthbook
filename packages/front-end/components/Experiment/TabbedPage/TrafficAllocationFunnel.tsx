import { Dispatch, ReactNode, SetStateAction, useMemo, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
  LinkedFeatureInfo,
  Variation,
} from "shared/types/experiment";
import {
  getEqualWeights,
  getLatestPhaseVariations,
  hasAttributeCondition,
  hasTargetingConfigured,
} from "shared/experiments";
import { generateVariationId } from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCaretDownBold, PiPencilSimple } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import { getHoldoutTrafficBreakdown } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { getNamespaceDisplayData } from "@/components/Features/NamespaceSelectorUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import EditExperimentEnvironmentsModal from "@/components/Experiment/EditExperimentEnvironmentsModal";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Tooltip from "@/ui/Tooltip";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import ReorderVariationsModal from "@/components/Experiment/ReorderVariationsModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import LinkHashAttributeCallout from "@/components/Experiment/LinkHashAttributeCallout";
import Link from "@/ui/Link";
import {
  EnvironmentStateChips,
  environmentStateTense,
  getEnvironmentStates,
  stageEnvironmentInputs,
  statesFromInputs,
} from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import {
  environmentStatesDiffer,
  hasUnpublishedChanges,
} from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import {
  PercentField,
  PercentSlider,
} from "@/components/Forms/PercentSliderField";
import { useTargetingDefaults } from "@/components/Experiment/useExperimentTargetingForm";
import useHashAttributeOptions from "@/components/Experiment/useHashAttributeOptions";
import { attributeOptionLabelFormatter } from "@/components/Features/AttributeOptionTooltip";
import SelectField from "@/components/Forms/SelectField";
import AddToHoldoutModal from "@/components/Experiment/holdout/AddToHoldoutModal";
import { useHoldouts } from "@/hooks/useHoldouts";
import { selectableHoldouts } from "@/components/Holdout/HoldoutSelect";
import VariationValuesTable, {
  FlagView,
  FUNNEL_WIDTH,
} from "./VariationValuesTable";
import VariationDetails from "./VariationDetails";
import {
  DraftPick,
  FlagDraftPicks,
  resolveDraftPick,
  withoutDraft,
  withPickedDraft,
} from "./draftPicks";
import styles from "./TrafficAllocationFunnel.module.scss";
import SetupFieldRow from "./SetupFieldRow";
import useExperimentEditing from "./useExperimentEditing";
import {
  experimentFieldChanges,
  FlagEnvironmentsDraft,
  HoldoutDraft,
  useRegisterExperimentEdit,
  useStagedState,
} from "./ExperimentEdits";
import { onlyTrafficChanged } from "./targetingDraft";

export interface Props {
  phaseIndex?: number | null;
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
  editNamespace?: (() => void) | null;
  /** Offers the + that appends a variation and evens out the split. */
  canAddVariation?: boolean;
  /** Stages a new set of variations for the page's Save. */
  stageVariations?: (variations: Variation[]) => void;
  /** Environment scopes staged per flag. */
  flagEnvironments?: FlagEnvironmentsDraft;
  /** The page's staged holdout. */
  holdoutDraft?: HoldoutDraft;
  /** Whether the experiment can leave its holdout here. */
  canStageHoldout?: boolean;
  /** Whether it can join or switch holdouts here, which needs the feature. */
  canJoinHoldout?: boolean;
  /** Why the holdout is fixed, shown on its disabled pencil. */
  holdoutLockedReason?: string | null;
  setEditVariationIndex?: (index: number) => void;
  editVariationKeys?: () => void;
  /** The sole linked Feature Flag, whose environments and draft the header describes. */
  servedValueFeature?: LinkedFeatureInfo | null;
  /** Every linked Feature Flag, one value row each under the variations. */
  linkedFeatures?: LinkedFeatureInfo[];
  /** Whether the value rows can be edited in place. */
  canEditFlagValues?: boolean;
  /** The URL Redirect and Visual Editor sections, and adding more. */
  otherImplementations?: ReactNode;
  canEditExperiment?: boolean;
  safeToEdit: boolean;
  /**
   * The targeting the page has confirmed but not yet written, and the way to
   * change it. Held by the page, since the modal that stages it lives there.
   */
  targetingDraft?: TargetingDraft;
}

export interface TargetingDraft {
  value: ExperimentTargetingData | null;
  /**
   * Takes an updater as well as a value: rebalancing writes every weight in
   * one tick, and each write has to see the one before it.
   */
  set: Dispatch<SetStateAction<ExperimentTargetingData | null>>;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function FunnelCard({
  title,
  inlineSummary,
  onEdit,
  children,
  disabled = false,
  editBlockedReason,
  menu,
}: {
  title: string;
  inlineSummary?: ReactNode;
  onEdit?: (() => void) | null;
  children?: ReactNode;
  disabled?: boolean;
  /** Why the pencil cannot open right now, which it wears rather than vanishing. */
  editBlockedReason?: string | null;
  /** Items for the menu right of the pencil; no menu without them. */
  menu?: ReactNode;
}) {
  return (
    <Box
      className="appbox"
      maxWidth={`${FUNNEL_WIDTH}px`}
      width="100%"
      mb="0"
      py="3"
      style={{ paddingLeft: 16, paddingRight: 16 }}
    >
      <Flex justify="between" align="center" gap="3">
        <Flex align="baseline" gap="2" wrap="wrap">
          <Text size="lg" weight="medium" color="text-high">
            {title}
          </Text>
          {inlineSummary ? (
            <Text color="text-low" ml="1">
              {inlineSummary}
            </Text>
          ) : null}
        </Flex>
        <Flex align="center" gap="3">
          {onEdit && !disabled ? (
            <Tooltip content={editBlockedReason ?? `Edit ${title}`}>
              <IconButton
                variant="ghost"
                color="violet"
                radius="medium"
                disabled={!!editBlockedReason}
                onClick={() => onEdit()}
                size="1"
                aria-label={`Edit ${title}`}
              >
                <PiPencilSimple size="14" />
              </IconButton>
            </Tooltip>
          ) : null}
          {menu ? (
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="2"
                  highContrast
                  style={{ margin: 0 }}
                  aria-label={`${title} actions`}
                >
                  <BsThreeDotsVertical size={16} />
                </IconButton>
              }
              menuPlacement="end"
              variant="soft"
            >
              {menu}
            </DropdownMenu>
          ) : null}
        </Flex>
      </Flex>
      {children ? <Box mt="1">{children}</Box> : null}
    </Box>
  );
}

function FunnelConnector({ label }: { label?: ReactNode }) {
  return (
    <Flex direction="column" align="center" justify="center">
      <Box className={styles.connectorLine} height="15px" />
      <Box mt="-3" mb="-1" className={styles.caret}>
        <PiCaretDownBold size="11" />
      </Box>
      {label ? (
        <Text size="sm" color="text-low" my="1">
          {label}
        </Text>
      ) : null}
    </Flex>
  );
}

export default function TrafficAllocationFunnel({
  phaseIndex = null,
  experiment,
  editTargeting,
  editNamespace,
  canAddVariation = false,
  stageVariations,
  flagEnvironments,
  holdoutDraft,
  canStageHoldout = false,
  canJoinHoldout = false,
  holdoutLockedReason = null,
  setEditVariationIndex,
  editVariationKeys,
  servedValueFeature: storedServedValueFeature,
  linkedFeatures = [],
  canEditFlagValues = false,
  otherImplementations,
  canEditExperiment = false,
  safeToEdit = false,
  targetingDraft,
}: Props) {
  const { namespaces } = useOrgSettings();
  const { apiCall } = useAuth();
  const { editInline } = useExperimentEditing(experiment);

  const targetingDefaults = useTargetingDefaults(experiment);
  const staged = targetingDraft?.value ?? null;

  // Everything below reads the staged targeting where there is one, so a
  // confirmed change shows on the page before it is written.
  const stagePatch = (patch: Partial<ExperimentTargetingData>) =>
    targetingDraft?.set((prev) => ({
      ...(prev ?? targetingDefaults),
      ...patch,
    }));

  const clearStaged = {
    onSaved: () => targetingDraft?.set(null),
    discard: () => targetingDraft?.set(null),
  };
  useRegisterExperimentEdit(
    "targeting",
    !!staged,
    // With no phase yet there's nothing to patch; targeting creates the first.
    staged &&
      experiment.phases.length > 0 &&
      onlyTrafficChanged(staged, targetingDefaults)
      ? {
          ...clearStaged,
          changes: () =>
            experimentFieldChanges(experiment, {
              coverage: staged.coverage,
              variationWeights: staged.variationWeights,
            }),
        }
      : {
          ...clearStaged,
          save: async () => {
            await apiCall(`/experiment/${experiment.id}/targeting`, {
              method: "POST",
              body: JSON.stringify(staged),
            });
          },
        },
  );

  // The experiment-level half of the targeting, staged the same way.
  const hashAttribute =
    staged?.hashAttribute ?? experiment.hashAttribute ?? "id";
  const fallbackAttribute =
    staged?.fallbackAttribute ?? experiment.fallbackAttribute ?? "";

  const stageVariationList = (
    variations: Variation[],
    weights = getEqualWeights(variations.length, 4),
  ) => {
    stageVariations?.(variations);
    // Targeting writes the phase's variations too, so it must carry them.
    stagePatch({
      variations: variations.map(({ id }) => ({ id, status: "active" })),
      variationWeights: weights,
    });
  };
  const [reordering, setReordering] = useState(false);
  const storedVariations = () =>
    getLatestPhaseVariations(experiment).map(
      ({ id, key, name, description, screenshots }): Variation => ({
        id,
        key,
        name,
        description,
        screenshots,
      }),
    );
  const removeVariation = (index: number) =>
    stageVariationList(storedVariations().filter((_, i) => i !== index));
  const addVariation = () => {
    const current = storedVariations();
    const variations = [
      ...current,
      {
        id: generateVariationId(),
        key: String(current.length),
        name: `Variation ${current.length}`,
        description: "",
        screenshots: [],
      },
    ];
    stageVariationList(variations);
    track("Added Variations", {
      source: "setup-tab",
      numVariationsAdded: 1,
      totalVariations: variations.length,
    });
  };

  const storedPhase =
    experiment.phases?.[phaseIndex ?? experiment.phases.length - 1];
  const phase = staged
    ? {
        ...storedPhase,
        coverage: staged.coverage,
        condition: staged.condition,
        savedGroups: staged.savedGroups,
        prerequisites: staged.prerequisites,
        variationWeights: staged.variationWeights,
        namespace: staged.namespace,
      }
    : storedPhase;
  const hasNamespace = phase?.namespace && phase.namespace.enabled;

  const { coverage: namespaceCoverage, name: namespaceName } =
    getNamespaceDisplayData(phase?.namespace, namespaces);

  const isBandit = experiment.type === "multi-armed-bandit";
  const permissionsUtil = usePermissionsUtil();

  // Each flag's row picks the draft it shows; the readouts here follow it.
  const [draftPickValue, setDraftPicks] = useStagedState<
    Record<string, DraftPick>
  >("draft-picks", {});
  const draftPicks: FlagDraftPicks = useMemo(
    () => ({
      value: draftPickValue,
      set: (featureId, pick) =>
        setDraftPicks((prev) => ({ ...prev, [featureId]: pick })),
    }),
    [draftPickValue, setDraftPicks],
  );
  const pickedFeatures = useMemo(
    () =>
      linkedFeatures.map((info) =>
        withPickedDraft(info, draftPickValue[info.feature.id]),
      ),
    [linkedFeatures, draftPickValue],
  );
  // A draft to show only when something it shows actually moved: any linked
  // flag counts, since the value rows show every flag's draft.
  const draftsDiffer = useMemo(
    () => pickedFeatures.some(hasUnpublishedChanges),
    [pickedFeatures],
  );
  // Once the experiment runs, what its flags serve and what their drafts
  // propose can differ, so the table shows one or the other. In Draft, live
  // serves nothing yet.
  const canViewLive =
    experiment.status !== "draft" && linkedFeatures.length > 0;
  const [chosenFlagView, setFlagView] = useState<FlagView | null>(null);
  // A flag with no rule, or one a draft is taking out, is resolved in Draft.
  const flagNeedsAction = linkedFeatures.some(
    (info) => info.state === "discarded" || !!info.pendingRemoval,
  );
  const flagView: FlagView = !canViewLive
    ? "draft"
    : (chosenFlagView ?? (draftsDiffer || flagNeedsAction ? "draft" : "live"));
  const showingLive = flagView === "live";
  const servedValueFeature = useMemo(
    () =>
      !storedServedValueFeature
        ? null
        : showingLive
          ? withoutDraft(storedServedValueFeature)
          : withPickedDraft(
              storedServedValueFeature,
              draftPickValue[storedServedValueFeature.feature.id],
            ),
    [storedServedValueFeature, draftPickValue, showingLive],
  );

  const liveRule = servedValueFeature?.liveHasMatchingRule
    ? servedValueFeature
    : undefined;
  const environmentsDiffer = servedValueFeature
    ? environmentStatesDiffer(servedValueFeature)
    : false;

  const hasDraftChanges = !showingLive && draftsDiffer;
  // Re-scoping environments stages a draft without re-bucketing.
  const canEditEnvironments =
    !showingLive &&
    !!servedValueFeature &&
    !servedValueFeature.pendingRemoval &&
    canEditExperiment &&
    permissionsUtil.canEditFeatureDrafts(servedValueFeature.feature);
  const [editEnvironments, setEditEnvironments] = useState(false);
  const envStateSource = hasDraftChanges
    ? servedValueFeature?.pendingDraft
    : liveRule && { environmentStates: liveRule.liveEnvironmentStates };
  const environmentsAreDraft = hasDraftChanges && environmentsDiffer;

  const stagedScope = servedValueFeature
    ? (flagEnvironments?.value[servedValueFeature.feature.id] ?? null)
    : null;
  // What a staged scope lands on.
  const scopeBaseInputs =
    (hasDraftChanges
      ? servedValueFeature?.pendingDraft?.environmentInputs
      : servedValueFeature?.liveEnvironmentInputs) ??
    servedValueFeature?.environmentInputs ??
    {};
  const environmentStates = getEnvironmentStates(
    stagedScope && servedValueFeature
      ? {
          environmentStates: statesFromInputs(
            stageEnvironmentInputs(scopeBaseInputs, stagedScope),
          ),
        }
      : envStateSource || { environmentStates: {} },
    {
      future: environmentStateTense({
        status: experiment.status,
        unpublished: environmentsAreDraft || !!stagedScope,
        // The row's pick, which may not be the draft that launches.
        launches:
          !storedServedValueFeature ||
          resolveDraftPick(
            storedServedValueFeature,
            draftPickValue[storedServedValueFeature.feature.id],
          ).launches,
      }),
    },
  );

  const isHoldout = experiment.type === "holdout";
  const isRunning = experiment.status === "running";
  const variationsLocked = isRunning;
  const canStageVariations =
    canEditExperiment &&
    !variationsLocked &&
    !!stageVariations &&
    !!targetingDraft;
  // Bucketing follows the variation list, so its shape is fixed once it starts.
  const canRestructure = canStageVariations && experiment.status === "draft";
  const canAddNamespace =
    !isHoldout &&
    !!editNamespace &&
    safeToEdit &&
    !hasNamespace &&
    !!namespaces?.length;

  // Staged over what's stored: "" means leaving the stored holdout.
  const holdoutId = holdoutDraft?.value ?? experiment.holdoutId ?? "";
  const { holdouts, holdoutsMap, experimentsMap } = useHoldouts(
    undefined,
    false,
    { enabled: canStageHoldout || !!holdoutId },
  );
  const [choosingHoldout, setChoosingHoldout] = useState(false);
  // Only when the picker would have something to offer.
  const canAddHoldout =
    canJoinHoldout &&
    !isHoldout &&
    !holdoutId &&
    selectableHoldouts(holdouts, experimentsMap, experiment.project).length > 0;
  // Leaving a holdout only just staged is undoing it.
  const leaveHoldout = () =>
    holdoutDraft?.set(experiment.holdoutId ? "" : null);
  const stageHoldout = (id: string) =>
    holdoutDraft?.set(id === (experiment.holdoutId ?? "") ? null : id);

  // Environment scope has its own line above, so the audience is attributes alone.
  const targetsEveryone = !hasTargetingConfigured(phase);
  const hasCondition = hasAttributeCondition(phase?.condition);
  const hasSavedGroups = !!phase?.savedGroups?.length;
  const hasPrerequisites = !!phase?.prerequisites?.length && !isHoldout;

  if (!phase) {
    return (
      <Callout status="warning" mb="4">
        No traffic allocation or targeting configured yet. Add a phase to this
        experiment.
      </Callout>
    );
  }

  const holdoutTraffic = getHoldoutTrafficBreakdown(phase);
  const includedLabel = namespaceCoverage
    ? `${percentFormatter.format(namespaceCoverage)} traffic included`
    : undefined;
  const phaseVariations = getLatestPhaseVariations(experiment);
  const numVariations = phaseVariations.length;
  const variationWeights = phase.variationWeights ?? [];
  const coverage = phase.coverage ?? 1;

  return (
    <>
      <Frame
        px="4"
        style={{ backgroundColor: "var(--gray-a2)", border: "none" }}
      >
        {choosingHoldout ? (
          <AddToHoldoutModal
            experiment={experiment}
            holdoutId={holdoutId}
            stage={stageHoldout}
            close={() => setChoosingHoldout(false)}
          />
        ) : null}
        {editEnvironments && servedValueFeature && flagEnvironments && (
          <EditExperimentEnvironmentsModal
            info={servedValueFeature}
            stagedScope={stagedScope}
            environmentStates={environmentStates}
            environmentInputs={scopeBaseInputs}
            showFlag
            close={() => setEditEnvironments(false)}
            apply={(scope) => {
              flagEnvironments.set(servedValueFeature.feature.id, scope);
              setEditEnvironments(false);
            }}
          />
        )}
        <Flex direction="column">
          <Flex align="center" direction="column">
            {/* An archived Feature Flag serves nothing; its row says why. */}
            {environmentStates.length > 0 &&
            servedValueFeature?.state !== "archived" ? (
              <Flex align="center" justify="center" gap="2" wrap="wrap" mb="3">
                <Text color="text-high" weight="semibold">
                  Environments:
                </Text>
                <EnvironmentStateChips states={environmentStates} />
                {canEditEnvironments && flagEnvironments ? (
                  <IconButton
                    variant="ghost"
                    color="violet"
                    radius="medium"
                    size="1"
                    onClick={() => setEditEnvironments(true)}
                    aria-label="Edit environments"
                  >
                    <PiPencilSimple size="14" />
                  </IconButton>
                ) : null}
              </Flex>
            ) : null}

            {!isHoldout && holdoutId ? (
              <>
                <FunnelCard
                  title="Holdout"
                  onEdit={
                    canJoinHoldout || holdoutLockedReason
                      ? () => setChoosingHoldout(true)
                      : null
                  }
                  editBlockedReason={holdoutLockedReason}
                  menu={
                    canStageHoldout ? (
                      <DropdownMenuItem color="red" onClick={leaveHoldout}>
                        Remove from holdout
                      </DropdownMenuItem>
                    ) : null
                  }
                >
                  <SetupFieldRow label="Name" content="text">
                    {/* A new tab, so following it never costs the page's edits. */}
                    <Link href={`/holdout/${holdoutId}`} external>
                      {holdoutsMap.get(holdoutId)?.name ?? holdoutId}
                    </Link>
                  </SetupFieldRow>
                  <SetupFieldRow label="ID" content="text">
                    <Text color="text-mid">{holdoutId}</Text>
                  </SetupFieldRow>
                </FunnelCard>
                <FunnelConnector />
              </>
            ) : null}

            {!isHoldout && hasNamespace && (
              <>
                <FunnelCard
                  title="Namespace"
                  onEdit={editNamespace}
                  inlineSummary={
                    <Text size="lg" color="text-mid">
                      {namespaceName}
                    </Text>
                  }
                  disabled={!safeToEdit}
                />
                <FunnelConnector label={includedLabel} />
              </>
            )}

            <FunnelCard
              title="Targeting"
              onEdit={editTargeting}
              disabled={!safeToEdit}
              menu={
                canAddNamespace || canAddHoldout ? (
                  <>
                    {canAddHoldout ? (
                      <DropdownMenuItem
                        onClick={() => setChoosingHoldout(true)}
                      >
                        Add to holdout
                      </DropdownMenuItem>
                    ) : null}
                    {canAddNamespace ? (
                      <DropdownMenuItem onClick={() => editNamespace?.()}>
                        Add namespace
                      </DropdownMenuItem>
                    ) : null}
                  </>
                ) : null
              }
            >
              <SetupFieldRow label="Audience" content="text">
                {targetsEveryone ? (
                  <Text color="text-mid">
                    <em>Everyone</em>
                  </Text>
                ) : (
                  <Flex direction="column" gap="3">
                    {hasCondition ? (
                      <ConditionDisplay condition={phase.condition} />
                    ) : null}
                    {hasSavedGroups ? (
                      <SavedGroupTargetingDisplay
                        savedGroups={phase.savedGroups}
                      />
                    ) : null}
                    {hasPrerequisites ? (
                      <ConditionDisplay prerequisites={phase.prerequisites} />
                    ) : null}
                  </Flex>
                )}
              </SetupFieldRow>
              <AssignmentAttribute
                experiment={experiment}
                hashAttribute={hashAttribute}
                fallbackAttribute={fallbackAttribute}
                editInline={editInline}
                stagePatch={stagePatch}
              />
            </FunnelCard>

            <FunnelConnector />

            {/* No pencil: the percentage edits in place, the split has its own
              editor, and each variation carries its own. */}
            <FunnelCard title="Traffic">
              {!isHoldout ? (
                <Box mb="1">
                  <SetupFieldRow
                    label="Included %"
                    content={editInline ? "control" : "text"}
                    labelAlign="center"
                    tooltip="The share of everyone who matches the targeting above that this experiment runs on."
                  >
                    {editInline ? (
                      <PercentField
                        value={coverage}
                        onChange={(next) => stagePatch({ coverage: next })}
                        ariaLabel="Included %"
                      />
                    ) : (
                      <Text color="text-mid">
                        {Math.round(coverage * 100)}%
                      </Text>
                    )}
                  </SetupFieldRow>
                  {/* The bar keeps its place while a draft is edited: the
                    slider is the same readout, made draggable. */}
                  <Box mt="1">
                    {editInline ? (
                      <PercentSlider
                        value={coverage}
                        onChange={(next) => stagePatch({ coverage: next })}
                        ariaLabel="Included %"
                      />
                    ) : (
                      <Box
                        overflow="hidden"
                        style={{
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: "var(--gray-a4)",
                        }}
                      >
                        <Box
                          style={{
                            width: `${Math.min(100, Math.max(0, coverage * 100))}%`,
                            height: "100%",
                            backgroundColor: "var(--violet-9)",
                          }}
                        />
                      </Box>
                    )}
                  </Box>
                </Box>
              ) : (
                <Flex direction="column" gap="1">
                  <Text color="text-mid">
                    {holdoutTraffic.inHoldoutPercent}% in holdout
                  </Text>
                  <Text color="text-mid">
                    {holdoutTraffic.forMeasurementPercent}% not in holdout (for
                    measurement)
                  </Text>
                  <Text color="text-mid">
                    {holdoutTraffic.notForMeasurementPercent}% not in holdout
                    (not for measurement)
                  </Text>
                </Flex>
              )}
            </FunnelCard>
          </Flex>
          {!isHoldout && (
            <>
              <Flex justify="center">
                <Box className={styles.connectorLine} height="24px" mb="2" />
              </Flex>

              {reordering ? (
                <ReorderVariationsModal
                  experiment={experiment}
                  weights={variationWeights}
                  close={() => setReordering(false)}
                  stage={stageVariationList}
                />
              ) : null}

              <VariationValuesTable
                experiment={experiment}
                linkedFeatures={linkedFeatures}
                canEditFlagValues={canEditFlagValues}
                flagEnvironments={flagEnvironments}
                draftPicks={draftPicks}
                flagView={flagView}
                onChangeFlagView={canViewLive ? setFlagView : null}
                split={variationWeights}
                onChangeSplit={
                  editInline && !isBandit
                    ? (weights) => stagePatch({ variationWeights: weights })
                    : null
                }
                splitNote={isBandit ? "Managed by the bandit" : null}
                onEditKeys={
                  canEditExperiment && !variationsLocked
                    ? editVariationKeys
                    : undefined
                }
                onRemoveVariation={
                  canRestructure && numVariations > 2
                    ? removeVariation
                    : undefined
                }
                onReorder={
                  canRestructure ? () => setReordering(true) : undefined
                }
                onAddVariation={
                  canStageVariations && canAddVariation
                    ? addVariation
                    : undefined
                }
              />
              {otherImplementations}
            </>
          )}
        </Flex>
      </Frame>
      {!isHoldout ? (
        <VariationDetails
          experiment={experiment}
          onEdit={
            canEditExperiment && setEditVariationIndex
              ? setEditVariationIndex
              : undefined
          }
        />
      ) : null}
    </>
  );
}

function AssignmentAttribute({
  experiment,
  hashAttribute,
  fallbackAttribute,
  editInline,
  stagePatch,
}: {
  experiment: ExperimentInterfaceStringDates;
  hashAttribute: string;
  fallbackAttribute: string;
  editInline: boolean;
  stagePatch: (patch: Partial<ExperimentTargetingData>) => void;
}) {
  // The picker is too narrow for a popover above it.
  const formatAttributeOption = useMemo(
    () => attributeOptionLabelFormatter("right"),
    [],
  );
  const attributeOptions = useHashAttributeOptions(
    experiment.attributeScopeAllProjects || !experiment.project
      ? null
      : [experiment.project],
    hashAttribute,
  );

  const { getDatasourceById } = useDefinitions();
  const datasource = experiment.datasource
    ? getDatasourceById(experiment.datasource)
    : null;

  return (
    <>
      <SetupFieldRow
        label="Assignment attribute"
        content={editInline ? "control" : "text"}
        labelAlign="center"
        fieldMaxWidth="100px"
        tooltip="Hashed with the tracking key to decide which variation each user gets."
      >
        {editInline ? (
          <SelectField
            size="md"
            value={hashAttribute}
            options={attributeOptions}
            sort={false}
            formatOptionLabel={formatAttributeOption}
            onChange={(v) =>
              // A fallback matching the attribute it backs up is no fallback.
              stagePatch({
                hashAttribute: v,
                ...(v === fallbackAttribute && { fallbackAttribute: "" }),
              })
            }
          />
        ) : (
          <Box>
            <AttributeBadge attributeId={hashAttribute} />
            {fallbackAttribute ? (
              <>
                , <AttributeBadge attributeId={fallbackAttribute} />
              </>
            ) : null}
          </Box>
        )}
      </SetupFieldRow>
      {editInline ? (
        <LinkHashAttributeCallout
          experimentId={experiment.id}
          datasource={datasource}
          hashAttribute={hashAttribute}
          source="Experiment Setup"
        />
      ) : null}
    </>
  );
}
