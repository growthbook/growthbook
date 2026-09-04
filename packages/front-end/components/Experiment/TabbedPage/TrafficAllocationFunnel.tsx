import { ReactNode, useMemo, useState } from "react";
import clsx from "clsx";
import {
  ExperimentInterfaceStringDates,
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
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { PiCaretDownBold, PiPencilSimpleFill } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import { getHoldoutTrafficBreakdown } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { getNamespaceDisplayData } from "@/components/Features/NamespaceSelectorUtils";
import VariationsTable, {
  getVariationGridColumns,
} from "@/components/Experiment/VariationsTable";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import UnpublishedDot from "@/components/Experiment/UnpublishedDot";
import EditExperimentEnvironmentsModal from "@/components/Experiment/EditExperimentEnvironmentsModal";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import SplitButton from "@/ui/SplitButton";
import Button from "@/ui/Button";
import {
  EnvironmentStateChips,
  getEnvironmentStates,
} from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import {
  environmentStatesDiffer,
  getVariationValueChanges,
} from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";
import { revisionLabelText } from "@/components/Reviews/RevisionLabel";
import styles from "./TrafficAllocationFunnel.module.scss";

export interface Props {
  phaseIndex?: number | null;
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
  editTraffic?: ((variationId?: string) => void) | null;
  editNamespace?: (() => void) | null;
  addVariation?: (() => void) | null;
  // Offered only while the experiment can still adopt a managed flag.
  setEditVariationIndex?: (index: number) => void;
  /** Opens the values editor; offered per variation while no flag exists yet. */
  addVariationValues?: (() => void) | null;
  /** The sole linked Feature Flag, when the cards can show its values. */
  servedValueFeature?: LinkedFeatureInfo | null;
  // Names the flag beneath the split, when no Linked Changes panel does.
  /** Offered when the experiment has no implementation yet; adopts a managed flag. */
  canEditExperiment?: boolean;
  safeToEdit: boolean;
  mutate?: () => void;
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
      py="4"
      style={{ paddingLeft: 20, paddingRight: 20 }}
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
            radius="full"
            onClick={() => onEdit()}
            size="2"
            aria-label={`Edit ${title}`}
          >
            <PiPencilSimpleFill size="16" />
          </IconButton>
        ) : null}
      </Flex>
      {children ? <Box mt="3">{children}</Box> : null}
    </Box>
  );
}

function FunnelConnector({ label }: { label?: ReactNode }) {
  return (
    <Flex direction="column" align="center" justify="center" pb="2">
      <Box className={styles.connectorLine} height="15px" />
      <Box mt="-3" className={styles.caret}>
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

  // Match the VariationsTable grid so the arrows align with the columns.
  const columns = getVariationGridColumns(cols);

  // Match the grid's per-breakpoint column count: cell 0 always, cell 1 from xs, cell 2 from sm.
  const cellDisplay = (i: number) =>
    i === 0
      ? undefined
      : i === 1
        ? ({ initial: "none", xs: "flex" } as const)
        : ({ initial: "none", sm: "flex" } as const);

  // Draw the right bus segment only when the right neighbor is visible at this breakpoint.
  const rightSegDisplay = (i: number) =>
    i === 0
      ? ({ initial: "none", xs: "block" } as const)
      : ({ initial: "none", sm: "block" } as const);

  return (
    <Box pb="2">
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
      <Grid columns={columns} gap="4" justify="center">
        {Array.from({ length: cols }).map((_, i) => (
          <Flex
            key={i}
            direction="column"
            align="center"
            display={cellDisplay(i)}
            className={styles.cell}
          >
            {i > 0 ? (
              <Box className={clsx(styles.busSegment, styles.busSegmentLeft)} />
            ) : null}
            {i < cols - 1 ? (
              <Box
                display={rightSegDisplay(i)}
                className={clsx(styles.busSegment, styles.busSegmentRight)}
              />
            ) : null}
            <Box className={styles.connectorLine} height="22px" />
            <Box mt="-3" className={styles.caret}>
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
  setEditVariationIndex,
  addVariationValues,
  servedValueFeature,
  canEditExperiment = false,
  safeToEdit = false,
  mutate,
}: Props) {
  const { namespaces } = useOrgSettings();

  const phase = experiment.phases?.[phaseIndex ?? experiment.phases.length - 1];
  const hasNamespace = phase?.namespace && phase.namespace.enabled;

  const { coverage: namespaceCoverage, name: namespaceName } =
    getNamespaceDisplayData(phase?.namespace, namespaces);

  const isBandit = experiment.type === "multi-armed-bandit";
  const allEnvironments = useEnvironments();
  const permissionsUtil = usePermissionsUtil();

  // A draft differs from live across its whole rule, so each readout asks about
  // itself rather than trusting that a draft exists.
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

  // The server takes publish authority on eject; mirror it or the menu 403s.
  const managedFeature =
    servedValueFeature &&
    isManagedByExperiment(servedValueFeature.feature, experiment.id)
      ? servedValueFeature.feature
      : null;
  // Not gated on `safeToEdit`: that guards traffic biasing, and re-scoping
  // environments stages to a draft without re-bucketing anyone.
  const canEditEnvironments =
    !!servedValueFeature &&
    canEditExperiment &&
    permissionsUtil.canEditFeatureDrafts(servedValueFeature.feature);
  const [editEnvironments, setEditEnvironments] = useState(false);
  // Each side reads its own fields: `info.values` and `info.environmentStates`
  // follow whichever revision resolved, so falling back shows draft under Live.
  const servedValueSource = preferDraft
    ? servedValueFeature?.pendingDraft
    : liveRule && {
        values: liveRule.liveValues,
        sparse: liveRule.liveSparse,
      };
  // Rendered against the draft's own type and default: a draft can re-type the
  // flag, and the live feature still carries the old type until it publishes.
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

  // A managed flag has exactly one draft, so naming it there is noise. The
  // count says how many others this readout is not showing.
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

  // A rule scoped to a subset of the allowed environments is a restriction,
  // even with no attribute targeting. Project-scoped ones are already excluded.
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
  const numVariations = getLatestPhaseVariations(experiment).length;

  return (
    <Frame>
      {editEnvironments && servedValueFeature && (
        <EditExperimentEnvironmentsModal
          experiment={experiment}
          info={servedValueFeature}
          close={() => setEditEnvironments(false)}
          mutate={() => mutate?.()}
        />
      )}
      <Flex justify="between" align="center" mb="4">
        <Heading color="text-high" as="h4" size="sm" mb="0">
          Traffic Allocation
        </Heading>
        <Flex align="center" gap="3">
          {servedValueFeature ? (
            <SplitButton variant="outline" className="roomy-segments">
              <Button
                size="sm"
                variant={preferDraft ? "solid" : "outline"}
                disabled={!hasDraftChanges}
                icon={hasDraftChanges ? <UnpublishedDot /> : undefined}
                onClick={() => setShowDraftValues(true)}
              >
                Unpublished
              </Button>
              <Button
                size="sm"
                variant={preferDraft ? "outline" : "solid"}
                onClick={() => setShowDraftValues(false)}
              >
                Live values
              </Button>
            </SplitButton>
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
            // Above the card, not inside it: where the experiment runs frames
            // everything below rather than being one more targeting rule.
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
                  radius="full"
                  size="2"
                  onClick={() => setEditEnvironments(true)}
                  aria-label="Edit environments"
                >
                  <PiPencilSimpleFill size="16" />
                </IconButton>
              ) : null}
            </Flex>
          ) : null}

          <FunnelCard
            title="Targeting"
            onEdit={editTargeting}
            inlineSummary={
              targetsEveryone ? (
                <Text size="lg">
                  <em>Everyone</em>
                </Text>
              ) : undefined
            }
            disabled={!safeToEdit}
          >
            <Flex direction="column" gap="4">
              <AssignmentAttribute experiment={experiment} />
              {hasConfiguredTargeting ? (
                <>
                  {hasCondition ? (
                    <div>
                      <Text as="div" color="text-high" weight="semibold" mb="2">
                        Attribute Targeting
                      </Text>
                      <ConditionDisplay condition={phase.condition} />
                    </div>
                  ) : null}
                  {hasSavedGroups ? (
                    <div>
                      <Text as="div" color="text-high" weight="semibold" mb="2">
                        Saved Group Targeting
                      </Text>
                      <SavedGroupTargetingDisplay
                        savedGroups={phase.savedGroups}
                      />
                    </div>
                  ) : null}
                  {hasPrerequisites ? (
                    <div>
                      <Text as="div" color="text-high" weight="semibold" mb="2">
                        Prerequisite Targeting
                      </Text>
                      <ConditionDisplay prerequisites={phase.prerequisites} />
                    </div>
                  ) : null}
                </>
              ) : null}
            </Flex>
          </FunnelCard>

          <FunnelConnector />

          <FunnelCard
            title="Traffic"
            onEdit={editTraffic}
            disabled={!safeToEdit}
          >
            {!isHoldout ? (
              <Box mb="1">
                <Text weight="semibold" color="text-high">
                  Included in this experiment:{" "}
                  <Text color="text-high" weight="regular">
                    {Math.round(phase.coverage * 100)}%
                  </Text>
                </Text>
                <Box
                  mt="3"
                  overflow="hidden"
                  style={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: "var(--gray-a4)",
                  }}
                >
                  <Box
                    style={{
                      width: `${Math.min(100, Math.max(0, phase.coverage * 100))}%`,
                      height: "100%",
                      backgroundColor: "var(--violet-9)",
                    }}
                  />
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
            <VariationFork
              count={numVariations}
              label={`${isBandit ? "" : "% Split"}`}
            />

            <VariationsTable
              experiment={experiment}
              canEditExperiment={canEditExperiment}
              mutate={mutate}
              noMargin
              centered
              onEditMetadata={
                canEditExperiment && setEditVariationIndex
                  ? (index) => setEditVariationIndex(index)
                  : undefined
              }
              // The variation editor always has something to save: names and
              // descriptions at any status, values wherever there is a flag.
              // A running experiment only loses traffic and ids.
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
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const isHoldout = experiment.type === "holdout";
  const { useStickyBucketing } = useOrgSettings();
  return (
    <Box>
      <Text weight="semibold" color="text-high" mr="2">
        Assignment Attribute{experiment.fallbackAttribute ? "s" : ""}:{" "}
      </Text>
      <AttributeBadge attributeId={experiment.hashAttribute || "id"} />
      {experiment.fallbackAttribute ? (
        <>
          , <AttributeBadge attributeId={experiment.fallbackAttribute} />
        </>
      ) : null}
      {!isHoldout && useStickyBucketing ? (
        <Box mt="1">
          <Text weight="semibold" color="text-high" mr="2">
            Sticky bucketing:
          </Text>
          <Text color="text-mid">
            {experiment.disableStickyBucketing ? "Disabled" : "Enabled"}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
