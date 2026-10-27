import { useState } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Box, Flex } from "@radix-ui/themes";
import { PiClock, PiPencilSimple } from "react-icons/pi";
import { date } from "shared/dates";
import { getAllVariations } from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { includeExperimentInPayload } from "shared/util";
import { useAuth } from "@/services/auth";
import { DocLink } from "@/components/DocLink";
import Markdown from "@/components/Markdown/Markdown";
import ResultsIndicator, {
  RESULT_LABELS,
} from "@/components/Experiment/ResultsIndicator";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import ExperimentBanner from "./ExperimentBanner";

export type Props = {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  mutate: () => void;
  editResult?: () => void;
} & MarginProps;

export default function StoppedExperimentBanner({
  experiment,
  linkedFeatures,
  mutate,
  editResult,
  ...margin
}: Props) {
  const { apiCall } = useAuth();
  const [confirmingStop, setConfirmingStop] = useState(false);

  const hasLiveLinkedChanges = includeExperimentInPayload(
    experiment,
    linkedFeatures.map((f) => f.feature),
  );

  const isHoldout = experiment.type === "holdout";

  if (experiment.status !== "stopped") return null;

  const result = experiment.results;
  const variations = getAllVariations(experiment);

  const winningIndex = result === "won" ? experiment.winner || 1 : -1;
  const releasedIndex = variations.findIndex(
    (v) => v.id === experiment.releasedVariationId,
  );
  const variationLabel = (i: number, size: "md" | "lg" = "md") => (
    <VariationLabel
      number={i}
      name={variations[i]?.name || `Variation ${i}`}
      maxWidth="240px"
      size={size}
    />
  );

  const temporaryRollout = hasLiveLinkedChanges && !isHoldout;
  const winner = !isHoldout && !!variations[winningIndex];
  const headline = isHoldout
    ? "Holdout stopped"
    : result === "inconclusive" || result === "dnf"
      ? RESULT_LABELS[result]
      : "Experiment stopped";
  const dateEnded = experiment.phases.at(-1)?.dateEnded;
  const stoppedOn = dateEnded ? date(dateEnded) : null;
  const analysis = experiment.analysis;

  return (
    <>
      {confirmingStop ? (
        <ConfirmDialog
          title="Stop temporary rollout?"
          content="This completely stops serving traffic to the rolled-out variation."
          yesText="Stop rollout"
          color="red"
          onConfirm={async () => {
            await apiCall(`/experiment/${experiment.id}`, {
              method: "POST",
              body: JSON.stringify({ excludeFromPayload: true }),
            });
            mutate();
            setConfirmingStop(false);
          }}
          onCancel={() => setConfirmingStop(false)}
        />
      ) : null}
      <Flex direction="column" gap="3" {...margin}>
        <ExperimentBanner
          headline={
            <>
              {winner && result ? (
                <>
                  <ResultsIndicator results={result} />
                  {variationLabel(winningIndex, "lg")}
                </>
              ) : result === "lost" && !isHoldout ? (
                // No variation beside it: Control would read as the loser.
                <ResultsIndicator results={result} />
              ) : (
                <Text weight="medium" size="lg" color="text-mid">
                  {headline}
                </Text>
              )}
              {stoppedOn ? (
                <>
                  <Text color="text-low">·</Text>
                  <Text color="text-low">Stopped {stoppedOn}</Text>
                </>
              ) : null}
            </>
          }
          hoverAction={
            editResult && !isHoldout ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<PiPencilSimple />}
                onClick={editResult}
              >
                Edit result
              </Button>
            ) : null
          }
        >
          {analysis ? <Markdown>{analysis}</Markdown> : null}
        </ExperimentBanner>
        {temporaryRollout ? (
          <Callout
            status="warning"
            icon={<PiClock />}
            action={
              <Button
                variant="outline"
                color="red"
                size="sm"
                onClick={() => setConfirmingStop(true)}
              >
                Stop temporary rollout
              </Button>
            }
          >
            {releasedIndex >= 0 ? (
              <Flex align="center" gap="1" wrap="wrap">
                <Text weight="semibold">Temporary rollout:</Text>
                {variationLabel(releasedIndex)}
                <span>to 100% of users</span>
              </Flex>
            ) : (
              <Text as="div" weight="semibold">
                Temporary rollout enabled
              </Text>
            )}
            <Box mt="2">
              Changes stay live until you implement them in code. Stop the
              rollout once you&apos;re done to improve performance.{" "}
              <span style={{ whiteSpace: "nowrap" }}>
                <DocLink docSection="temporaryRollout">Learn more</DocLink>
              </span>
            </Box>
          </Callout>
        ) : null}
      </Flex>
    </>
  );
}
