import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiCheckCircleFill,
  PiMinusCircle,
  PiXCircleFill,
} from "react-icons/pi";
import { PROCESS_RULES, getProcessScore } from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { date } from "shared/dates";
import Text from "@/ui/Text";
import { getScoreTier, scaleColors } from "./qualityDisplay";

// How cleanly the experiment was set up, run and stopped, judged from its
// change history once it stops
export default function ProcessCard({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  if ((experiment.type ?? "standard") !== "standard") return null;

  const results = experiment.processResults;
  const score = results ? getProcessScore(results.rules) : null;

  let note: string | null = null;
  if (experiment.status !== "stopped") {
    note = "The process is scored once the experiment stops.";
  } else if (!results) {
    note = "The process score is being calculated.";
  } else if (score === null) {
    note =
      "There isn't enough change history to score how this experiment was run.";
  }

  return (
    <Box
      p="4"
      mt="3"
      style={{
        border: "1px solid var(--border-color-200)",
        borderRadius: 8,
        background: "var(--color-panel)",
      }}
    >
      <Flex justify="between" align="center">
        <Text size="md" weight="semibold">
          Process
        </Text>
        {score !== null && (
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              fontWeight: 600,
              color: scaleColors(getScoreTier(score)).text,
            }}
          >
            {score} / 100
          </span>
        )}
      </Flex>
      <Text as="p" size="sm" color="text-mid" mt="1" mb="2">
        How the experiment was set up, run and stopped. Changes made after it
        stopped don&apos;t count.
      </Text>
      {note ? (
        <Text size="sm" color="text-low">
          {note}
        </Text>
      ) : (
        <Flex direction="column" gap="2">
          {PROCESS_RULES.map((rule) => {
            const r = results?.rules.find((x) => x.key === rule.key);
            if (!r) return null;
            return (
              <Flex key={rule.key} gap="2" align="start">
                <Box mt="1" flexShrink="0">
                  {r.result === "pass" ? (
                    <PiCheckCircleFill color="var(--green-9)" />
                  ) : r.result === "fail" ? (
                    <PiXCircleFill
                      color={
                        rule.severity === "critical"
                          ? "var(--red-9)"
                          : "var(--amber-9)"
                      }
                    />
                  ) : (
                    <PiMinusCircle color="var(--gray-8)" />
                  )}
                </Box>
                <Box>
                  <Text
                    size="md"
                    color={r.result === "na" ? "text-low" : "text-high"}
                  >
                    {rule.label}
                  </Text>
                  {r.result === "fail" && r.detail && (
                    <Text as="p" size="sm" color="text-mid" mb="0">
                      {r.detail}
                      {r.user ? ` by ${r.user}` : ""}
                      {r.date ? ` on ${date(r.date)}` : ""}
                    </Text>
                  )}
                  {r.result === "na" && (
                    <Text as="p" size="sm" color="text-low" mb="0">
                      Not enough information to judge
                    </Text>
                  )}
                </Box>
              </Flex>
            );
          })}
        </Flex>
      )}
    </Box>
  );
}
