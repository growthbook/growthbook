import { FC } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiCheckCircleFill,
  PiCircleDashed,
  PiPencilSimpleFill,
  PiXCircleFill,
} from "react-icons/pi";
import {
  ExperimentQualityScoreResult,
  QUALITY_CHECK_PASS_THRESHOLD,
} from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import useExperimentQualityScore from "@/hooks/useExperimentQualityScore";
import { getScoreTier } from "@/components/Experiment/Quality/qualityDisplay";

const QualityScoreTooltipBody: FC<{ result: ExperimentQualityScoreResult }> = ({
  result,
}) => {
  return (
    <Flex direction="column" gap="1" py="1">
      <Text size="sm" weight="semibold">
        Experiment quality: {result.score}/100
        {result.pending ? " (AI checks pending)" : ""}
      </Text>
      {result.override && (
        <Text size="sm" color="text-mid">
          Manually set
          {result.override.userName ? ` by ${result.override.userName}` : ""}
          {result.computedScore !== null
            ? ` · computed score ${result.computedScore}`
            : ""}
        </Text>
      )}
      {result.sections
        .filter((s) => s.enabled)
        .map((section) => (
          <Box key={section.key}>
            <Text size="sm" weight="semibold">
              {section.label}
              {section.applicable
                ? ` — ${Math.round(section.earnedPoints)}/${Math.round(section.possiblePoints)}`
                : " — not applicable"}
            </Text>
            {section.checks
              .filter((c) => c.applicable)
              .map((check) => (
                <Flex gap="2" align="start" key={check.key}>
                  <Box mt="1">
                    {check.score === null ? (
                      <PiCircleDashed color="var(--gray-9)" />
                    ) : check.score >= QUALITY_CHECK_PASS_THRESHOLD ? (
                      <PiCheckCircleFill color="var(--green-9)" />
                    ) : (
                      <PiXCircleFill color="var(--red-9)" />
                    )}
                  </Box>
                  <Box>
                    <Text size="sm">
                      {check.label}
                      {check.type === "ai" &&
                        check.score !== null &&
                        ` — ${Math.round(check.score * 100)}%`}
                    </Text>
                    {check.reason && (
                      <Text size="sm" color="text-mid" as="p" mb="0">
                        {check.reason}
                      </Text>
                    )}
                  </Box>
                </Flex>
              ))}
          </Box>
        ))}
    </Flex>
  );
};

const QualityScoreBadge: FC<{
  experiment: ExperimentInterfaceStringDates;
}> = ({ experiment }) => {
  const quality = useExperimentQualityScore(experiment);

  const score = quality?.result.score ?? null;
  if (!quality || score === null) return null;
  const { result } = quality;

  return (
    <Tooltip body={<QualityScoreTooltipBody result={result} />}>
      <Badge
        color={getScoreTier(score)}
        variant="soft"
        radius="full"
        label={
          <Flex align="center" gap="1" display="inline-flex">
            <span>
              Quality: {score}
              {result.pending && !result.override ? "*" : ""}
            </span>
            {result.override && <PiPencilSimpleFill size={10} />}
          </Flex>
        }
      />
    </Tooltip>
  );
};

export default QualityScoreBadge;
