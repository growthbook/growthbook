import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { getAllVariations } from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { includeExperimentInPayload } from "shared/util";
import { DocLink } from "@/components/DocLink";
import { useAuth } from "@/services/auth";
import Markdown from "@/components/Markdown/Markdown";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Text from "@/ui/Text";
import QuickEditButton, { revealsQuickEdit } from "./QuickEditButton";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  mutate: () => void;
  editResult?: () => void;
}

export default function StoppedExperimentBanner({
  experiment,
  linkedFeatures,
  mutate,
  editResult,
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

  const winningVariation =
    (result === "lost"
      ? variations[0]?.name
      : result === "won"
        ? variations[experiment.winner || 1]?.name
        : "") || "";

  const releasedVariation =
    variations.find((v) => v.id === experiment.releasedVariationId)?.name || "";

  const temporaryRollout = hasLiveLinkedChanges && !isHoldout;
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
      <Callout
        status="info"
        contentAlign={temporaryRollout || analysis ? "start" : "center"}
        mb="4"
        action={
          temporaryRollout ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmingStop(true)}
            >
              Stop temporary rollout
            </Button>
          ) : undefined
        }
      >
        <Flex align="center" gap="2" className={revealsQuickEdit}>
          <Text weight="semibold">
            {isHoldout ? "Holdout stopped" : "Experiment stopped"}
          </Text>
          {result ? <ResultsIndicator results={result} /> : null}
          {editResult && !isHoldout ? (
            <QuickEditButton label="Edit result" onClick={editResult} />
          ) : null}
        </Flex>
        {temporaryRollout ? (
          <Box mt="1">
            {releasedVariation ? (
              <>
                {(result === "won" || result === "lost") &&
                winningVariation !== releasedVariation ? (
                  <>
                    <strong>&quot;{winningVariation}&quot;</strong> won,
                    but{" "}
                  </>
                ) : null}
                <strong>&quot;{releasedVariation}&quot;</strong> was rolled out
                to 100%.{" "}
              </>
            ) : null}
            Changes are still being applied as a temporary rollout, to give you
            time to implement them in code. When you no longer need it, stop the
            rollout to improve site performance.{" "}
            <DocLink docSection="temporaryRollout">Learn more</DocLink>
          </Box>
        ) : null}
        {analysis ? (
          <Box mt="2">
            <Markdown>{analysis}</Markdown>
          </Box>
        ) : null}
      </Callout>
    </>
  );
}
