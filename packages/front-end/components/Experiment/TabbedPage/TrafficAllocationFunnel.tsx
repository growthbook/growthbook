import {
  Dispatch,
  ReactNode,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
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
import { generateVariationId, isManagedByExperiment } from "shared/util";
import {
  Box,
  Flex,
  Grid,
  IconButton,
  SegmentedControl,
} from "@radix-ui/themes";
import { PiCaretDownBold, PiPencilSimple } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import ExperimentSplitVisual from "@/components/Features/ExperimentSplitVisual";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import { getHoldoutTrafficBreakdown } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { getNamespaceDisplayData } from "@/components/Features/NamespaceSelectorUtils";
import EditSplitModal from "@/components/Experiment/EditSplitModal";
import VariationsTable, {
  MIN_VARIATION_WIDTH,
  VARIATION_GRID_GAP_PX,
  variationGridMaxWidth,
} from "@/components/Experiment/VariationsTable";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import UnpublishedDot from "@/components/Experiment/UnpublishedDot";
import EditExperimentEnvironmentsModal from "@/components/Experiment/EditExperimentEnvironmentsModal";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Badge from "@/ui/Badge";
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
  getVariationValueChanges,
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
import FlagValueRows from "./FlagValueRows";
import {
  DraftPick,
  FlagDraftPicks,
  resolveDraftPick,
  withPickedDraft,
} from "./draftPicks";
import styles from "./TrafficAllocationFunnel.module.scss";
import SetupFieldRow from "./SetupFieldRow";
import useExperimentEditing from "./useExperimentEditing";
import {
  FlagEnvironmentsDraft,
  HoldoutDraft,
  useLiveView,
  useRegisterExperimentEdit,
} from "./ExperimentEdits";

export interface Props {
  phaseIndex?: number | null;
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
  editNamespace?: (() => void) | null;
  /** Offers the + that appends a variation and evens out the split. */
  canAddVariation?: boolean;
  /** A Values experiment without its flag: its values are edited here and create it on save. */
  pendingManagedFlag?: boolean;
  /** Stages a new set of variations for the page's Save. */
  stageVariations?: (variations: Variation[]) => void;
  /** Environment scopes staged per flag. */
  flagEnvironments?: FlagEnvironmentsDraft;
  /** Where the values toggle renders, beside the section's heading. */
  headerActionsTarget?: HTMLElement | null;
  /** The page's staged holdout. */
  holdoutDraft?: HoldoutDraft;
  /** Whether the experiment can leave its holdout here. */
  canStageHoldout?: boolean;
  /** Whether it can join or switch holdouts here, which needs the feature. */
  canJoinHoldout?: boolean;
  /** Why the holdout is fixed, shown on its disabled pencil. */
  holdoutLockedReason?: string | null;
  setEditVariationIndex?: (index: number) => void;
  setEditKeyIndex?: (index: number) => void;
  /** The sole linked Feature Flag, whose environments and draft the header describes. */
  servedValueFeature?: LinkedFeatureInfo | null;
  /** Every linked Feature Flag, one value row each under the variations. */
  linkedFeatures?: LinkedFeatureInfo[];
  /** Whether the value rows can be edited in place. */
  canEditFlagValues?: boolean;
  /** Links another Feature Flag from under the value rows. */
  addFeatureFlag?: (() => void) | null;
  /** Why a Feature Flag can't be added right now. */
  addFeatureFlagBlockedReason?: string | null;
  /** The URL Redirect and Visual Editor sections, under the Feature Flags. */
  otherImplementations?: ReactNode;
  canEditExperiment?: boolean;
  safeToEdit: boolean;
  mutate?: () => void;
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

const REFERENCE_ONLY_NOTE =
  "GrowthBook doesn't serve this experiment, so this records how your own system runs it. Changing it doesn't change who sees what.";

function FunnelCard({
  title,
  inlineSummary,
  onEdit,
  children,
  disabled = false,
  editBlockedReason,
  referenceOnly = false,
  menu,
}: {
  title: string;
  inlineSummary?: ReactNode;
  onEdit?: (() => void) | null;
  children?: ReactNode;
  disabled?: boolean;
  /** Why the pencil cannot open right now, which it wears rather than vanishing. */
  editBlockedReason?: string | null;
  /** Normally changes what the SDK serves, but this experiment is served elsewhere. */
  referenceOnly?: boolean;
  /** Items for the menu right of the pencil; no menu without them. */
  menu?: ReactNode;
}) {
  return (
    <Box
      className="appbox"
      maxWidth="692px"
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
          {referenceOnly ? (
            <Tooltip content={REFERENCE_ONLY_NOTE}>
              <Badge
                label="Reference only"
                color="gray"
                variant="soft"
                size="xs"
              />
            </Tooltip>
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

function VariationFork({ count, label }: { count: number; label?: ReactNode }) {
  const cols = Math.min(count, 3);
  // One arrow per column the cards below actually take once they wrap, or a
  // wrapped arrow's bus points off the edge.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(cols);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () =>
      setShown(
        Math.max(
          1,
          Math.min(
            cols,
            Math.floor(
              (grid.clientWidth + VARIATION_GRID_GAP_PX) /
                (MIN_VARIATION_WIDTH + VARIATION_GRID_GAP_PX),
            ),
          ),
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [cols]);

  return (
    <Box>
      {label ? (
        <Flex direction="column" align="center" justify="center" mb="1">
          <Box className={styles.connectorLine} height="12px" />
          <Text size="sm" color="text-low">
            {label}
          </Text>
        </Flex>
      ) : null}
      {/* Stem down to the horizontal bus */}
      <Flex direction="column" align="center">
        <Box className={styles.connectorLine} height="12px" />
      </Flex>
      <Grid
        ref={gridRef}
        columns={`repeat(${shown}, 1fr)`}
        gap="4"
        justify="center"
        style={{ maxWidth: variationGridMaxWidth(cols), margin: "0 auto" }}
      >
        {Array.from({ length: shown }).map((_, i) => (
          <Flex
            key={i}
            direction="column"
            align="center"
            className={styles.cell}
          >
            {i > 0 ? (
              <Box className={clsx(styles.busSegment, styles.busSegmentLeft)} />
            ) : null}
            {i < shown - 1 ? (
              <Box
                className={clsx(styles.busSegment, styles.busSegmentRight)}
              />
            ) : null}
            <Box className={styles.connectorLine} height="22px" />
            <Box mt="-3" mb="-1" className={styles.caret}>
              <PiCaretDownBold size="11" />
            </Box>
          </Flex>
        ))}
      </Grid>
    </Box>
  );
}

export default function TrafficAllocationFunnel({
  phaseIndex = null,
  experiment,
  editTargeting,
  editNamespace,
  canAddVariation = false,
  pendingManagedFlag = false,
  stageVariations,
  flagEnvironments,
  headerActionsTarget,
  holdoutDraft,
  canStageHoldout = false,
  canJoinHoldout = false,
  holdoutLockedReason = null,
  setEditVariationIndex,
  setEditKeyIndex,
  servedValueFeature: storedServedValueFeature,
  linkedFeatures = [],
  canEditFlagValues: canEditFlagValuesHere = false,
  addFeatureFlag,
  addFeatureFlagBlockedReason = null,
  otherImplementations,
  canEditExperiment: canEditExperimentHere = false,
  safeToEdit = false,
  mutate,
  targetingDraft,
}: Props) {
  const { namespaces } = useOrgSettings();
  const { apiCall } = useAuth();
  const { editInline: editInlineHere, analysisOnly } =
    useExperimentEditing(experiment);

  const targetingDefaults = useTargetingDefaults(experiment);
  const staged = targetingDraft?.value ?? null;

  // Everything below reads the staged targeting where there is one, so a
  // confirmed change shows on the page before it is written.
  const stagePatch = (patch: Partial<ExperimentTargetingData>) =>
    targetingDraft?.set((prev) => ({
      ...(prev ?? targetingDefaults),
      ...patch,
    }));

  useRegisterExperimentEdit("targeting", !!staged, {
    save: async () => {
      await apiCall(`/experiment/${experiment.id}/targeting`, {
        method: "POST",
        body: JSON.stringify(staged),
      });
    },
    onSaved: () => targetingDraft?.set(null),
    discard: () => targetingDraft?.set(null),
  });

  // The experiment-level half of the targeting, staged the same way.
  const hashAttribute =
    staged?.hashAttribute ?? experiment.hashAttribute ?? "id";
  const fallbackAttribute =
    staged?.fallbackAttribute ?? experiment.fallbackAttribute ?? "";

  const [editingSplit, setEditingSplit] = useState<number | null>(null);

  // Staged like any other edit; the split evens out unless weights are given.
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
  const removeVariation = (index: number) =>
    stageVariationList(
      getLatestPhaseVariations(experiment)
        .filter((_, i) => i !== index)
        .map(({ id, key, name, description, screenshots }) => ({
          id,
          key,
          name,
          description,
          screenshots,
        })),
    );
  const addVariation = () => {
    const current = getLatestPhaseVariations(experiment);
    const variations = [
      ...current.map(({ id, key, name, description, screenshots }) => ({
        id,
        key,
        name,
        description,
        screenshots,
      })),
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
  const [draftPickValue, setDraftPicks] = useState<Record<string, DraftPick>>(
    {},
  );
  const draftPicks: FlagDraftPicks = useMemo(
    () => ({
      value: draftPickValue,
      set: (featureId, pick) =>
        setDraftPicks((prev) => ({ ...prev, [featureId]: pick })),
    }),
    [draftPickValue],
  );
  const pickedFeatures = useMemo(
    () =>
      linkedFeatures.map((info) =>
        withPickedDraft(info, draftPickValue[info.feature.id], experiment.id),
      ),
    [linkedFeatures, draftPickValue, experiment.id],
  );
  const servedValueFeature = useMemo(
    () =>
      storedServedValueFeature
        ? withPickedDraft(
            storedServedValueFeature,
            draftPickValue[storedServedValueFeature.feature.id],
            experiment.id,
          )
        : null,
    [storedServedValueFeature, draftPickValue, experiment.id],
  );

  // Each readout asks about itself.
  const liveRule = servedValueFeature?.liveHasMatchingRule
    ? servedValueFeature
    : undefined;
  const environmentsDiffer = servedValueFeature
    ? environmentStatesDiffer(servedValueFeature)
    : false;

  // The toggle offers a draft only when something it shows actually moved:
  // any linked flag counts, since the value rows show every flag's draft.
  const hasDraftChanges = useMemo(
    () =>
      pickedFeatures.some(
        (info) =>
          !!info.pendingDraft &&
          (getVariationValueChanges(
            info,
            (info.pendingDraft.values ?? []).map((v) => v.variationId),
          ).some((c) => c.unpublished) ||
            environmentStatesDiffer(info)),
      ),
    [pickedFeatures],
  );
  const { live, setLive } = useLiveView();
  const preferDraft = hasDraftChanges && !live;
  // Live values are what's published, so nothing edits them in place.
  const viewingLive = hasDraftChanges && live;
  const canEditExperiment = canEditExperimentHere && !viewingLive;
  const canEditFlagValues = canEditFlagValuesHere && !viewingLive;
  const editInline = editInlineHere && !viewingLive;
  // With nothing unpublished the toggle goes, and the page edits again.
  useEffect(() => {
    if (!hasDraftChanges && live) setLive(false);
  }, [hasDraftChanges, live, setLive]);

  // Mirror the server's publish authority on eject.
  const managedFeature =
    servedValueFeature &&
    isManagedByExperiment(servedValueFeature.feature, experiment.id)
      ? servedValueFeature.feature
      : null;
  // Re-scoping environments stages a draft without re-bucketing.
  const canEditEnvironments =
    !!servedValueFeature &&
    !servedValueFeature.pendingRemoval &&
    canEditExperiment &&
    permissionsUtil.canEditFeatureDrafts(servedValueFeature.feature);
  const [editEnvironments, setEditEnvironments] = useState(false);
  const envStateSource = preferDraft
    ? servedValueFeature?.pendingDraft
    : liveRule && { environmentStates: liveRule.liveEnvironmentStates };
  const environmentsAreDraft = preferDraft && environmentsDiffer;

  // A managed flag has one draft; the count is the others not shown.
  const draftDetail = (() => {
    const draft = servedValueFeature?.pendingDraft;
    if (!draft || managedFeature) return { name: undefined, note: undefined };
    const others = draft.otherDraftCount ?? 0;
    return {
      // In a sentence a draft goes by its number.
      name: `Revision ${draft.version}`,
      note: others
        ? `${others} other draft${others > 1 ? "s" : ""} of this Feature Flag also include this experiment`
        : undefined,
    };
  })();
  const stagedScope = servedValueFeature
    ? (flagEnvironments?.value[servedValueFeature.feature.id] ?? null)
    : null;
  // Like the values, the Live view leaves the staged scope for Save.
  const shownScope = viewingLive ? null : stagedScope;
  // What a staged scope lands on.
  const scopeBaseInputs =
    (preferDraft
      ? servedValueFeature?.pendingDraft?.environmentInputs
      : servedValueFeature?.liveEnvironmentInputs) ??
    servedValueFeature?.environmentInputs ??
    {};
  const environmentStates = getEnvironmentStates(
    shownScope && servedValueFeature
      ? {
          environmentStates: statesFromInputs(
            stageEnvironmentInputs(scopeBaseInputs, shownScope),
          ),
        }
      : envStateSource || { environmentStates: {} },
    {
      future: environmentStateTense({
        status: experiment.status,
        unpublished: environmentsAreDraft || !!shownScope,
        // The row's pick, which may not be the draft that launches.
        launches:
          !storedServedValueFeature ||
          resolveDraftPick(
            storedServedValueFeature,
            draftPickValue[storedServedValueFeature.feature.id],
            experiment.id,
          ).launches,
        liveView: viewingLive,
      }),
    },
  );

  const isHoldout = experiment.type === "holdout";
  const isRunning = experiment.status === "running";
  // Analysis only serves nothing, so its variations stay editable throughout.
  const variationsLocked = isRunning && !analysisOnly;
  const canStageVariations =
    canEditExperiment &&
    !variationsLocked &&
    !!stageVariations &&
    !!targetingDraft;
  // Bucketing follows the variation list, so its shape is fixed once it starts.
  const canRestructure =
    canStageVariations && (experiment.status === "draft" || analysisOnly);
  const canAddNamespace =
    !viewingLive &&
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

  const hasConfiguredTargeting = hasTargetingConfigured(phase);
  // Environment scope has its own line above, so the audience is attributes alone.
  const targetsEveryone = !hasConfiguredTargeting;
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
  const variationWeights =
    staged?.variationWeights ?? storedPhase?.variationWeights ?? [];

  // Beside the section's heading when it offers a place, else atop the box.
  const actions = (
    <Flex align="center" gap="3">
      {hasDraftChanges ? (
        <SegmentedControl.Root
          size="2"
          value={preferDraft ? "draft" : "live"}
          onValueChange={(v) => setLive(v === "live")}
          aria-label="Values shown"
        >
          <SegmentedControl.Item value="draft">
            <Flex align="center" gap="2">
              <UnpublishedDot />
              Unpublished
            </Flex>
          </SegmentedControl.Item>
          <SegmentedControl.Item value="live">
            Live values
          </SegmentedControl.Item>
        </SegmentedControl.Root>
      ) : (
        // Nothing unpublished to compare, so the one view the page shows.
        <SegmentedControl.Root size="2" value="only" aria-label="Values shown">
          <SegmentedControl.Item value="only">
            {linkedFeatures.length > 0 || experiment.status !== "draft"
              ? "Live values"
              : "Unpublished"}
          </SegmentedControl.Item>
        </SegmentedControl.Root>
      )}
    </Flex>
  );

  return (
    <Frame style={{ backgroundColor: "var(--gray-a2)", border: "none" }}>
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
          showFlag={!managedFeature}
          close={() => setEditEnvironments(false)}
          apply={(scope) => {
            flagEnvironments.set(servedValueFeature.feature.id, scope);
            setEditEnvironments(false);
          }}
        />
      )}
      {headerActionsTarget ? (
        createPortal(actions, headerActionsTarget)
      ) : (
        <Flex justify="end" align="center" mb="4">
          {actions}
        </Flex>
      )}
      <Flex direction="column">
        <Flex align="center" direction="column">
          {/* An archived Feature Flag serves nothing; its row says why. */}
          {environmentStates.length > 0 &&
          servedValueFeature?.state !== "archived" ? (
            <Flex align="center" justify="center" gap="2" wrap="wrap" mb="3">
              {(environmentsAreDraft || shownScope) && (
                <UnpublishedDot
                  tooltip={
                    shownScope
                      ? managedFeature
                        ? "Not saved yet."
                        : draftDetail.name
                          ? `Not saved yet. Saving adds it to ${draftDetail.name}.`
                          : "Not saved yet. Saving starts a new draft."
                      : draftDetail.name
                        ? `${draftDetail.name} changes these environments.`
                        : "Unpublished environment changes."
                  }
                  note={draftDetail.note}
                />
              )}
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
                referenceOnly={analysisOnly}
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
                onEdit={viewingLive ? null : editNamespace}
                inlineSummary={
                  <Text size="lg" color="text-mid">
                    {namespaceName}
                  </Text>
                }
                disabled={!safeToEdit}
                referenceOnly={analysisOnly}
              />
              <FunnelConnector label={includedLabel} />
            </>
          )}

          <FunnelCard
            title="Targeting"
            onEdit={viewingLive ? null : editTargeting}
            disabled={!safeToEdit}
            referenceOnly={analysisOnly}
            menu={
              canAddNamespace || canAddHoldout ? (
                <>
                  {canAddHoldout ? (
                    <DropdownMenuItem onClick={() => setChoosingHoldout(true)}>
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
              analysisOnly={analysisOnly}
              stagePatch={stagePatch}
            />
          </FunnelCard>

          <FunnelConnector />

          {/* No pencil: the percentage edits in place, the split has its own
              editor, and each variation carries its own. */}
          <FunnelCard title="Traffic" referenceOnly={analysisOnly}>
            {!isHoldout ? (
              <Box mb="1">
                <SetupFieldRow
                  label="Included %"
                  content={editInline ? "control" : "text"}
                  labelAlign="center"
                  tooltip={
                    analysisOnly
                      ? "The share of the targeted audience your own system included, for reference."
                      : "The share of everyone who matches the targeting above that this experiment runs on."
                  }
                >
                  {editInline ? (
                    <PercentField
                      value={phase.coverage ?? 1}
                      onChange={(coverage) => stagePatch({ coverage })}
                      ariaLabel="Included %"
                    />
                  ) : (
                    <Text color="text-mid">
                      {Math.round((phase.coverage ?? 1) * 100)}%
                    </Text>
                  )}
                </SetupFieldRow>
                {/* The bar keeps its place while a draft is edited: the
                    slider is the same readout, made draggable. */}
                <Box mt="1">
                  {editInline ? (
                    <PercentSlider
                      value={phase.coverage ?? 1}
                      onChange={(coverage) => stagePatch({ coverage })}
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
                          width: `${Math.min(100, Math.max(0, (phase.coverage ?? 1) * 100))}%`,
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
                  {holdoutTraffic.notForMeasurementPercent}% not in holdout (not
                  for measurement)
                </Text>
              </Flex>
            )}
          </FunnelCard>
        </Flex>
        {!isHoldout && (
          <>
            {isBandit ? (
              <VariationFork count={numVariations} />
            ) : (
              <Box pb="4">
                <Flex direction="column" align="center">
                  <Box className={styles.connectorLine} height="6px" />
                  {/* The label stays centred on the stem, so the pencil hangs
                      off its right rather than taking room in the row. */}
                  <Box position="relative">
                    <Text size="md" weight="medium" color="text-mid">
                      Split
                    </Text>
                    {editInline ? (
                      <Box
                        position="absolute"
                        left="100%"
                        top="50%"
                        ml="1"
                        style={{ lineHeight: 0, transform: "translateY(-50%)" }}
                      >
                        <Tooltip content="Edit Split">
                          <IconButton
                            variant="ghost"
                            color="violet"
                            radius="medium"
                            size="1"
                            onClick={() => setEditingSplit(0)}
                            aria-label="Edit Split"
                          >
                            <PiPencilSimple size="14" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    ) : null}
                  </Box>
                </Flex>
                {/* Coverage is already shown above, so this bar is purely the
                    split between variations. Held to the grid's width so the
                    two line up. */}
                <Box
                  mx="auto"
                  style={{
                    maxWidth: variationGridMaxWidth(Math.min(numVariations, 3)),
                  }}
                >
                  <ExperimentSplitVisual
                    slim
                    connector
                    overhang={VARIATION_GRID_GAP_PX / 2}
                    bleed={2}
                    coverage={1}
                    stackLeft
                    type="string"
                    onSegmentClick={
                      editInline ? (i) => setEditingSplit(i) : undefined
                    }
                    values={phaseVariations.map((v, i) => ({
                      value: v.key,
                      weight: phase?.variationWeights?.[i] ?? 0,
                      name: v.name,
                    }))}
                  />
                </Box>
              </Box>
            )}

            {editingSplit !== null ? (
              <EditSplitModal
                variations={phaseVariations}
                weights={variationWeights}
                staged
                focusIndex={editingSplit}
                close={() => setEditingSplit(null)}
                onConfirm={(weights) => {
                  stagePatch({ variationWeights: weights });
                  setEditingSplit(null);
                }}
              />
            ) : null}

            {reordering ? (
              <ReorderVariationsModal
                experiment={experiment}
                weights={variationWeights}
                close={() => setReordering(false)}
                stage={stageVariationList}
              />
            ) : null}

            <VariationsTable
              experiment={experiment}
              canEditExperiment={canEditExperiment}
              mutate={mutate}
              noMargin
              centered
              showSplit={false}
              // A running experiment changes through "Make Changes" alone, so
              // its variations offer no edits of their own.
              onEditMetadata={
                canEditExperiment && !variationsLocked && setEditVariationIndex
                  ? (index) => setEditVariationIndex(index)
                  : undefined
              }
              onEditKey={
                canEditExperiment && !variationsLocked && setEditKeyIndex
                  ? setEditKeyIndex
                  : undefined
              }
              onRemoveVariation={
                canRestructure && numVariations > 2
                  ? removeVariation
                  : undefined
              }
              onReorder={canRestructure ? () => setReordering(true) : undefined}
              onAddVariation={
                canStageVariations && canAddVariation ? addVariation : undefined
              }
            />
            <FlagValueRows
              experiment={experiment}
              flagEnvironments={flagEnvironments}
              draftPicks={draftPicks}
              linkedFeatures={linkedFeatures}
              pendingManagedFlag={pendingManagedFlag}
              canEdit={canEditFlagValues}
              canEditLinks={canEditFlagValuesHere}
              onAddFlag={viewingLive ? null : addFeatureFlag}
              addFlagBlockedReason={addFeatureFlagBlockedReason}
              showLive={hasDraftChanges && !preferDraft}
            />
            {otherImplementations}
          </>
        )}
      </Flex>
    </Frame>
  );
}

function AssignmentAttribute({
  experiment,
  hashAttribute,
  fallbackAttribute,
  editInline,
  analysisOnly,
  stagePatch,
}: {
  experiment: ExperimentInterfaceStringDates;
  hashAttribute: string;
  fallbackAttribute: string;
  editInline: boolean;
  // GrowthBook assigns no one here, so the copy and link callout don't apply.
  analysisOnly: boolean;
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
        tooltip={
          analysisOnly
            ? "The attribute your own system assigns variations by, for reference."
            : "Hashed with the tracking key to decide which variation each user gets."
        }
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
      {editInline && !analysisOnly ? (
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
