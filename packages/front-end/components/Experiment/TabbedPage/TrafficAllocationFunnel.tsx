import clsx from "clsx";
import { Dispatch, ReactNode, SetStateAction, useMemo, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
  LinkedFeatureInfo,
  Variation,
} from "shared/types/experiment";
import {
  changedTargeting,
  getEqualWeights,
  getLatestPhaseVariations,
  getStorableVariations,
  hasAttributeCondition,
  hasTargetingConfigured,
  onlyTrafficFields,
} from "shared/experiments";
import {
  coverageToHoldoutSize,
  generateVariationId,
  isNamespaceSelectable,
} from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPencilSimple, PiPlus, PiWarningFill } from "react-icons/pi";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { getNamespaceDisplayData } from "@/components/Features/NamespaceSelectorUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Tooltip from "@/ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuItem,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import ReorderVariationsModal from "@/components/Experiment/ReorderVariationsModal";
import Link from "@/ui/Link";
import track from "@/services/track";
import { PercentField } from "@/components/Forms/PercentSliderField";
import EditTrafficModal from "@/components/Experiment/EditTrafficModal";
import { useTargetingDefaults } from "@/components/Experiment/useExperimentTargetingForm";
import AddToHoldoutModal from "@/components/Experiment/holdout/AddToHoldoutModal";
import { holdoutSizeTip, useHoldouts } from "@/hooks/useHoldouts";
import { useExperimentStatusIndicator } from "@/hooks/useExperimentStatusIndicator";
import Badge from "@/ui/Badge";
import { selectableHoldouts } from "@/components/Holdout/HoldoutSelect";
import { coveragePercentFormatter } from "@/services/utils";
import FunnelConnector from "./FunnelConnector";
import { ImplementationColumn } from "./ImplementationColumn";
import VariationValuesTable from "./VariationValuesTable";
import { InfoTip } from "./SetupFieldRow";
import { DraftPick, FlagDraftPicks } from "./draftPicks";
import styles from "./TrafficAllocationFunnel.module.scss";
import useExperimentEditing from "./useExperimentEditing";
import {
  experimentFieldChanges,
  FlagEnvironmentsDraft,
  HoldoutDraft,
  reviewAgainstCurrent,
  useEditBase,
  useExperimentEdits,
  useRegisterExperimentEdit,
  useStagedState,
} from "./ExperimentEdits";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
  editNamespace?: (() => void) | null;
  /** Offers the + that appends a variation and evens out the split. */
  canAddVariation: boolean;
  stageVariations: (variations: Variation[] | null) => void;
  flagEnvironments: FlagEnvironmentsDraft;
  holdoutDraft?: HoldoutDraft;
  /** Whether the experiment can leave its holdout here. */
  canStageHoldout: boolean;
  /** Whether it can join or switch holdouts here, which needs the feature. */
  canJoinHoldout: boolean;
  /** Why the holdout is fixed, shown on its disabled pencil. */
  holdoutLockedReason: string | null;
  editVariationKeys: () => void;
  linkedFeatures: LinkedFeatureInfo[];
  canEditFlagValues: boolean;
  implementationColumns: ImplementationColumn[];
  addImplementation: ReactNode;
  canEditExperiment: boolean;
  safeToEdit: boolean;
  /** Targeting confirmed in a modal but not yet written. */
  targetingDraft?: TargetingDraft;
}

// Whether staged targeting rewrites the phase's variation list (an add, a
// removal or a reorder), which the Variations edit stages alongside it.
export function changesVariationList(
  staged: ExperimentTargetingData | null,
  experiment: ExperimentInterfaceStringDates,
): boolean {
  if (!staged?.variations) return false;
  const ids = (variations: { id: string }[] = []) =>
    variations.map((v) => v.id).join("\u0000");
  return ids(staged.variations) !== ids(experiment.phases.at(-1)?.variations);
}

export interface TargetingDraft {
  value: ExperimentTargetingData | null;
  // An updater, so each of a rebalance's writes in one tick sees the last.
  set: Dispatch<SetStateAction<ExperimentTargetingData | null>>;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function FunnelRow({
  label,
  tip,
  children,
}: {
  label: string;
  tip?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Flex align="center" justify="between" gap="4" minHeight="32px">
      <Flex align="center" gap="1">
        <Text color="text-mid">{label}</Text>
        {tip ? <InfoTip content={tip} /> : null}
      </Flex>
      {children}
    </Flex>
  );
}

const CARD_WIDTH = 450;
const GROWN_CARD_WIDTH = 600;

function FunnelCard({
  title,
  onEdit,
  children,
  disabled = false,
  editBlockedReason,
  menu,
  grow = false,
}: {
  title: string;
  onEdit?: (() => void) | null;
  children?: ReactNode;
  disabled?: boolean;
  // Shown on a disabled pencil rather than hiding it.
  editBlockedReason?: string | null;
  menu?: ReactNode;
  grow?: boolean;
}) {
  const editable = !!onEdit && !disabled;
  return (
    <Box
      className={clsx("appbox", styles.card)}
      width={grow ? "fit-content" : "100%"}
      minWidth={grow ? `min(${CARD_WIDTH}px, 100%)` : undefined}
      maxWidth={`min(${grow ? GROWN_CARD_WIDTH : CARD_WIDTH}px, 100%)`}
      mb="0"
      py="3"
      style={{ paddingLeft: 16, paddingRight: 16 }}
    >
      <Flex
        justify="between"
        align="center"
        gap="3"
        className={clsx(editable && styles.editableHeader)}
      >
        <Text size="lg" weight="medium" color="text-high">
          {title}
        </Text>
        <Flex align="center" gap="3" className={styles.cardActions}>
          {editable ? (
            <Tooltip
              content={editBlockedReason}
              enabled={!!editBlockedReason}
              confineToTrigger={false}
            >
              <IconButton
                className={styles.edit}
                variant="ghost"
                color="violet"
                radius="full"
                disabled={!!editBlockedReason}
                onClick={() => onEdit()}
                size="2"
                aria-label={`Edit ${title}`}
              >
                <PiPencilSimple size="16" />
              </IconButton>
            </Tooltip>
          ) : null}
          {menu ? (
            <DropdownMenu
              trigger={
                <MoreMenuTrigger
                  label={`${title} actions`}
                  style={{ margin: 0 }}
                />
              }
              menuPlacement="end"
              variant="soft"
            >
              {menu}
            </DropdownMenu>
          ) : null}
        </Flex>
      </Flex>
      {children ? <Box mt="2">{children}</Box> : null}
    </Box>
  );
}

export default function TrafficAllocationFunnel({
  experiment,
  editTargeting,
  editNamespace,
  canAddVariation,
  stageVariations,
  flagEnvironments,
  holdoutDraft,
  canStageHoldout,
  canJoinHoldout,
  holdoutLockedReason,
  editVariationKeys,
  linkedFeatures,
  canEditFlagValues,
  implementationColumns,
  addImplementation,
  canEditExperiment,
  safeToEdit,
  targetingDraft,
}: Props) {
  const { namespaces } = useOrgSettings();
  const edits = useExperimentEdits();
  const { editInline } = useExperimentEditing(experiment);

  const targetingDefaults = useTargetingDefaults(experiment);
  const staged = targetingDraft?.value ?? null;

  const stagePatch = (patch: Partial<ExperimentTargetingData>) =>
    targetingDraft?.set((prev) => ({
      ...(prev ?? targetingDefaults),
      ...patch,
    }));

  // A variation added, removed or reordered was staged in both edits, so
  // discarding one takes the other with it.
  const clearStaged = () => {
    if (changesVariationList(staged, experiment)) stageVariations(null);
    targetingDraft?.set(null);
  };
  const [targetingBase, rebaseTargeting] = useEditBase(
    "targeting",
    !!staged,
    () => ({ experiment, targeting: targetingDefaults }),
  );
  // What the staged targeting changes from what it was made against, rather
  // than from any refetch since.
  const mine = staged
    ? changedTargeting(staged, targetingBase?.targeting ?? targetingDefaults)
    : {};
  // Over what's saved now: what the page shows, and what keeping mine keeps.
  const effective = staged ? { ...targetingDefaults, ...mine } : null;
  useRegisterExperimentEdit("targeting", !!staged, {
    statusBound: true,
    discard: clearStaged,
    label: onlyTrafficFields(Object.keys(mine)) ? "Traffic" : "Targeting",
    review: () => reviewAgainstCurrent(experiment, mine),
    rebase: () => {
      if (effective) targetingDraft?.set(effective);
      rebaseTargeting();
    },
    changes: () =>
      experimentFieldChanges(targetingBase?.experiment ?? experiment, mine),
  });

  const hashAttribute =
    effective?.hashAttribute || experiment.hashAttribute || "id";
  const fallbackAttribute =
    effective?.fallbackAttribute ?? experiment.fallbackAttribute ?? "";

  const stageVariationList = (
    variations: Variation[],
    weights = getEqualWeights(variations.length, 4),
  ) => {
    stageVariations(variations);
    // Targeting writes the phase's variations too, so it must carry them.
    stagePatch({
      variations: variations.map(({ id }) => ({ id, status: "active" })),
      variationWeights: weights,
    });
  };
  const [reordering, setReordering] = useState(false);
  const [editingTraffic, setEditingTraffic] = useState(false);
  const storedVariations = () => getStorableVariations(experiment);
  const removeVariation = (index: number) =>
    stageVariationList(storedVariations().filter((_, i) => i !== index));
  const addVariation = () => {
    const current = storedVariations();
    // The count's own key can still be taken after a removal.
    const keys = new Set(current.map((v) => v.key));
    let key = current.length;
    while (keys.has(String(key))) key++;
    const variations = [
      ...current,
      {
        id: generateVariationId(),
        key: String(key),
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

  const storedPhase = experiment.phases?.[experiment.phases.length - 1];
  const phase = effective
    ? {
        ...storedPhase,
        coverage: effective.coverage,
        condition: effective.condition,
        savedGroups: effective.savedGroups,
        prerequisites: effective.prerequisites,
        variationWeights: effective.variationWeights,
        namespace: effective.namespace,
      }
    : storedPhase;
  const hasNamespace = phase?.namespace && phase.namespace.enabled;

  const { coverage: namespaceCoverage, name: namespaceName } =
    getNamespaceDisplayData(phase?.namespace, namespaces);
  const namespaceDeleted =
    !!hasNamespace &&
    !namespaces?.some((n) => n.name === phase?.namespace?.name);

  const isBandit = experiment.type === "multi-armed-bandit";

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
  const isRunning = experiment.status === "running";
  const variationsLocked = isRunning || !safeToEdit;
  // Coverage and split edit in place only while delivery can.
  const editDeliveryInline = editInline && safeToEdit;
  const canStageVariations =
    canEditExperiment && !variationsLocked && !!targetingDraft;
  // Bucketing follows the variation list, so its shape is fixed once it starts.
  const canRestructure = canStageVariations && experiment.status === "draft";
  // Only while there's one it can join.
  const canAddNamespace =
    !!editNamespace &&
    safeToEdit &&
    !hasNamespace &&
    !!namespaces?.some((n) =>
      isNamespaceSelectable(n, { hashAttribute, fallbackAttribute }),
    );

  // Staged over what's stored: "" means leaving the stored holdout.
  const holdoutId = holdoutDraft?.value ?? experiment.holdoutId ?? "";
  // Archived too, so a linked holdout that's since been archived still shows.
  const { holdouts, holdoutsMap, experimentsMap } = useHoldouts(
    undefined,
    true,
    { enabled: canStageHoldout || !!holdoutId },
  );
  const holdout = holdoutsMap.get(holdoutId);
  const holdoutExperiment = holdout
    ? experimentsMap.get(holdout.experimentId)
    : undefined;
  const holdoutPhase = holdoutExperiment?.phases.at(-1);
  const holdoutSize = holdoutPhase
    ? coverageToHoldoutSize(holdoutPhase.coverage)
    : null;
  const getStatusIndicator = useExperimentStatusIndicator();
  const holdoutStatus = holdoutExperiment
    ? getStatusIndicator(holdoutExperiment)
    : null;
  const [choosingHoldout, setChoosingHoldout] = useState(false);
  const canAddHoldout =
    canJoinHoldout &&
    !holdoutId &&
    selectableHoldouts(holdouts, experimentsMap, experiment.project).length > 0;
  // Leaving a holdout only just staged is undoing it.
  const leaveHoldout = () =>
    holdoutDraft?.set(experiment.holdoutId ? "" : null);
  const stageHoldout = (id: string) =>
    holdoutDraft?.set(id === (experiment.holdoutId ?? "") ? null : id);

  if (!phase) {
    return (
      <Callout status="warning" mb="4">
        No traffic allocation or targeting configured yet. Add a phase to this
        experiment.
      </Callout>
    );
  }

  const phaseVariations = getLatestPhaseVariations(experiment);
  const numVariations = phaseVariations.length;
  const variationWeights = phase.variationWeights ?? [];
  const coverage = phase.coverage ?? 1;

  return (
    <Frame
      px="4"
      noBackground
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
      <Flex direction="column">
        <Flex align="center" direction="column">
          {holdoutId ? (
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
                <FunnelRow label="Name">
                  <Flex align="center" gap="2">
                    <Link href={`/holdout/${holdoutId}`} external>
                      {holdout?.name ?? holdoutId}
                    </Link>
                    {holdoutStatus ? (
                      <Badge
                        label={holdoutStatus.status}
                        color={holdoutStatus.color}
                        variant="soft"
                        radius="full"
                        size="xs"
                      />
                    ) : null}
                  </Flex>
                </FunnelRow>
                {holdoutSize !== null ? (
                  <FunnelRow
                    label="Holdout size"
                    tip={holdoutSizeTip(holdoutSize)}
                  >
                    <Text color="text-high">
                      {coveragePercentFormatter.format(holdoutSize)}
                    </Text>
                  </FunnelRow>
                ) : null}
                {holdoutPhase ? <Audience phase={holdoutPhase} /> : null}
                {holdoutExperiment ? (
                  <AssignmentAttribute
                    hashAttribute={holdoutExperiment.hashAttribute || "id"}
                    fallbackAttribute={
                      holdoutExperiment.fallbackAttribute ?? ""
                    }
                  />
                ) : null}
              </FunnelCard>
              <FunnelConnector />
            </>
          ) : null}

          <FunnelCard
            title="Targeting"
            grow
            onEdit={editTargeting}
            disabled={!safeToEdit}
            menu={
              canAddHoldout ? (
                <DropdownMenuItem onClick={() => setChoosingHoldout(true)}>
                  Add to holdout
                </DropdownMenuItem>
              ) : null
            }
          >
            <Audience phase={phase} />
            <AssignmentAttribute
              hashAttribute={hashAttribute}
              fallbackAttribute={fallbackAttribute}
            />
          </FunnelCard>

          {hasNamespace ? (
            <>
              <FunnelConnector />
              <FunnelCard
                title="Namespace"
                onEdit={editNamespace}
                disabled={!safeToEdit}
              >
                <FunnelRow label="Name">
                  {namespaceDeleted ? (
                    <Tooltip content="This namespace no longer exists. The experiment still splits traffic by it, but it can't be chosen again.">
                      <Flex align="center" gap="1">
                        <PiWarningFill
                          style={{ color: "var(--amber-11)", flexShrink: 0 }}
                        />
                        <Text color="text-high">{namespaceName}</Text>
                      </Flex>
                    </Tooltip>
                  ) : (
                    <Text color="text-high">{namespaceName}</Text>
                  )}
                </FunnelRow>
                {namespaceCoverage ? (
                  <FunnelRow label="Namespace percentage">
                    <Text color="text-high">
                      {percentFormatter.format(namespaceCoverage)}
                    </Text>
                  </FunnelRow>
                ) : null}
              </FunnelCard>
              <FunnelConnector />
            </>
          ) : canAddNamespace ? (
            <Flex direction="column" align="center">
              <Box className={styles.connectorLine} height="12px" />
              <Link color="gray" onClick={() => editNamespace?.()}>
                <Flex align="center" gap="1">
                  <PiPlus />
                  Namespace
                </Flex>
              </Link>
              <Box className={styles.connectorLine} height="12px" />
            </Flex>
          ) : (
            <FunnelConnector />
          )}

          <FunnelCard
            title="Traffic"
            onEdit={
              editDeliveryInline ? () => setEditingTraffic(true) : editTargeting
            }
            disabled={!safeToEdit}
          >
            <FunnelRow label="Rollout percentage">
              {editDeliveryInline ? (
                <PercentField
                  value={coverage}
                  onChange={(next) => stagePatch({ coverage: next })}
                  ariaLabel="Rollout percentage"
                  form={edits?.formId}
                />
              ) : (
                <Text color="text-high">
                  {coveragePercentFormatter.format(coverage)}
                </Text>
              )}
            </FunnelRow>
          </FunnelCard>
        </Flex>
        {editingTraffic ? (
          <EditTrafficModal
            experiment={experiment}
            coverage={coverage}
            weights={variationWeights}
            close={() => setEditingTraffic(false)}
            stage={(traffic) => {
              stagePatch(traffic);
              setEditingTraffic(false);
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

        <VariationValuesTable
          experiment={experiment}
          linkedFeatures={linkedFeatures}
          canEditFlagValues={canEditFlagValues}
          flagEnvironments={flagEnvironments}
          draftPicks={draftPicks}
          split={variationWeights}
          onChangeSplit={
            editDeliveryInline && !isBandit
              ? (weights) => stagePatch({ variationWeights: weights })
              : null
          }
          splitNote={isBandit ? "Managed by Bandit" : null}
          onEditKeys={
            canEditExperiment && !variationsLocked
              ? editVariationKeys
              : undefined
          }
          onRemoveVariation={
            canRestructure && numVariations > 2 ? removeVariation : undefined
          }
          onReorder={canRestructure ? () => setReordering(true) : undefined}
          onAddVariation={
            canStageVariations && canAddVariation ? addVariation : undefined
          }
          implementationColumns={implementationColumns}
          addImplementation={addImplementation}
        />
      </Flex>
    </Frame>
  );
}

function Audience({
  phase,
}: {
  phase: Pick<
    ExperimentPhaseStringDates,
    "condition" | "savedGroups" | "prerequisites"
  >;
}) {
  if (!hasTargetingConfigured(phase)) {
    return (
      <FunnelRow label="Audience">
        <Text color="text-high">Everyone</Text>
      </FunnelRow>
    );
  }
  return (
    <>
      <FunnelRow label="Audience" />
      <Box pl="4" mb="2">
        <ConditionDisplay
          variant="rows"
          condition={
            hasAttributeCondition(phase.condition) ? phase.condition : undefined
          }
          savedGroups={
            phase.savedGroups?.length ? phase.savedGroups : undefined
          }
          prerequisites={
            phase.prerequisites?.length ? phase.prerequisites : undefined
          }
        />
      </Box>
    </>
  );
}

function AssignmentAttribute({
  hashAttribute,
  fallbackAttribute,
}: {
  hashAttribute: string;
  fallbackAttribute: string;
}) {
  return (
    <FunnelRow label="Assignment attribute">
      <Text color="text-high">
        {fallbackAttribute
          ? `${hashAttribute}, ${fallbackAttribute}`
          : hashAttribute}
      </Text>
    </FunnelRow>
  );
}
