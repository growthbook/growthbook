import { ReactNode } from "react";
import clsx from "clsx";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import {
  getLatestPhaseVariations,
  hasAttributeCondition,
  hasTargetingConfigured,
} from "shared/experiments";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { PiCaretDownBold, PiPencilSimpleFill, PiPlus } from "react-icons/pi";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import {
  getHoldoutTrafficBreakdown,
  trafficSplitPercentages,
} from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { getNamespaceDisplayData } from "@/components/Features/NamespaceSelectorUtils";
import VariationsTable, {
  getVariationGridColumns,
  type VariationRow,
} from "@/components/Experiment/VariationsTable";
import useOrgSettings from "@/hooks/useOrgSettings";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import styles from "./TrafficAllocationFunnel.module.scss";
import TargetingConditions from "./SetupPage/TargetingConditions";
import setupFunnelStyles from "./SetupPage/SetupFunnel.module.scss";
import {
  CoverageRow,
  NamespaceAnnotation,
  NamespaceHoverGroup,
  SetupConnector,
  SetupFunnelCard,
  SetupFunnelRow,
  SetupSplit,
  SplitPreviewButton,
} from "./SetupPage/SetupFunnel";
import { draftVariationWeights } from "./SetupPage/setupDraft";

export interface Props {
  phaseIndex?: number | null;
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
  editTraffic?: ((variationId?: string) => void) | null;
  editNamespace?: (() => void) | null;
  addVariation?: (() => void) | null;
  setEditVariationIndex?: (index: number) => void;
  canEditExperiment?: boolean;
  safeToEdit: boolean;
  mutate?: () => void;
  // Render without the Frame and "Traffic Allocation" heading, for callers
  // that supply their own container, in the Setup page's design (see
  // SetupPage/SetupFunnel.tsx). Optional and additive: existing callers pass
  // nothing and render exactly as before.
  bare?: boolean;
  // Content above the Targeting card (e.g. the Values type's Environments
  // row). Optional and additive, like bare.
  header?: ReactNode;
  // A row below the variation cards, one cell per variation, passed straight
  // through to VariationsTable. Optional and additive, like bare.
  variationRow?: VariationRow;
  // Bare only: Population's Included % edited in place, against the
  // caller's draft. Without onCoverageChange it's read-only.
  coverage?: number;
  onCoverageChange?: (coverage: number) => void;
  // Bare only: the variations' order from the caller's draft (variation
  // ids), shown before it's saved, and drag-to-reorder writing to it (set
  // in review). Without onReorderVariations the cards can't be dragged.
  variationOrder?: string[];
  onReorderVariations?: (order: string[]) => void;
  // Bare only: variations added in the caller's draft and not saved yet,
  // shown after the saved ones (their ids end variationOrder).
  addedVariations?: Variation[];
  // Bare only: names and descriptions from the caller's draft, by variation
  // id, shown on the cards before they're saved.
  variationEdits?: Record<string, { name: string; description: string }>;
  // Bare only: a card's pencil opens that variation's own modal (set in
  // review), for unsaved variations too.
  onEditVariation?: (variationId: string) => void;
  // Bare only: the split as the caller's draft has it, aligned with
  // variationOrder, and the split pills opening the Edit Split % modal (set
  // in review). With onEditSplit, the pills edit only through it; it's
  // told which variation's pill was clicked, so the modal can start there.
  draftWeights?: number[];
  onEditSplit?: (variationId?: string) => void;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function FunnelCard({
  title,
  titleColor = "text-high",
  inlineSummary,
  onEdit,
  children,
  disabled = false,
}: {
  title: string;
  titleColor?: "text-disabled" | "text-high";
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
          <Text size="lg" weight="medium" color={titleColor}>
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
            onClick={() => onEdit()}
            size="1"
            aria-label={`Edit ${title}`}
          >
            <PiPencilSimpleFill size="15" />
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
  canEditExperiment = false,
  safeToEdit = false,
  mutate,
  bare = false,
  header,
  variationRow,
  coverage,
  onCoverageChange,
  variationOrder,
  onReorderVariations,
  addedVariations = [],
  variationEdits,
  onEditVariation,
  draftWeights,
  onEditSplit,
}: Props) {
  const { namespaces } = useOrgSettings();

  const phase = experiment.phases?.[phaseIndex ?? experiment.phases.length - 1];
  const hasNamespace = phase?.namespace && phase.namespace.enabled;

  const {
    coverage: namespaceCoverage,
    name: namespaceName,
    ranges: namespaceRanges,
  } = getNamespaceDisplayData(phase?.namespace, namespaces);

  const isBandit = experiment.type === "multi-armed-bandit";
  const isHoldout = experiment.type === "holdout";
  const isRunning = experiment.status === "running";

  const hasConfiguredTargeting = hasTargetingConfigured(phase);
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

  const addNamespaceLink =
    !isHoldout &&
    editNamespace &&
    safeToEdit &&
    !isRunning &&
    !hasNamespace &&
    !!namespaces?.length ? (
      <Link onClick={editNamespace}>
        <Flex align="center" gap="1">
          <PiPlus size="15" />
          <Text weight="semibold">Add Namespace</Text>
        </Flex>
      </Link>
    ) : null;

  if (bare) {
    // The Setup page's version, per the design (Experiment Page.dc.html,
    // Empty and Partial frames): small uppercase cards joined by arrows, the
    // split as pills over a coloured bar, and compact variation cards.
    const phaseVariations = getLatestPhaseVariations(experiment);
    // The saved variations, then any unsaved ones from the draft.
    const savedVariations = [
      ...phaseVariations,
      ...addedVariations.map((v, i) => ({
        ...v,
        index: phaseVariations.length + i,
      })),
    ];
    const savedWeights = phase.variationWeights ?? [];
    // In the draft's order when there is one (an unsaved reorder): each
    // variation's weight moves with it, and the index is the position.
    // Every id known (saved or added); fewer than saved once one's deleted.
    const order =
      variationOrder &&
      variationOrder.every((id) => savedVariations.some((v) => v.id === id))
        ? variationOrder
        : null;
    const variations = order
      ? order.map((id, i) => ({
          ...(savedVariations.find(
            (v) => v.id === id,
          ) as (typeof savedVariations)[number]),
          index: i,
        }))
      : savedVariations;
    // As they'll be saved (the modal's rule; see draftVariationWeights).
    const weights = draftWeights?.length
      ? draftWeights
      : order
        ? draftVariationWeights(
            phaseVariations.map((v) => v.id),
            savedWeights,
            order,
          )
        : savedWeights;
    const percentages =
      weights.length && weights.every((w) => w !== undefined)
        ? trafficSplitPercentages(weights)
        : null;
    // Not while running: the split is locked once the experiment is live,
    // so no pencil on the split (set in review). Changing it goes through
    // Actions → Make Changes.
    const canEditSplit =
      canEditExperiment && safeToEdit && editTraffic && !isRunning;
    const attributes = [
      experiment.hashAttribute || "id",
      experiment.fallbackAttribute,
    ].filter(Boolean);
    return (
      // The Setup page's field hover for everything in the diagram (see
      // SetupFunnel.module.scss's .funnel).
      <Box className={setupFunnelStyles.funnel}>
        {/* 44px each side: the add-variation button's 32px column and its
          12px gap on the right, mirrored on the left so everything stays
          centred, as in the design. */}
        <Box style={{ paddingLeft: 44, paddingRight: 44 }}>
          <Flex align="center" direction="column">
            {header}
            {/* Targeting, the arrow and Population as one group: hovering it
              reveals "+ Namespace" on the arrow (see NamespaceHoverGroup). */}
            <NamespaceHoverGroup>
              {/* No targeting edit while running (set in review): the card's
                pencil and the conditions popover's are both hidden. Changing
                it goes through Actions → Make Changes. */}
              <SetupFunnelCard
                title="Targeting"
                onEdit={safeToEdit && !isRunning ? editTargeting : null}
              >
                <SetupFunnelRow label="Audience">
                  {hasConfiguredTargeting ? "Custom" : "Everyone"}
                </SetupFunnelRow>
                <SetupFunnelRow
                  label={
                    attributes.length > 1
                      ? "Assignment attributes"
                      : "Assignment attribute"
                  }
                  mono
                >
                  {attributes.join(", ")}
                </SetupFunnelRow>
                {/* The conditions as one summary row with a popover, not
                  rendered inline (set in review). Absent with no
                  conditions (Audience: Everyone). */}
                <TargetingConditions
                  condition={hasCondition ? phase.condition : undefined}
                  savedGroups={hasSavedGroups ? phase.savedGroups : []}
                  prerequisites={
                    hasPrerequisites ? (phase.prerequisites ?? []) : []
                  }
                  project={experiment.project}
                  onEdit={safeToEdit && !isRunning ? editTargeting : null}
                />
                {!isHoldout && experiment.disableStickyBucketing ? (
                  <SetupFunnelRow label="Sticky bucketing">
                    Disabled
                  </SetupFunnelRow>
                ) : null}
              </SetupFunnelCard>
              {/* The namespace sits on this arrow: "+ Namespace" on hover when
              there's none (replacing the old top-right "Add Namespace"),
              or its name and range when set (replacing the Namespace card).
              See NamespaceAnnotation. */}
              <SetupConnector
                annotation={
                  isHoldout ? null : (
                    <NamespaceAnnotation
                      name={hasNamespace ? namespaceName : ""}
                      ranges={namespaceRanges}
                      // Not while running (set in review): no "+ Namespace",
                      // and an existing namespace can't be changed here.
                      onEdit={
                        editNamespace &&
                        safeToEdit &&
                        !isRunning &&
                        (hasNamespace || !!namespaces?.length)
                          ? editNamespace
                          : null
                      }
                    />
                  )
                }
              />
              <SetupFunnelCard
                title="Population"
                // The split-preview button in the pencil's place: the card's
                // one way into the traffic modal (set in review). A holdout
                // keeps the pencil.
                // Not while running either: the traffic modal edits the
                // split (set in review).
                action={
                  !isHoldout && safeToEdit && editTraffic && !isRunning ? (
                    <SplitPreviewButton onClick={() => editTraffic()} />
                  ) : undefined
                }
                onEdit={
                  isHoldout && safeToEdit && editTraffic
                    ? () => editTraffic()
                    : null
                }
              >
                {!isHoldout && onCoverageChange ? (
                  <CoverageRow
                    coverage={coverage ?? phase.coverage}
                    onChange={onCoverageChange}
                  />
                ) : !isHoldout ? (
                  // Read-only (not a draft, or no permission); the
                  // split-preview button still opens the traffic modal where
                  // allowed. In Inter, like the Targeting card's values (set
                  // in review; it was the code font).
                  <SetupFunnelRow label="Included %">
                    {Math.round((coverage ?? phase.coverage) * 100)}
                  </SetupFunnelRow>
                ) : (
                  <>
                    <SetupFunnelRow label="In holdout">
                      {holdoutTraffic.inHoldoutPercent}%
                    </SetupFunnelRow>
                    <SetupFunnelRow label="Not in holdout (for measurement)">
                      {holdoutTraffic.forMeasurementPercent}%
                    </SetupFunnelRow>
                    <SetupFunnelRow label="Not in holdout (not for measurement)">
                      {holdoutTraffic.notForMeasurementPercent}%
                    </SetupFunnelRow>
                  </>
                )}
              </SetupFunnelCard>
            </NamespaceHoverGroup>
          </Flex>
          {!isHoldout ? (
            <>
              <VariationsTable
                // Drawn inside the table's row, so with more than three
                // variations it scrolls with the cards (set in review).
                splitRow={
                  <SetupSplit
                    variations={variations}
                    percentages={percentages}
                    // On a draft, the pills open the Edit Split % modal;
                    // otherwise (running, read-only) they don't edit.
                    onEditSplit={
                      onEditSplit
                        ? (variationId) => onEditSplit(variationId)
                        : canEditSplit && !bare
                          ? editTraffic
                          : null
                    }
                    isBandit={isBandit}
                  />
                }
                experiment={experiment}
                canEditExperiment={canEditExperiment}
                mutate={mutate}
                noMargin
                layout="setup"
                // Drag a card's colour band to reorder, before the
                // experiment starts only (set in review): the index is the
                // variation_id in the event data, so reordering once it's
                // running would re-attribute history. Afterwards there's no
                // handle at all, not a disabled one.
                variationOrder={order ?? undefined}
                extraVariations={addedVariations}
                variationEdits={variationEdits}
                onEditVariation={onEditVariation}
                onReorder={
                  canEditExperiment &&
                  safeToEdit &&
                  experiment.status === "draft" &&
                  onReorderVariations
                    ? onReorderVariations
                    : undefined
                }
                variationRow={variationRow}
                onEditMetadata={
                  canEditExperiment && setEditVariationIndex
                    ? (index) => setEditVariationIndex(index)
                    : undefined
                }
                onEditTraffic={
                  canEditExperiment && editTraffic ? editTraffic : undefined
                }
                onAddVariation={
                  canEditExperiment && !isRunning && addVariation
                    ? addVariation
                    : undefined
                }
              />
            </>
          ) : null}
        </Box>
      </Box>
    );
  }

  return (
    <Frame>
      <Flex justify="between" align="center" mb="4">
        <Heading color="text-high" as="h4" size="sm" mb="0">
          Traffic Allocation
        </Heading>
        {addNamespaceLink}
      </Flex>

      <Flex direction="column">
        <Flex align="center" direction="column">
          {header}
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
            titleColor={!hasConfiguredTargeting ? "text-disabled" : undefined}
            onEdit={editTargeting}
            inlineSummary={
              hasConfiguredTargeting ? undefined : (
                <Text size="lg">
                  <em>Everyone</em>
                </Text>
              )
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
              variationRow={variationRow}
              onEditMetadata={
                canEditExperiment && setEditVariationIndex
                  ? (index) => setEditVariationIndex(index)
                  : undefined
              }
              onEditTraffic={
                canEditExperiment && editTraffic ? editTraffic : undefined
              }
              onAddVariation={
                canEditExperiment && !isRunning && addVariation
                  ? addVariation
                  : undefined
              }
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
