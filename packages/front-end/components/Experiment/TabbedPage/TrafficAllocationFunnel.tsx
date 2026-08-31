import { ReactNode, useState } from "react";
import clsx from "clsx";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import {
  getLatestPhaseVariations,
  hasAttributeCondition,
  hasTargetingConfigured,
} from "shared/experiments";
import {
  filterEnvironmentsByExperiment,
  isManagedByExperiment,
} from "shared/util";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import {
  PiCaretDownBold,
  PiCheckCircleFill,
  PiPencilSimpleFill,
  PiPlus,
  PiXCircleFill,
} from "react-icons/pi";
import { FaRegFlag } from "react-icons/fa";
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
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import ConfirmDialog from "@/ui/ConfirmDialog";
import UnpublishedDot from "@/components/Experiment/UnpublishedDot";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import Avatar from "@/ui/Avatar";
import Tooltip from "@/ui/Tooltip";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import SplitButton from "@/ui/SplitButton";
import Button from "@/ui/Button";
import { getEnvironmentStates } from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import styles from "./TrafficAllocationFunnel.module.scss";

export interface Props {
  phaseIndex?: number | null;
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
  editTraffic?: ((variationId?: string) => void) | null;
  editNamespace?: (() => void) | null;
  addVariation?: (() => void) | null;
  // Offered only while the experiment can still adopt a managed flag.
  addVariationValues?: (() => void) | null;
  setEditVariationIndex?: (index: number) => void;
  /** The sole linked Feature Flag, when the cards can show its values. */
  servedValueFeature?: LinkedFeatureInfo | null;
  /**
   * Names the Feature Flag beneath the split. Passed only when nothing else on
   * the page does — a managed flag that is the whole implementation has no
   * Linked Changes panel to name it.
   */
  namedFeature?: FeatureInterface | null;
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
  addVariationValues,
  namedFeature,
  setEditVariationIndex,
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
  const { apiCall } = useAuth();

  // A sole linked flag can have an unpublished draft alongside what is live.
  // The toggle picks which one the box describes; without a draft there is
  // nothing to switch to, so the widget shows but its draft side is dead.
  const hasPendingDraft = !!servedValueFeature?.pendingDraft;
  // Land on the unpublished view; `preferDraft` falls back to live on its own
  // when there is no draft to show.
  const [showDraftValues, setShowDraftValues] = useState(true);
  const preferDraft = hasPendingDraft && showDraftValues;

  // Ejecting hands control of what the experiment serves back to the flag, so
  // the server takes publish authority — mirror it or the menu offers a 403.
  // Same check the Linked Changes card used before this became its only home.
  const managedFeature =
    servedValueFeature &&
    isManagedByExperiment(servedValueFeature.feature, experiment.id)
      ? servedValueFeature.feature
      : null;
  const canEject =
    !!managedFeature &&
    canEditExperiment &&
    permissionsUtil.canPublishFeature(
      managedFeature,
      getEnabledEnvironments(managedFeature, allEnvironments),
    );
  const [ejectConfirm, setEjectConfirm] = useState(false);
  const [ejecting, setEjecting] = useState(false);
  const handleEject = async () => {
    setEjecting(true);
    try {
      await apiCall(`/experiment/${experiment.id}/managed-flag/eject`, {
        method: "POST",
      });
      setEjectConfirm(false);
      mutate?.();
    } finally {
      setEjecting(false);
    }
  };

  // Same condition as the variation cards' "Serves": only a sole linked flag
  // can speak for where the experiment runs. Draft first for the same reason
  // the values are — a pending edit is what publishing will produce.
  // Each side of the toggle reads its own fields. `info.values` and
  // `info.environmentStates` follow whichever revision the feature resolved to,
  // so falling back to them would show draft data under "Live".
  const liveRule = servedValueFeature?.liveHasMatchingRule
    ? servedValueFeature
    : undefined;
  const servedValueSource = preferDraft
    ? servedValueFeature?.pendingDraft
    : liveRule && {
        values: liveRule.liveValues,
        sparse: liveRule.liveSparse,
      };
  const envStateSource = preferDraft
    ? servedValueFeature?.pendingDraft
    : liveRule && { environmentStates: liveRule.liveEnvironmentStates };
  const environmentStates = getEnvironmentStates(
    envStateSource || { environmentStates: {} },
  );
  const environmentsAreDraft =
    preferDraft && !!servedValueFeature?.pendingDraft;

  // "Everyone" has to mean everyone. A rule scoped to a subset of the
  // environments this experiment is allowed to run in is a restriction, even
  // with no attribute targeting. Project-scoped environments are already
  // excluded from what's allowed, so covering the rest still counts as all.
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
  const hasMenuActions = canAddNamespace || canEject;

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
      {ejectConfirm && (
        <ConfirmDialog
          title="Switch to manual implementation?"
          content="This Experiment keeps using the linked Feature Flag, but you'll manage and review it directly from its own page instead of from here."
          yesText="Switch to manual"
          onConfirm={handleEject}
          onCancel={() => setEjectConfirm(false)}
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
                disabled={!hasPendingDraft}
                icon={hasPendingDraft ? <UnpublishedDot /> : undefined}
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
              {canEject && (
                <DropdownMenuItem
                  disabled={ejecting}
                  onClick={() => setEjectConfirm(true)}
                >
                  Convert to unmanaged Feature Flag
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

          <FunnelCard
            title="Targeting"
            titleColor={targetsEveryone ? "text-disabled" : undefined}
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
              {environmentStates.length > 0 ? (
                <div>
                  <Flex align="center" gap="1" mb="2">
                    {environmentsAreDraft && (
                      <UnpublishedDot tooltip="Unpublished draft targeting" />
                    )}
                    <Text as="div" color="text-high" weight="semibold">
                      Environments
                    </Text>
                  </Flex>
                  <Flex gap="4" wrap="wrap">
                    {environmentStates.map(({ env, isActive, tooltip }) => (
                      <Tooltip key={env} content={tooltip}>
                        <Flex align="center" gap="1" minWidth="0">
                          <Box
                            flexShrink="0"
                            style={{
                              display: "flex",
                              color: isActive
                                ? "var(--green-11)"
                                : "var(--slate-9)",
                            }}
                          >
                            {isActive ? (
                              <PiCheckCircleFill />
                            ) : (
                              <PiXCircleFill />
                            )}
                          </Box>
                          <Text weight="medium">{env}</Text>
                        </Flex>
                      </Tooltip>
                    ))}
                  </Flex>
                </div>
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
              servedValues={servedValueSource?.values}
              servedValueFeature={
                servedValueSource ? servedValueFeature?.feature : undefined
              }
              servedValueSparse={servedValueSource?.sparse}
              servedValueIsDraft={preferDraft}
            />
            {namedFeature && (
              <Box mt="5">
                <Text as="div" color="text-high" weight="semibold" mb="2">
                  Values implemented via managed Feature Flag
                </Text>
                <Flex align="center" gap="3">
                  <Avatar
                    radius="small"
                    color="indigo"
                    size="sm"
                    variant="soft"
                  >
                    <FaRegFlag />
                  </Avatar>
                  <Text weight="medium">{namedFeature.id}</Text>
                </Flex>
              </Box>
            )}
            {addVariationValues && (
              // One offer for the whole set: the values are authored together
              // in the traffic modal, not per variation.
              <Flex justify="center" mt="3">
                <Link onClick={addVariationValues} weight="medium">
                  <PiPlus className="mr-1" />
                  Add variation values
                </Link>
              </Flex>
            )}
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
