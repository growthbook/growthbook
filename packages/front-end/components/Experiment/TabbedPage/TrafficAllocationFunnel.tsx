import { ReactNode, useMemo, useState } from "react";
import clsx from "clsx";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  getLatestPhaseVariations,
  hasAttributeCondition,
  hasTargetingConfigured,
} from "shared/experiments";
import {
  filterEnvironmentsByExperiment,
  getImplementationType,
  isManagedByExperiment,
} from "shared/util";
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
import VariationsTable, {
  VARIATION_GRID_COLUMNS,
  variationGridMaxWidth,
} from "@/components/Experiment/VariationsTable";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import UnpublishedDot from "@/components/Experiment/UnpublishedDot";
import EditExperimentEnvironmentsModal from "@/components/Experiment/EditExperimentEnvironmentsModal";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import {
  EnvironmentStateChips,
  getEnvironmentStates,
} from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import {
  environmentStatesDiffer,
  getVariationValueChanges,
} from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";
import { revisionLabelText } from "@/components/Reviews/RevisionLabel";
import { useAuth } from "@/services/auth";
import {
  PercentField,
  PercentSlider,
} from "@/components/Forms/PercentSliderField";
import { useTargetingDefaults } from "@/components/Experiment/useExperimentTargetingForm";
import useHashAttributeOptions from "@/components/Experiment/useHashAttributeOptions";
import { attributeOptionLabelFormatter } from "@/components/Features/AttributeOptionTooltip";
import SelectField from "@/components/Forms/SelectField";
import Switch from "@/ui/Switch";
import { useRegisterExperimentEdit } from "./ExperimentEdits";
import useExperimentEditing from "./useExperimentEditing";
import SetupFieldRow from "./SetupFieldRow";
import styles from "./TrafficAllocationFunnel.module.scss";

export interface Props {
  phaseIndex?: number | null;
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
  editTraffic?: ((variationId?: string) => void) | null;
  editNamespace?: (() => void) | null;
  addVariation?: (() => void) | null;
  /** Opens the values editor; offered per variation while no flag exists yet. */
  addVariationValues?: (() => void) | null;
  setEditVariationIndex?: (index: number) => void;
  /** The sole linked Feature Flag, when the cards can show its values. */
  servedValueFeature?: LinkedFeatureInfo | null;
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
  set: (value: ExperimentTargetingData | null) => void;
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
}: {
  title: string;
  inlineSummary?: ReactNode;
  onEdit?: (() => void) | null;
  children?: ReactNode;
  disabled?: boolean;
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
        </Flex>
        {onEdit && !disabled ? (
          <IconButton
            variant="ghost"
            color="violet"
            radius="medium"
            onClick={() => onEdit()}
            size="1"
            aria-label={`Edit ${title}`}
          >
            <PiPencilSimple size="14" />
          </IconButton>
        ) : null}
      </Flex>
      {children ? <Box mt="3">{children}</Box> : null}
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
      {/* Matches the variation grid, so the arrows wrap with the cards. */}
      <Grid
        columns={VARIATION_GRID_COLUMNS}
        gap="4"
        justify="center"
        style={{ maxWidth: variationGridMaxWidth(cols), margin: "0 auto" }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <Flex
            key={i}
            direction="column"
            align="center"
            className={styles.cell}
          >
            {i > 0 ? (
              <Box className={clsx(styles.busSegment, styles.busSegmentLeft)} />
            ) : null}
            {i < cols - 1 ? (
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
  editTraffic,
  editNamespace,
  addVariation,
  addVariationValues,
  setEditVariationIndex,
  servedValueFeature,
  canEditExperiment = false,
  safeToEdit = false,
  mutate,
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
    targetingDraft?.set({ ...(staged ?? targetingDefaults), ...patch });

  useRegisterExperimentEdit("targeting", !!staged, {
    save: async () => {
      await apiCall(`/experiment/${experiment.id}/targeting`, {
        method: "POST",
        body: JSON.stringify(staged),
      });
      targetingDraft?.set(null);
      mutate?.();
    },
    discard: () => targetingDraft?.set(null),
  });

  // The experiment-level half of the targeting, staged the same way.
  const hashAttribute =
    staged?.hashAttribute ?? experiment.hashAttribute ?? "id";
  const fallbackAttribute =
    staged?.fallbackAttribute ?? experiment.fallbackAttribute ?? "";
  const disableStickyBucketing =
    staged?.disableStickyBucketing ??
    experiment.disableStickyBucketing ??
    false;

  const storedPhase =
    experiment.phases?.[phaseIndex ?? experiment.phases.length - 1];
  const phase = staged
    ? {
        ...storedPhase,
        coverage: staged.coverage,
        condition: staged.condition,
        savedGroups: staged.savedGroups,
        prerequisites: staged.prerequisites,
      }
    : storedPhase;
  const hasNamespace = phase?.namespace && phase.namespace.enabled;

  const { coverage: namespaceCoverage, name: namespaceName } =
    getNamespaceDisplayData(phase?.namespace, namespaces);

  const isBandit = experiment.type === "multi-armed-bandit";
  const allEnvironments = useEnvironments();
  const permissionsUtil = usePermissionsUtil();

  // Each readout asks about itself.
  const liveRule = servedValueFeature?.liveHasMatchingRule
    ? servedValueFeature
    : undefined;
  const pendingDraft = servedValueFeature?.pendingDraft;
  const draftValueIds = useMemo(() => {
    if (!servedValueFeature || !pendingDraft) return null;
    return new Set(
      getVariationValueChanges(
        servedValueFeature,
        (pendingDraft.values ?? []).map((v) => v.variationId),
      )
        .filter((c) => c.unpublished)
        .map((c) => c.variationId),
    );
  }, [servedValueFeature, pendingDraft]);
  const environmentsDiffer = servedValueFeature
    ? environmentStatesDiffer(servedValueFeature)
    : false;

  // The toggle offers a draft only when something it shows actually moved.
  const hasDraftChanges =
    !!draftValueIds && (draftValueIds.size > 0 || environmentsDiffer);
  const [showDraftValues, setShowDraftValues] = useState(true);
  const preferDraft = hasDraftChanges && showDraftValues;

  // Mirror the server's publish authority on eject.
  const managedFeature =
    servedValueFeature &&
    isManagedByExperiment(servedValueFeature.feature, experiment.id)
      ? servedValueFeature.feature
      : null;
  // Re-scoping environments stages a draft without re-bucketing.
  const canEditEnvironments =
    !!servedValueFeature &&
    canEditExperiment &&
    permissionsUtil.canEditFeatureDrafts(servedValueFeature.feature);
  const [editEnvironments, setEditEnvironments] = useState(false);
  // Each side reads its own fields.
  const servedValueSource = preferDraft
    ? servedValueFeature?.pendingDraft
    : liveRule && {
        values: liveRule.liveValues,
        sparse: liveRule.liveSparse,
      };
  // Against the draft's type and default; live keeps the old type until publish.
  const servedValueDisplayFeature = useMemo(() => {
    const feature = servedValueFeature?.feature;
    if (!feature) return undefined;
    const draft = servedValueFeature?.pendingDraft;
    if (!preferDraft || !draft) return feature;
    return {
      ...feature,
      valueType: draft.valueType,
      defaultValue: draft.defaultValue,
    };
  }, [servedValueFeature, preferDraft]);

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
      name: revisionLabelText(draft.version, draft.title),
      note: others
        ? `${others} other unpublished draft${others > 1 ? "s" : ""} affect this value`
        : undefined,
    };
  })();
  const environmentStates = getEnvironmentStates(
    envStateSource || { environmentStates: {} },
    {
      // A draft experiment publishes its flag when it starts.
      future:
        experiment.status !== "running"
          ? "started"
          : environmentsAreDraft
            ? "published"
            : false,
    },
  );

  // A subset of environments is a restriction even without attribute targeting.
  const allowedEnvironments = filterEnvironmentsByExperiment(
    allEnvironments,
    experiment,
  );
  const ruleEnvironments = new Set(
    environmentStates.filter((e) => e.state !== "missing").map((e) => e.env),
  );
  const reachesAllEnvironments =
    !servedValueFeature ||
    allowedEnvironments.every((e) => ruleEnvironments.has(e.id));
  const isHoldout = experiment.type === "holdout";
  const isRunning = experiment.status === "running";
  const canAddNamespace =
    !isHoldout &&
    !!editNamespace &&
    safeToEdit &&
    !hasNamespace &&
    !!namespaces?.length;
  const hasMenuActions = canAddNamespace;

  const hasConfiguredTargeting = hasTargetingConfigured(phase);
  const targetsEveryone = !hasConfiguredTargeting && reachesAllEnvironments;
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

  return (
    <Frame style={{ backgroundColor: "var(--gray-a2)", border: "none" }}>
      {editEnvironments && servedValueFeature && (
        <EditExperimentEnvironmentsModal
          experiment={experiment}
          info={servedValueFeature}
          close={() => setEditEnvironments(false)}
          mutate={() => mutate?.()}
        />
      )}
      <Flex justify="end" align="center" mb="4">
        <Flex align="center" gap="3">
          {servedValueFeature && !hasDraftChanges ? (
            <Text size="sm" color="text-mid">
              Live values
            </Text>
          ) : servedValueFeature ? (
            <SegmentedControl.Root
              size="2"
              value={preferDraft ? "draft" : "live"}
              onValueChange={(v) => setShowDraftValues(v === "draft")}
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
          ) : null}
          {hasMenuActions && (
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="2"
                  highContrast
                  style={{ margin: 0 }}
                  aria-label="Traffic allocation actions"
                >
                  <BsThreeDotsVertical size={16} />
                </IconButton>
              }
              menuPlacement="end"
              variant="soft"
            >
              {canAddNamespace && (
                <DropdownMenuItem onClick={() => editNamespace?.()}>
                  Add namespace
                </DropdownMenuItem>
              )}
            </DropdownMenu>
          )}
        </Flex>
      </Flex>

      <Flex direction="column">
        <Flex align="center" direction="column">
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

          {environmentStates.length > 0 ? (
            <Flex align="center" justify="center" gap="2" wrap="wrap" mb="3">
              {environmentsAreDraft && (
                <UnpublishedDot
                  tooltip={
                    draftDetail.name
                      ? `Unpublished targeting in ${draftDetail.name}`
                      : "Unpublished draft targeting"
                  }
                  note={draftDetail.note}
                />
              )}
              <Text color="text-high" weight="semibold">
                Environments:
              </Text>
              <EnvironmentStateChips states={environmentStates} />
              {canEditEnvironments ? (
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

          <FunnelCard
            title="Targeting"
            onEdit={editTargeting}
            disabled={!safeToEdit}
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
              disableStickyBucketing={disableStickyBucketing}
              editInline={editInline}
              stagePatch={stagePatch}
            />
          </FunnelCard>

          <FunnelConnector />

          <FunnelCard
            title="Traffic"
            onEdit={editTraffic}
            disabled={!safeToEdit}
          >
            {!isHoldout ? (
              <Box mb="1">
                <SetupFieldRow
                  label="Included %"
                  content={editInline ? "control" : "text"}
                  tooltip="The share of everyone who matches the targeting above that this experiment runs on."
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
                <Box mt="3">
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
                  <Text size="sm" color="text-low">
                    Split
                  </Text>
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
                    coverage={1}
                    stackLeft
                    type="string"
                    values={phaseVariations.map((v, i) => ({
                      value: v.key,
                      weight: phase?.variationWeights?.[i] ?? 0,
                      name: v.name,
                    }))}
                  />
                </Box>
              </Box>
            )}

            <VariationsTable
              experiment={experiment}
              canEditExperiment={canEditExperiment}
              mutate={mutate}
              noMargin
              centered
              showSplit={false}
              onEditMetadata={
                canEditExperiment && setEditVariationIndex
                  ? (index) => setEditVariationIndex(index)
                  : undefined
              }
              // Names and descriptions save at any status; values wherever there is a flag.
              onEditTraffic={
                canEditExperiment && editTraffic ? editTraffic : undefined
              }
              onAddVariation={
                canEditExperiment && !isRunning && addVariation
                  ? addVariation
                  : undefined
              }
              onAddValue={
                addVariationValues &&
                !servedValueFeature &&
                getImplementationType(experiment) === "values"
                  ? addVariationValues
                  : undefined
              }
              servedValues={servedValueSource?.values}
              servedValueFeature={
                servedValueSource ? servedValueDisplayFeature : undefined
              }
              servedValueSparse={servedValueSource?.sparse}
              servedValueIsDraft={preferDraft}
              servedValueDraftIds={draftValueIds}
              servedValueDraftName={draftDetail.name}
              servedValueDraftNote={draftDetail.note}
            />
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
  disableStickyBucketing,
  editInline,
  stagePatch,
}: {
  experiment: ExperimentInterfaceStringDates;
  hashAttribute: string;
  fallbackAttribute: string;
  disableStickyBucketing: boolean;
  editInline: boolean;
  stagePatch: (patch: Partial<ExperimentTargetingData>) => void;
}) {
  const isHoldout = experiment.type === "holdout";
  const { useStickyBucketing } = useOrgSettings();
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

  return (
    <>
      <SetupFieldRow
        label={`Assignment attribute${fallbackAttribute ? "s" : ""}`}
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
            onChange={(v) => stagePatch({ hashAttribute: v })}
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
      {!isHoldout && useStickyBucketing ? (
        <SetupFieldRow
          label="Sticky bucketing"
          content="text"
          tooltip="Keeps users in their assigned variation even when experiment traffic, targeting, or rollout settings change."
        >
          {editInline ? (
            <Switch
              value={!disableStickyBucketing}
              onChange={(on) => stagePatch({ disableStickyBucketing: !on })}
              label={disableStickyBucketing ? "Disabled" : "Enabled"}
            />
          ) : (
            <Text color="text-mid">
              {disableStickyBucketing ? "Disabled" : "Enabled"}
            </Text>
          )}
        </SetupFieldRow>
      ) : null}
    </>
  );
}
