import { ReactNode } from "react";
import clsx from "clsx";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  getLatestPhaseVariations,
  hasAttributeCondition,
  hasTargetingConfigured,
} from "shared/experiments";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { PiCaretDownBold, PiPencilSimpleFill, PiPlus } from "react-icons/pi";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import { getHoldoutTrafficBreakdown } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { getNamespaceDisplayData } from "@/components/Features/NamespaceSelectorUtils";
import VariationsTable, {
  getVariationGridColumns,
} from "@/components/Experiment/VariationsTable";
import useOrgSettings from "@/hooks/useOrgSettings";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import styles from "./TrafficAllocationFunnel.module.scss";

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
          <Text size="large" weight="medium" color={titleColor}>
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
        <Text size="small" color="text-low" my="1">
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
          <Text size="small" color="text-low">
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
}: Props) {
  const { namespaces } = useOrgSettings();

  const phase = experiment.phases?.[phaseIndex ?? experiment.phases.length - 1];
  const hasNamespace = phase?.namespace && phase.namespace.enabled;

  const { coverage: namespaceCoverage, name: namespaceName } =
    getNamespaceDisplayData(phase?.namespace, namespaces);

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

  return (
    <Frame>
      <Flex justify="between" align="center" mb="4">
        <Heading color="text-high" as="h4" size="small" mb="0">
          Traffic Allocation
        </Heading>
        {!isHoldout &&
          editNamespace &&
          safeToEdit &&
          !hasNamespace &&
          !!namespaces?.length && (
            <Link onClick={editNamespace}>
              <Flex align="center" gap="1">
                <PiPlus size="15" />
                <Text weight="semibold">Add Namespace</Text>
              </Flex>
            </Link>
          )}
      </Flex>

      <Flex direction="column">
        <Flex align="center" direction="column">
          {!isHoldout && hasNamespace && (
            <>
              <FunnelCard
                title="Namespace"
                onEdit={editNamespace}
                inlineSummary={
                  <Text size="large" color="text-mid">
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
                <Text size="large">
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
      {!isHoldout && experiment.disableStickyBucketing ? (
        <Box mt="1">
          <Text weight="semibold" color="text-high" mr="2">
            Sticky bucketing:
          </Text>
          <Text color="text-mid">
            <em>Disabled</em>
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
