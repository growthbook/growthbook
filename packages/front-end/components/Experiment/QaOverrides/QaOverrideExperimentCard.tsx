import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiLockBold } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  SummaryGrid,
  SummaryRow,
} from "@/components/Experiment/TabbedPage/StartSections";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import styles from "./QaOverrides.module.scss";

const percent = (n: number) => `${+(n * 100).toFixed(1)}%`;

// SummaryRow wraps its value in a span, so rows with block content use this.
function BlockRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <Text size="sm" color="text-mid">
        {label}
      </Text>
      <Box>{children}</Box>
    </>
  );
}

export default function QaOverrideExperimentCard({
  experiment,
}: {
  experiment: Pick<ExperimentInterfaceStringDates, "variations" | "phases">;
}) {
  const phase = experiment.phases[experiment.phases.length - 1];
  const variations = getLatestPhaseVariations(experiment);
  const hasTargeting =
    (!!phase?.condition && phase.condition !== "{}") ||
    !!phase?.savedGroups?.length ||
    !!phase?.prerequisites?.length;
  return (
    <Box
      role="group"
      aria-label="From the experiment (read-only)"
      className={styles.card}
    >
      <Flex align="center" gap="2" mb="2">
        <Text weight="semibold">From the experiment</Text>
        <PiLockBold size={12} color="var(--color-text-mid)" />
      </Flex>
      <SummaryGrid>
        {hasTargeting ? (
          <BlockRow label="Targeting">
            <ConditionDisplay
              condition={phase?.condition}
              savedGroups={phase?.savedGroups}
              prerequisites={phase?.prerequisites}
            />
          </BlockRow>
        ) : (
          <SummaryRow label="Targeting">Everyone</SummaryRow>
        )}
        <SummaryRow label="Traffic">{percent(phase?.coverage ?? 1)}</SummaryRow>
        <BlockRow label="Split">
          <Flex wrap="wrap" gapX="4" gapY="1">
            {variations.map((v, i) => (
              <Flex key={v.id} align="center" gap="1" flexShrink="0">
                <VariationLabel number={i} name={v.name} size="sm" />
                <Text size="sm" color="text-mid">
                  {percent(phase?.variationWeights?.[i] ?? 0)}
                </Text>
              </Flex>
            ))}
          </Flex>
        </BlockRow>
      </SummaryGrid>
    </Box>
  );
}
