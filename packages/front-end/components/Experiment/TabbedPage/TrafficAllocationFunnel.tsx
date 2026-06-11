import { ReactNode } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { calculateNamespaceCoverage } from "shared/util";
import { getLatestPhaseVariations } from "shared/experiments";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPencilSimple } from "react-icons/pi";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import { getHoldoutTrafficBreakdown } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { HashVersionTooltip } from "@/components/Experiment/HashVersionSelector";
import VariationsTable from "@/components/Experiment/VariationsTable";
import useOrgSettings from "@/hooks/useOrgSettings";
import { GBInfo } from "@/components/Icons";
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
  editVariations?: (() => void) | null;
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
}: {
  title: string;
  info?: string;
  inlineSummary?: ReactNode;
  onEdit?: (() => void) | null;
  children?: ReactNode;
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
          <Text weight="medium" color="text-high">
            {title}
          </Text>
          {info ? (
            <Tooltip popperStyle={{ lineHeight: 1.5 }} body={info}>
              <GBInfo />
            </Tooltip>
          ) : null}
          {inlineSummary ? (
            <Text color="text-mid" ml="1">
              {inlineSummary}
            </Text>
          ) : null}
        </Flex>
        {onEdit ? (
          <IconButton
            variant="ghost"
            color="gray"
            radius="full"
            onClick={onEdit}
            aria-label={`Edit ${title}`}
          >
            <PiPencilSimple size={16} />
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
function FunnelConnector({ label }: { label: ReactNode }) {
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

// Branching connector that forks from the Traffic card into one arrow per
// variation, aligning each arrow above its column in the variations grid.
function VariationFork({ count, label }: { count: number; label?: ReactNode }) {
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
      <Box style={{ position: "relative" }}>
        {/* Horizontal bus connecting the centers of the outer columns */}
        {count > 1 ? (
          <Box
            style={{
              position: "absolute",
              top: 0,
              left: `${100 / (2 * count)}%`,
              width: `${(100 * (count - 1)) / count}%`,
              height: 1,
              backgroundColor: CONNECTOR_COLOR,
            }}
          />
        ) : null}
        <Flex>
          {Array.from({ length: count }).map((_, i) => (
            <Flex key={i} direction="column" align="center" style={{ flex: 1 }}>
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
    </Box>
  );
}

export default function TrafficAllocationFunnel({
  phaseIndex = null,
  experiment,
  editTargeting,
  editTraffic,
  editNamespace,
  editVariations,
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
      </Flex>

      <Flex direction="column">
        <Flex align="center" direction="column">
          {!isHoldout && (
            <>
              <FunnelCard
                title="Namespace"
                info="Use namespaces to run mutually exclusive experiments. Manage namespaces under Experimentation → Namespaces"
                onEdit={runningBandit ? null : editNamespace}
                inlineSummary={
                  hasNamespace ? (
                    <>
                      {namespaceName} ({percentFormatter.format(namespaceRange)}
                      )
                    </>
                  ) : (
                    <em>Optional</em>
                  )
                }
              />
              <FunnelConnector label={includedLabel} />
            </>
          )}

          <FunnelCard
            title="Targeting"
            onEdit={runningBandit ? null : editTargeting}
            inlineSummary={hasConfiguredTargeting ? undefined : "Everyone"}
          >
            {hasConfiguredTargeting ? (
              <Flex direction="column" gap="3">
                {phase.condition && phase.condition !== "{}" ? (
                  <div>
                    <div className="h5">Attribute Targeting</div>
                    <ConditionDisplay condition={phase.condition} />
                  </div>
                ) : null}
                {phase.savedGroups?.length ? (
                  <div>
                    <div className="h5">Saved Group Targeting</div>
                    <SavedGroupTargetingDisplay
                      savedGroups={phase.savedGroups}
                    />
                  </div>
                ) : null}
                {!isHoldout && phase.prerequisites?.length ? (
                  <div>
                    <div className="h5">Prerequisite Targeting</div>
                    <ConditionDisplay prerequisites={phase.prerequisites} />
                  </div>
                ) : null}
              </Flex>
            ) : null}
          </FunnelCard>

          <FunnelConnector label={includedLabel} />

          <FunnelCard
            title="Traffic"
            onEdit={runningBandit ? null : editTraffic}
          >
            {!isHoldout ? (
              <Flex direction="column" gap="3">
                <div>
                  <Text color="text-mid">
                    Included in this experiment:{" "}
                    <Text color="text-high" weight="medium">
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
                <AssignmentAttribute experiment={experiment} />
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
                <Box mt="2">
                  <AssignmentAttribute experiment={experiment} />
                </Box>
              </Flex>
            )}
          </FunnelCard>
        </Flex>
        {!isHoldout && (
          <>
            {!isBandit && (
              <VariationFork count={numVariations} label="% Split" />
            )}

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
            {editVariations && !runningBandit ? (
              <Flex justify="end" mt="3">
                <Button variant="ghost" onClick={editVariations}>
                  Edit Variations
                </Button>
              </Flex>
            ) : null}
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
      <div className="h5">
        Assignment Attribute{experiment.fallbackAttribute ? "s" : ""}{" "}
        <Tooltip
          popperStyle={{ lineHeight: 1.5 }}
          body="This user attribute will be used to assign variations. This is typically either a logged-in user id or an anonymous id stored in a long-lived cookie."
        >
          <GBInfo />
        </Tooltip>
      </div>
      <div className="d-flex flex-wrap align-items-center gap-1">
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
      </div>
      {!isHoldout && experiment.disableStickyBucketing ? (
        <div className="mt-1">
          <Text color="text-mid">
            Sticky bucketing: <em>disabled</em>
          </Text>
        </div>
      ) : null}
    </div>
  );
}
