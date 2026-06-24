import { ReactNode } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { calculateNamespaceCoverage } from "shared/util";
import { getLatestPhaseVariations } from "shared/experiments";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPencilSimple, PiPlus } from "react-icons/pi";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import { getHoldoutTrafficBreakdown } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { HashVersionTooltip } from "@/components/Experiment/HashVersionSelector";
import VariationsTable from "@/components/Experiment/VariationsTable";
import useOrgSettings from "@/hooks/useOrgSettings";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Button from "@/ui/Button";

export interface Props {
  phaseIndex?: number | null;
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
  editTraffic?: (() => void) | null;
  editNamespace?: (() => void) | null;
  setEditVariationIndex?: (index: number) => void;
  canEditExperiment?: boolean;
  mutate?: () => void;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

// A single card in the traffic-allocation funnel. `inlineSummary` renders to
// the right of the title (e.g. "Targeting  Everyone"); `children` render below
// the title for richer content (e.g. the traffic coverage bar).
function FunnelCard({
  title,
  info,
  inlineSummary,
  onEdit,
  children,
  disabled = false,
}: {
  title: string;
  info?: string;
  inlineSummary?: ReactNode;
  onEdit?: (() => void) | null;
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Box
      className="appbox"
      width="692px"
      mb="0"
      py="4"
      style={{ paddingLeft: 20, paddingRight: 20 }}
    >
      <Flex justify="between" align="center" gap="3">
        <Flex align="baseline" gap="2" wrap="wrap">
          <Text
            size="large"
            weight="medium"
            color={disabled ? "text-disabled" : "text-high"}
          >
            {title}
          </Text>
          {info ? <Tooltip body={info} /> : null}
          {inlineSummary ? (
            <Text color="text-low" ml="1">
              {inlineSummary}
            </Text>
          ) : null}
        </Flex>
        {onEdit ? (
          <IconButton
            variant="ghost"
            color="purple"
            onClick={onEdit}
            size="1"
            aria-label={`Edit ${title}`}
          >
            <PiPencilSimple size="15" />
          </IconButton>
        ) : null}
      </Flex>
      {children ? <Box mt="3">{children}</Box> : null}
    </Box>
  );
}

const CONNECTOR_COLOR = "var(--gray-a6)";

// An outlined (not filled) downward chevron arrowhead.
function ArrowHead() {
  return (
    <svg
      width="11"
      height="7"
      viewBox="0 0 11 7"
      fill="none"
      style={{ display: "block", marginTop: -1 }}
      aria-hidden="true"
    >
      <path
        d="M1 1L5.5 5.5L10 1"
        stroke={CONNECTOR_COLOR}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Vertical connector between funnel cards, with a centered label showing how
// much traffic is carried into the next stage.
function FunnelConnector({ label }: { label?: ReactNode }) {
  return (
    <Flex direction="column" align="center" py="1">
      <Box style={{ width: 1, height: 12, backgroundColor: CONNECTOR_COLOR }} />
      {label ? (
        <Text size="small" color="text-low" my="1">
          {label}
        </Text>
      ) : null}
      <Box style={{ width: 1, height: 12, backgroundColor: CONNECTOR_COLOR }} />
      <ArrowHead />
    </Flex>
  );
}

// Width of a single variation column and the gap between columns, kept in sync
// with the centered variations grid in VariationsTable so the fork arrows land
// on the center of each variation box.
const VARIATION_COL_WIDTH = 336;
const VARIATION_COL_GAP = 16; // Radix gap="4"

// Branching connector that forks from the Traffic card into one arrow per
// variation column, aligning each arrow above the center of its variation box.
// Capped at 3 columns to match the variations grid layout.
function VariationFork({ count, label }: { count: number; label?: ReactNode }) {
  const cols = Math.min(count, 3);
  return (
    <Box py="1">
      {label ? (
        <Flex justify="center" mb="1">
          <Text size="small" color="text-low">
            {label}
          </Text>
        </Flex>
      ) : null}
      {/* Stem down from the Traffic card to the horizontal bus */}
      <Flex direction="column" align="center">
        <Box
          style={{ width: 1, height: 12, backgroundColor: CONNECTOR_COLOR }}
        />
      </Flex>
      {/* Centered group mirroring the variations grid */}
      <Flex justify="center">
        <Box style={{ position: "relative", maxWidth: "100%" }}>
          {/* Horizontal bus connecting the centers of the outer columns */}
          {cols > 1 ? (
            <Box
              style={{
                position: "absolute",
                top: 0,
                left: VARIATION_COL_WIDTH / 2,
                width: (cols - 1) * (VARIATION_COL_WIDTH + VARIATION_COL_GAP),
                height: 1,
                backgroundColor: CONNECTOR_COLOR,
              }}
            />
          ) : null}
          <Flex gap="4">
            {Array.from({ length: cols }).map((_, i) => (
              <Flex
                key={i}
                direction="column"
                align="center"
                style={{ width: VARIATION_COL_WIDTH, maxWidth: "100%" }}
              >
                <Box
                  style={{
                    width: 1,
                    height: 12,
                    backgroundColor: CONNECTOR_COLOR,
                  }}
                />
                <ArrowHead />
              </Flex>
            ))}
          </Flex>
        </Box>
      </Flex>
    </Box>
  );
}

export default function TrafficAllocationFunnel({
  phaseIndex = null,
  experiment,
  editTargeting,
  editTraffic,
  editNamespace,
  setEditVariationIndex,
  canEditExperiment = false,
  mutate,
}: Props) {
  const { namespaces } = useOrgSettings();

  const phase = experiment.phases?.[phaseIndex ?? experiment.phases.length - 1];
  const hasNamespace = phase?.namespace && phase.namespace.enabled;

  // Total fraction of traffic let through by the namespace (1 when there's no
  // namespace), used for the dynamic connector labels.
  const namespaceRange =
    hasNamespace && phase?.namespace
      ? calculateNamespaceCoverage(phase.namespace)
      : 1;

  const namespaceName = hasNamespace
    ? namespaces?.find((n) => n.name === phase!.namespace!.name)?.label ||
      phase!.namespace!.name
    : "";

  const isBandit = experiment.type === "multi-armed-bandit";
  const isHoldout = experiment.type === "holdout";
  const runningBandit = isBandit && experiment.status === "running";

  const hasConfiguredTargeting =
    phase &&
    ((phase.condition && phase.condition !== "{}") ||
      (phase.savedGroups && phase.savedGroups.length > 0) ||
      (phase.prerequisites && phase.prerequisites.length > 0));

  if (!phase) {
    return (
      <Callout status="warning" mb="4">
        No traffic allocation or targeting configured yet. Add a phase to this
        experiment.
      </Callout>
    );
  }

  const holdoutTraffic = getHoldoutTrafficBreakdown(phase);
  const includedLabel = `${percentFormatter.format(namespaceRange)} traffic included`;
  const numVariations = getLatestPhaseVariations(experiment).length;

  return (
    <Frame>
      <Flex justify="between" align="center" mb="4">
        <Heading color="text-high" as="h4" size="small" mb="0">
          Traffic Allocation
        </Heading>
        {!isHoldout &&
          editNamespace &&
          !hasNamespace &&
          !!namespaces?.length && (
            <Button
              variant="ghost"
              onClick={editNamespace}
              icon={<PiPlus size="15" />}
            >
              Add Namespace
            </Button>
          )}
      </Flex>

      <Flex direction="column">
        <Flex align="center" direction="column">
          {!isHoldout && hasNamespace && (
            <>
              <FunnelCard
                title="Namespace"
                onEdit={runningBandit ? null : editNamespace}
                inlineSummary={
                  <Text size="large" color="text-mid">
                    {namespaceName}
                  </Text>
                }
                disabled={!hasNamespace}
              />
              <FunnelConnector label={includedLabel} />
            </>
          )}

          <FunnelCard
            title="Targeting"
            onEdit={runningBandit ? null : editTargeting}
            inlineSummary={
              hasConfiguredTargeting ? undefined : (
                <Text size="large">
                  <em>Everyone</em>
                </Text>
              )
            }
            disabled={!hasConfiguredTargeting}
          >
            <Flex direction="column" gap="3">
              {hasConfiguredTargeting ? (
                <>
                  {phase.condition && phase.condition !== "{}" ? (
                    <div>
                      <Text as="div" color="text-high" weight="semibold" mb="2">
                        Attribute Targeting
                      </Text>
                      <ConditionDisplay condition={phase.condition} />
                    </div>
                  ) : null}
                  {phase.savedGroups?.length ? (
                    <div>
                      <Text as="div" color="text-high" weight="semibold" mb="2">
                        Saved Group Targeting
                      </Text>
                      <SavedGroupTargetingDisplay
                        savedGroups={phase.savedGroups}
                      />
                    </div>
                  ) : null}
                  {!isHoldout && phase.prerequisites?.length ? (
                    <div>
                      <Text as="div" color="text-high" weight="semibold" mb="2">
                        Prerequisite Targeting
                      </Text>
                      <ConditionDisplay prerequisites={phase.prerequisites} />
                    </div>
                  ) : null}
                </>
              ) : null}
              <AssignmentAttribute experiment={experiment} />
            </Flex>
          </FunnelCard>

          <FunnelConnector />

          <FunnelCard
            title="Traffic"
            onEdit={runningBandit ? null : editTraffic}
          >
            {!isHoldout ? (
              <Flex direction="column" gap="3">
                <div>
                  <Text weight="semibold" color="text-high">
                    Included in this experiment:{" "}
                    <Text color="text-high" weight="regular">
                      {Math.floor(phase.coverage * 100)}%
                    </Text>
                  </Text>
                  <Box
                    mt="2"
                    style={{
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: "var(--gray-a4)",
                      overflow: "hidden",
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
                </div>
              </Flex>
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
              onEditMetadata={
                canEditExperiment && setEditVariationIndex
                  ? (index) => setEditVariationIndex(index)
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
    <div>
      <Text weight="semibold" color="text-high" mr="2">
        Assignment Attribute{experiment.fallbackAttribute ? "s" : ""}:{" "}
        {/* <Tooltip
          popperStyle={{ lineHeight: 1.5 }}
          body="This user attribute will be used to assign variations. This is typically either a logged-in user id or an anonymous id stored in a long-lived cookie."
        >
          <GBInfo />
        </Tooltip> */}
      </Text>
      <AttributeBadge attributeId={experiment.hashAttribute || "id"} />
      {experiment.fallbackAttribute ? (
        <>
          , <AttributeBadge attributeId={experiment.fallbackAttribute} />
        </>
      ) : null}
      {!isHoldout ? (
        <HashVersionTooltip>
          <small className="text-muted ml-1">
            (V{experiment.hashVersion || 2} hashing)
          </small>
        </HashVersionTooltip>
      ) : null}
      {!isHoldout && experiment.disableStickyBucketing ? (
        <div className="mt-1">
          <Text weight="semibold" color="text-high" mr="2">
            Sticky bucketing:
          </Text>
          <Text color="text-mid">
            <em>Disabled</em>
          </Text>
        </div>
      ) : null}
    </div>
  );
}
