import { Flex } from "@radix-ui/themes";
import { PiArrowRightBold } from "react-icons/pi";
import {
  expandMetricGroups,
  getLatestPhaseVariations,
  isSuspiciousUplift,
  snapshotColumnVariationIds,
} from "shared/experiments";
import { getSnapshotAnalysis } from "shared/util";
import {
  DecisionCriteriaData,
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
  VariationWithIndex,
} from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { Fragment, useEffect, useState } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import {
  buildTiebreakerLiftMap,
  clearLeader,
  resolveScheduledShipDecision,
} from "shared/enterprise";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import useApi from "@/hooks/useApi";
import ExperimentDecisionExplanation, {
  Reason,
} from "./ExperimentDecisionExplanation";
import ExperimentBanner from "./ExperimentBanner";
import { useEditsBlockedReason } from "./ExperimentEdits";

const DECISIONS = {
  "ship-now": { label: "Ship now", color: "green" },
  "ready-for-review": { label: "Decide now", color: "amber" },
  "rollback-now": { label: "Roll back now", color: "red" },
} as const;

type Decision = Extract<
  ExperimentResultStatusData,
  { status: keyof typeof DECISIONS }
>;
const isDecision = (data: ExperimentResultStatusData): data is Decision =>
  data.status in DECISIONS;

/** The variations a recommendation is about; none when there's none to show. */
export function decidedVariations(
  experiment: ExperimentInterfaceStringDates,
  data: ExperimentResultStatusData,
): VariationWithIndex[] {
  if (!isDecision(data)) return [];
  const indexed = getLatestPhaseVariations(experiment).map<VariationWithIndex>(
    (v, i) => ({ ...v, index: i }),
  );
  return data.variations
    .map(({ variationId }) => indexed.find((v) => v.id === variationId))
    .filter((v) => v !== undefined);
}

type ShipLean =
  | { by: "tiebreaker"; metricName: string; winnerId: string | null }
  | { by: "goal"; metricName: string; winnerId: string };

// The results a decision reads: the latest phase, overall, in its default
// analysis. Never the slice, settings or earlier phase open on Results. Each
// column named as the decision names variations.
function useDecisionResults(experiment: ExperimentInterfaceStringDates) {
  const { dimensionless, phase } = useSnapshot();
  const latestPhase = experiment.phases.length - 1;
  const viewingLatest = phase === latestPhase;
  const summarySnapshotId = experiment.analysisSummary?.snapshotId;
  const { data, mutate } = useApi<{ snapshot: ExperimentSnapshotInterface }>(
    `/experiment/${experiment.id}/snapshot/${latestPhase}`,
    { shouldRun: () => !viewingLatest },
  );
  // Only the results the decision was made on, so a cached older one can't
  // pick the winner; refetched once the decision moves past it.
  const fetched =
    data?.snapshot?.id === summarySnapshotId ? data?.snapshot : undefined;
  const stale = !viewingLatest && !!data && !fetched;
  useEffect(() => {
    if (stale) mutate();
  }, [stale, mutate]);
  const snapshot = viewingLatest ? dimensionless : fetched;
  const analysis = snapshot ? getSnapshotAnalysis(snapshot) : null;
  if (!snapshot || !analysis) return null;
  return {
    analysis,
    results: analysis.results?.[0]?.variations ?? [],
    variationIds: snapshotColumnVariationIds(
      experiment,
      snapshot.settings.variations,
    ),
  };
}

// Which of a ship's tied winners to lean to. The stop plan's tiebreaker metric
// picks one at the scheduled end; without one, a sole goal metric nudges
// toward a variation clearly ahead on it. Null for neither.
function useShipLean(
  experiment: ExperimentInterfaceStringDates,
  status: ExperimentResultStatusData | undefined,
): ShipLean | null {
  const decisionResults = useDecisionResults(experiment);
  const { getExperimentMetricById, metricGroups } = useDefinitions();
  if (status?.status !== "ship-now" || status.variations.length < 2) {
    return null;
  }
  const results = decisionResults?.results ?? [];
  const variationIds = decisionResults?.variationIds ?? [];

  const tiebreakerId =
    experiment.statusUpdateSchedule?.scheduledStopPlan?.tiebreakerMetricId;
  if (tiebreakerId) {
    const metric = getExperimentMetricById(tiebreakerId);
    const decision = resolveScheduledShipDecision({
      resultStatus: status,
      tiebreakerLiftByVariationId: buildTiebreakerLiftMap({
        variations: results,
        variationIds,
        metricId: tiebreakerId,
        inverse: metric?.inverse,
      }),
    });
    return {
      by: "tiebreaker",
      metricName: metric?.name ?? tiebreakerId,
      winnerId: decision.action === "ship" ? decision.variationId : null,
    };
  }

  const goals = expandMetricGroups(experiment.goalMetrics, metricGroups);
  if (goals.length !== 1) return null;
  const metric = getExperimentMetricById(goals[0]);
  const winnerId = clearLeader({
    variations: results,
    variationIds,
    tiedVariationIds: status.variations.map((v) => v.variationId),
    metricId: goals[0],
    inverse: metric?.inverse,
  });
  return winnerId
    ? { by: "goal", metricName: metric?.name ?? goals[0], winnerId }
    : null;
}

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });
const percent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

// The decided variations' goal and guardrail results whose change is past the
// metric's max, by variation. The results table flags them "Suspicious"; the
// decision still counts them, so its details say so.
function useSuspiciousResults(
  experiment: ExperimentInterfaceStringDates,
  status: ExperimentResultStatusData,
): { variationId: string; hint: string }[] {
  const decisionResults = useDecisionResults(experiment);
  const { getExperimentMetricById, metricGroups } = useDefinitions();
  const { metricDefaults } = useOrganizationMetricDefaults();
  if (!isDecision(status) || !decisionResults) return [];
  const { analysis, results, variationIds: ids } = decisionResults;
  const metrics = [
    ...new Set(
      expandMetricGroups(
        [...experiment.goalMetrics, ...(experiment.guardrailMetrics ?? [])],
        metricGroups,
      ),
    ),
  ].flatMap((id) => {
    const metric = getExperimentMetricById(id);
    return metric ? [{ id, metric }] : [];
  });
  return status.variations.flatMap(({ variationId }) => {
    const stats = results[ids.indexOf(variationId)]?.metrics;
    const flagged = metrics.filter(({ id, metric }) => {
      const baseline = results[0]?.metrics?.[id];
      return (
        !!baseline &&
        !!stats?.[id] &&
        isSuspiciousUplift(
          baseline,
          stats[id],
          metric,
          metricDefaults,
          analysis.settings.differenceType,
        )
      );
    });
    if (!flagged.length) return [];
    const maxes = flagged.map(
      ({ metric }) =>
        metric.maxPercentChange ?? metricDefaults.maxPercentageChange ?? 0,
    );
    const names = listFormat.format(flagged.map(({ metric }) => metric.name));
    const max = maxes.every((m) => m === maxes[0])
      ? ` ${percent.format(maxes[0])}`
      : "";
    return [
      {
        variationId,
        hint:
          flagged.length === 1
            ? `${names} is past its${max} max change.`
            : `${names} are past their${max} max change.`,
      },
    ];
  });
}

const cautionsFor = (
  suspicious: { variationId: string; hint: string }[],
  names: Record<string, JSX.Element>,
) =>
  suspicious.map(({ variationId, hint }) => ({
    text: <>{inline(names[variationId])} has suspicious results.</>,
    hint,
  }));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What each decided variation's goal and guardrail results came to, one line
// each: what a default decision falls back from.
function variationOutcomes(
  experiment: ExperimentInterfaceStringDates,
  status: Decision,
  names: Record<string, JSX.Element>,
  goalIds: string[],
  guardrailIds: string[],
): Record<string, JSX.Element> {
  const summaries = experiment.analysisSummary?.resultsStatus?.variations ?? [];
  return Object.fromEntries(
    status.variations.flatMap(({ variationId }) => {
      const summary = summaries.find((v) => v.variationId === variationId);
      if (!summary) return [];
      const goals = goalIds.flatMap((id) => summary.goalMetrics?.[id] ?? []);
      const count = (s: string) => goals.filter((g) => g.status === s).length;
      const guardrailsLost = guardrailIds.filter(
        (id) => summary.guardrailMetrics?.[id]?.status === "lost",
      ).length;
      const [won, lost, flat] = [count("won"), count("lost"), count("neutral")];
      const parts = [
        won ? `${plural(won, "goal metric")} won` : "",
        lost
          ? won
            ? `${lost} lost`
            : `${plural(lost, "goal metric")} lost`
          : "",
        flat
          ? won || lost
            ? `${flat} not significant`
            : "no goal metric significant"
          : "",
        guardrailsLost ? `${plural(guardrailsLost, "guardrail")} lost` : "",
      ].filter(Boolean);
      return [
        [
          variationId,
          <Text as="div" key={variationId}>
            {inline(names[variationId])}: {parts.join(", ")}.
          </Text>,
        ],
      ];
    }),
  );
}

// A ship tied between variations, for the details: who's tied, and what
// breaks the tie: the stop plan's tiebreaker, a goal metric's nudge, or you.
const tieRow = (
  status: Decision,
  lean: ShipLean | null,
  names: Record<string, JSX.Element>,
) => {
  if (status.status !== "ship-now" || status.variations.length < 2) {
    return null;
  }
  const tied = status.variations.map((v) => names[v.variationId]);
  return {
    text: <>{sentenceList(tied, "and")} each qualify to ship.</>,
    hint:
      lean?.by === "tiebreaker" ? (
        lean.winnerId ? (
          <>
            Your tiebreaker, {lean.metricName}, favors{" "}
            {inline(names[lean.winnerId])}.
          </>
        ) : (
          <>
            Your tiebreaker, {lean.metricName}, picks one at the scheduled end.
          </>
        )
      ) : lean?.by === "goal" ? (
        <>
          {inline(names[lean.winnerId])} is clearly ahead on {lean.metricName}.
        </>
      ) : (
        "Pick the one to release."
      ),
  };
};

// What a recommendation's details say, the same in the banner and the stop
// form, with the lean and labels its headline reads.
function useDecisionDetails(
  experiment: ExperimentInterfaceStringDates,
  status: ExperimentResultStatusData,
  decisionCriteria: DecisionCriteriaData,
) {
  const lean = useShipLean(experiment, status);
  const suspicious = useSuspiciousResults(experiment, status);
  const { metricGroups } = useDefinitions();
  const names = variationLabels(experiment);
  const goalIds = expandMetricGroups(experiment.goalMetrics, metricGroups);
  const guardrailIds = expandMetricGroups(
    experiment.guardrailMetrics ?? [],
    metricGroups,
  );
  return {
    lean,
    names,
    details: {
      variationNames: names,
      criteriaName: decisionCriteria.name,
      goalMetricCount: goalIds.length,
      outcomes: isDecision(status)
        ? variationOutcomes(experiment, status, names, goalIds, guardrailIds)
        : {},
      tie: isDecision(status) ? tieRow(status, lean, names) : null,
      cautions: cautionsFor(suspicious, names),
    },
  };
}

/** The variation a ship recommends: its only winner, or the tiebreaker's pick. */
export function useRecommendedShip(
  experiment: ExperimentInterfaceStringDates,
  status: ExperimentResultStatusData | undefined,
): string | null {
  const lean = useShipLean(experiment, status);
  if (status?.status !== "ship-now") return null;
  const ids = shipped(decidedVariations(experiment, status), lean);
  return ids.length === 1 ? ids[0] : null;
}

// What a ship names: the tiebreaker's pick once it has one, else every winner.
const shipped = (
  decided: VariationWithIndex[],
  lean: ShipLean | null,
): string[] =>
  lean?.by === "tiebreaker" && lean.winnerId
    ? [lean.winnerId]
    : decided.map((v) => v.id);

const variationLabels = (experiment: ExperimentInterfaceStringDates) =>
  Object.fromEntries(
    getLatestPhaseVariations(experiment).map((v) => [
      v.id,
      // A long name ends in an ellipsis rather than wrapping the line.
      <VariationLabel
        key={v.id}
        number={v.index}
        name={v.name}
        maxWidth="240px"
      />,
    ]),
  );

// Commas ride on the name before them, the serial one too; the last name
// joins with "and" or "or".
const listed = (labels: JSX.Element[], last: "and" | "or") =>
  labels.map((label, i) => (
    <Fragment key={i}>
      {i > 0 && i === labels.length - 1 ? (
        <Text color="text-mid">{last}</Text>
      ) : null}
      <Flex align="center" minWidth="0">
        {label}
        {labels.length > 2 && i < labels.length - 1 ? (
          <Text color="text-mid">,</Text>
        ) : null}
      </Flex>
    </Fragment>
  ));

// The recommendation as one line, led by its badge: "Ship now ① B",
// "Roll back now to ⓪ A", "Decide now: no clear winner among ① B, ② C and ⓪ A".
function RecommendationLine({
  experiment,
  status,
  decided,
  lean,
  names,
}: {
  experiment: ExperimentInterfaceStringDates;
  status: Decision;
  decided: VariationWithIndex[];
  lean: ShipLean | null;
  names: Record<string, JSX.Element>;
}) {
  const labels = decided.map((v) => names[v.id]);
  const shipping = shipped(decided, lean).map((id) => names[id]);
  const control = getLatestPhaseVariations(experiment)[0];
  const decision = DECISIONS[status.status];
  return (
    <>
      <Badge
        label={decision.label}
        color={decision.color}
        variant="solid"
        radius="full"
      />
      {status.status === "rollback-now" ? (
        <>
          <Text color="text-mid">to</Text>
          {control ? names[control.id] : null}
        </>
      ) : status.status === "ready-for-review" ? (
        <>
          <Text color="text-mid">no clear winner among</Text>
          {listed(control ? [...labels, names[control.id]] : labels, "and")}
        </>
      ) : (
        <>
          {shipping.length > 1 ? <Text color="text-mid">one of</Text> : null}
          {listed(shipping, "or")}
        </>
      )}
    </>
  );
}

type Props = {
  experiment: ExperimentInterfaceStringDates;
  runningExperimentStatus: ExperimentResultStatusData;
  decisionCriteria: DecisionCriteriaData;
  showDecisionCriteriaLink?: boolean;
  // Opens the form that stops it with a result.
  makeDecision?: () => void;
} & MarginProps;

export default function RunningExperimentDecisionBanner({
  experiment,
  runningExperimentStatus,
  decisionCriteria,
  showDecisionCriteriaLink = true,
  makeDecision,
  ...margin
}: Props) {
  const [showDecisionCriteria, setShowDecisionCriteria] = useState(false);
  const blockedReason = useEditsBlockedReason();
  const { lean, names, details } = useDecisionDetails(
    experiment,
    runningExperimentStatus,
    decisionCriteria,
  );

  const decided = decidedVariations(experiment, runningExperimentStatus);
  if (!isDecision(runningExperimentStatus) || !decided.length) return null;
  const decision = DECISIONS[runningExperimentStatus.status];

  const banner = (
    <ExperimentBanner
      headline={
        <RecommendationLine
          experiment={experiment}
          status={runningExperimentStatus}
          decided={decided}
          lean={lean}
          names={names}
        />
      }
      details={
        <ExperimentDecisionExplanation
          status={runningExperimentStatus}
          variations={runningExperimentStatus.variations}
          {...details}
          showDecisionCriteria={showDecisionCriteria}
          setShowDecisionCriteria={setShowDecisionCriteria}
          showDecisionCriteriaLink={showDecisionCriteriaLink}
          action={
            makeDecision ? (
              <Tooltip content={blockedReason} enabled={!!blockedReason}>
                <Button
                  variant="ghost"
                  onClick={makeDecision}
                  disabled={!!blockedReason}
                >
                  Make decision
                </Button>
              </Tooltip>
            ) : null
          }
          reasonColor={decision.color}
        />
      }
      {...margin}
    />
  );
  return (
    <>
      {showDecisionCriteria && (
        <DecisionCriteriaModal
          decisionCriteria={decisionCriteria}
          onClose={() => setShowDecisionCriteria(false)}
          editable={false}
          mutate={() => {}}
        />
      )}
      {banner}
    </>
  );
}

// A variation's label, in a run of text.
const inline = (label: JSX.Element | undefined) => (
  <span
    style={{
      display: "inline-flex",
      verticalAlign: "bottom",
      maxWidth: "100%",
    }}
  >
    {label}
  </span>
);

const sentenceList = (labels: JSX.Element[], last: "and" | "or") =>
  labels.map((label, i) => (
    <Fragment key={i}>
      {i === 0
        ? ""
        : i < labels.length - 1
          ? ", "
          : labels.length > 2
            ? `, ${last} `
            : ` ${last} `}
      {inline(label)}
    </Fragment>
  ));

/** The recommendation as a sentence, with its reasons: for the stop form. */
export function DecisionRecommendation({
  experiment,
  runningExperimentStatus,
  decisionCriteria,
}: {
  experiment: ExperimentInterfaceStringDates;
  runningExperimentStatus: ExperimentResultStatusData;
  decisionCriteria: DecisionCriteriaData;
}) {
  const { lean, names, details } = useDecisionDetails(
    experiment,
    runningExperimentStatus,
    decisionCriteria,
  );
  const decided = decidedVariations(experiment, runningExperimentStatus);
  if (!isDecision(runningExperimentStatus) || !decided.length) return null;
  const { status } = runningExperimentStatus;

  const labels = decided.map((v) => names[v.id]);
  const shipping = shipped(decided, lean).map((id) => names[id]);
  const control = getLatestPhaseVariations(experiment)[0];
  const controlLabel = inline(control ? names[control.id] : undefined);

  return (
    <Flex direction="column" gap="4">
      <Reason color={DECISIONS[status].color} icon={<PiArrowRightBold />}>
        <Text weight="semibold">
          {status === "ship-now" ? (
            <>
              Ship {shipping.length > 1 ? "one of " : ""}
              {sentenceList(shipping, "or")}.
            </>
          ) : status === "rollback-now" ? (
            <>Roll back to {controlLabel}.</>
          ) : (
            <>
              Decide now:{" "}
              {runningExperimentStatus.powerReached
                ? "it has enough data to detect its target effect"
                : runningExperimentStatus.scheduledEndPassed
                  ? "its scheduled end has passed"
                  : runningExperimentStatus.sequentialUsed
                    ? "sequential testing allows it"
                    : "its results are already strong enough"}
              , but there&apos;s no clear winner among{" "}
              {sentenceList(
                control ? [...labels, names[control.id]] : labels,
                "and",
              )}
              .
            </>
          )}
        </Text>
      </Reason>
      <ExperimentDecisionExplanation
        status={runningExperimentStatus}
        variations={runningExperimentStatus.variations}
        {...details}
        showDecisionCriteria={false}
        setShowDecisionCriteria={() => {}}
        showDecisionCriteriaLink={false}
        reasonColor={DECISIONS[status].color}
      />
    </Flex>
  );
}
