import { FC } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiCheckCircleFill,
  PiCircleDashed,
  PiMinusCircle,
  PiXCircleFill,
} from "react-icons/pi";
import { ExperimentQualityCheckResult } from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import useExperimentQualityScore from "@/hooks/useExperimentQualityScore";

const getScoreColor = (
  score: number,
): React.ComponentProps<typeof Badge>["color"] => {
  if (score >= 80) return "green";
  if (score >= 50) return "amber";
  return "red";
};

const CheckRow: FC<{ check: ExperimentQualityCheckResult }> = ({ check }) => {
  const icon = !check.applicable ? (
    <PiMinusCircle color="var(--gray-9)" />
  ) : check.score === null ? (
    <PiCircleDashed color="var(--gray-9)" />
  ) : check.score >= 0.5 ? (
    <PiCheckCircleFill color="var(--green-9)" />
  ) : (
    <PiXCircleFill color="var(--red-9)" />
  );

  return (
    <Flex gap="2" align="start">
      <Box mt="1">{icon}</Box>
      <Box>
        <Text size="small">
          {check.label}
          {check.applicable &&
            check.type === "ai" &&
            check.score !== null &&
            ` — ${Math.round(check.score * 100)}%`}
        </Text>
        {check.reason && (
          <Text size="small" color="text-mid" as="p" mb="0">
            {check.reason}
          </Text>
        )}
      </Box>
    </Flex>
  );
};

const QualityScoreBadge: FC<{
  experiment: ExperimentInterfaceStringDates;
}> = ({ experiment }) => {
  const result = useExperimentQualityScore(experiment);

  if (!result || result.score === null) return null;

  const tooltipBody = (
    <Flex direction="column" gap="1" py="1">
      <Text size="small" weight="semibold">
        Experiment quality: {result.score}/100
        {result.pending ? " (AI checks pending)" : ""}
      </Text>
      {result.checks
        .filter((c) => c.applicable)
        .map((check) => (
          <CheckRow key={check.key} check={check} />
        ))}
    </Flex>
  );

  return (
    <Tooltip body={tooltipBody}>
      <Badge
        color={getScoreColor(result.score)}
        variant="soft"
        radius="full"
        label={`Quality: ${result.score}${result.pending ? "*" : ""}`}
      />
    </Tooltip>
  );
};

export default QualityScoreBadge;
