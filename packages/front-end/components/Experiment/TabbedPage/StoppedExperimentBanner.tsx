import { useState } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Box, Flex } from "@radix-ui/themes";
import { PiClock, PiPencilSimple } from "react-icons/pi";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t, i18n } = useLingui();
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
      name={variations[i]?.name || t`Variation ${i}`}
      maxWidth="240px"
      size={size}
    />
  );

  const temporaryRollout = hasLiveLinkedChanges && !isHoldout;
  const winner = !isHoldout && !!variations[winningIndex];
  const headline = isHoldout
    ? t`Holdout stopped`
    : result === "inconclusive" || result === "dnf"
      ? i18n._(RESULT_LABELS[result])
      : t`Experiment stopped`;
  const dateEnded = experiment.phases.at(-1)?.dateEnded;
  const stoppedOn = dateEnded ? date(dateEnded) : null;
  const analysis = experiment.analysis;
  const releasedLabel =
    releasedIndex >= 0 ? variationLabel(releasedIndex) : null;

  return (
    <>
      {confirmingStop ? (
        <ConfirmDialog
          title={t`Stop temporary rollout?`}
          content={t`This completely stops serving traffic to the rolled-out variation.`}
          yesText={t`Stop rollout`}
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
                  <Text color="text-low">
                    <Trans>Stopped {stoppedOn}</Trans>
                  </Text>
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
                <Trans>Edit result</Trans>
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
                <Trans>Stop temporary rollout</Trans>
              </Button>
            }
          >
            {releasedLabel ? (
              <Flex align="center" gap="1" wrap="wrap">
                <Trans>
                  <Text weight="semibold">Temporary rollout:</Text>
                  {releasedLabel}
                  <span>to 100% of users</span>
                </Trans>
              </Flex>
            ) : (
              <Text as="div" weight="semibold">
                <Trans>Temporary rollout enabled</Trans>
              </Text>
            )}
            <Box mt="2">
              <Trans>
                Changes stay live until you implement them in code. Stop the
                rollout once you&apos;re done to improve performance.
              </Trans>{" "}
              <span style={{ whiteSpace: "nowrap" }}>
                <DocLink docSection="temporaryRollout">
                  <Trans>Learn more</Trans>
                </DocLink>
              </span>
            </Box>
          </Callout>
        ) : null}
      </Flex>
    </>
  );
}
