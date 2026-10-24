import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiCaretRight } from "react-icons/pi";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import styles from "./MetricPickerPanel.module.scss";

export type SuggestedMetric = {
  id: string;
  name: string;
  typeLabel: string;
  count: number;
};

function Count({ value, label }: { value: number; label: string }) {
  return (
    <Box>
      <Text as="div" size="xl" weight="semibold" color="text-high">
        {value}
      </Text>
      <Text size="sm" color="text-low">
        {label}
      </Text>
    </Box>
  );
}

function Skeleton({ height }: { height: number }) {
  return (
    <Box
      style={{
        height,
        borderRadius: "var(--radius-4)",
        background: "var(--gray-a3)",
      }}
    />
  );
}

export default function MetricPickerPanel({
  suggestions,
  counts,
  onSelect,
}: {
  suggestions: SuggestedMetric[];
  counts: { completed: number; won: number; lost: number };
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <Frame mb="0" py="5" px="5">
        <Grid columns={{ initial: "1", md: "2" }} gap="5">
          <Box>
            <Text
              size="sm"
              weight="semibold"
              color="text-mid"
              textTransform="uppercase"
            >
              No metric selected
            </Text>
            <Heading as="h2" size="md" mt="1" mb="2">
              Pick a Metric to Measure Impact
            </Heading>
            <Text as="p" color="text-mid" mb="2">
              Impact adds up the scaled effect of every completed experiment on
              one metric, annualized and de-biased. Choose the metric leadership
              cares about most, usually revenue or conversion.
            </Text>
            <Text as="p" color="text-mid" mb="4">
              Only experiments that used the metric count toward impact.
            </Text>
            <Flex
              gap="6"
              pt="3"
              style={{ borderTop: "1px solid var(--gray-a5)" }}
            >
              <Count value={counts.completed} label="Completed experiments" />
              <Count value={counts.won} label="Won" />
              <Count value={counts.lost} label="Lost" />
            </Flex>
          </Box>
          <Box>
            <Flex justify="between" mb="2">
              <Text
                size="sm"
                weight="semibold"
                color="text-mid"
                textTransform="uppercase"
              >
                Suggested metrics
              </Text>
              <Text size="sm" color="text-low">
                Most used goal metrics
              </Text>
            </Flex>
            <Box className={styles.list}>
              {suggestions.length === 0 ? (
                <Box p="3">
                  <Text color="text-mid">
                    No completed experiments in this date range have goal
                    metrics.
                  </Text>
                </Box>
              ) : (
                suggestions.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={styles.row}
                    onClick={() => onSelect(m.id)}
                  >
                    <Box style={{ minWidth: 0 }}>
                      <div className={styles.name}>{m.name}</div>
                      <Text size="sm" color="text-low">
                        {m.typeLabel} · Used in {m.count} experiment
                        {m.count === 1 ? "" : "s"}
                      </Text>
                    </Box>
                    <PiCaretRight />
                  </button>
                ))
              )}
            </Box>
          </Box>
        </Grid>
      </Frame>
      <Flex
        direction="column"
        gap="4"
        mt="4"
        style={{ opacity: 0.6 }}
        aria-hidden
      >
        <Grid columns="4" gap="3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={92} />
          ))}
        </Grid>
        <Skeleton height={360} />
        <Grid columns="5" gap="4">
          <Box style={{ gridColumn: "span 3" }}>
            <Skeleton height={240} />
          </Box>
          <Box style={{ gridColumn: "span 2" }}>
            <Skeleton height={240} />
          </Box>
        </Grid>
      </Flex>
    </>
  );
}
