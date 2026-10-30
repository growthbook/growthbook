import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import { ExperimentQualityScoreResult } from "shared/enterprise";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { TextField } from "@/ui/TextField";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import QualityDonut from "./QualityDonut";
import { getBandDisplay } from "./qualityDisplay";
import styles from "./Quality.module.scss";

export default function OverrideScoreModal({
  result,
  close,
  submit,
}: {
  result: ExperimentQualityScoreResult;
  close: () => void;
  submit: (body: { score: number; reason: string }) => Promise<void>;
}) {
  // Kept as typed, so clearing the field to retype works; checked on submit
  const [score, setScore] = useState(
    String(result.override?.score ?? result.computedScore ?? 50),
  );
  const [reason, setReason] = useState(result.override?.reason ?? "");
  const parsed = Number(score);
  const valid = score.trim() !== "" && Number.isInteger(parsed) && parsed >= 0;
  const newBand = valid && parsed <= 100 ? getBandDisplay(parsed) : null;
  const calculated = result.computedScore;

  return (
    <ModalStandard
      open
      trackingEventModalType="experiment-quality-override"
      header="Override Quality Score"
      cta="Override score"
      ctaEnabled={!!newBand && !!reason.trim()}
      close={close}
      submit={async () => {
        if (!newBand) throw new Error("Enter a whole number from 0 to 100.");
        if (!reason.trim()) throw new Error("Add a reason for the override.");
        await submit({ score: parsed, reason: reason.trim() });
      }}
    >
      <Flex direction="column" gap="4">
        {calculated !== null ? (
          <Flex align="center" gap="3" p="3" className={styles.panel}>
            <QualityDonut score={calculated} size={40} showLabel={false} />
            <Box>
              <Text as="div">
                Calculated score <strong>{calculated}</strong>
              </Text>
              <Text as="div" size="sm" weight="semibold">
                <span style={{ color: getBandDisplay(calculated).text }}>
                  {getBandDisplay(calculated).label}
                </span>
              </Text>
            </Box>
          </Flex>
        ) : null}
        <Box>
          <Text as="label" weight="semibold" htmlFor="quality-override-score">
            New score
          </Text>
          <Flex align="center" gap="2" mt="1">
            <Box width="80px">
              <TextField
                id="quality-override-score"
                type="number"
                min={0}
                max={100}
                value={score}
                onChange={(e) => setScore(e.target.value)}
              />
            </Box>
            <Text color="text-mid">of 100</Text>
            {newBand ? (
              <Badge
                label={newBand.label}
                color={newBand.scale}
                variant="soft"
              />
            ) : null}
          </Flex>
        </Box>
        <TextField
          multiline
          label={
            <Flex align="center" gap="1" mb="1">
              <Text
                as="label"
                weight="semibold"
                htmlFor="quality-override-reason"
                mb="0"
              >
                Reason
              </Text>
              <Tooltip content="Required. Everyone who can see this experiment will see the reason.">
                <PiInfo tabIndex={0} aria-label="About the reason" />
              </Tooltip>
            </Flex>
          }
          id="quality-override-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Flex>
    </ModalStandard>
  );
}
