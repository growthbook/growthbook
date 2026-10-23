import { ReactNode } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { ImpactSummary } from "./impactData";

function KpiCard({
  label,
  dot,
  value,
  detail,
}: {
  label: string;
  dot?: string;
  value: string | null;
  detail: ReactNode;
}) {
  return (
    <Box className="appbox" mb="0" px="4" py="3">
      <Flex align="center" gap="2" mb="1">
        {dot && (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: dot,
            }}
          />
        )}
        <Text size="sm" weight="medium" color="text-mid">
          {label}
        </Text>
      </Flex>
      <Text as="div" size="xl" weight="semibold" color="text-high">
        {value ?? "–"}
        {value !== null && (
          <Text size="sm" weight="regular" color="text-mid">
            /yr
          </Text>
        )}
      </Text>
      <Text as="div" size="sm" color="text-low">
        {detail}
      </Text>
    </Box>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default function ImpactKpis({
  summary,
  previous,
  previousLabel,
  debias,
  format,
}: {
  summary: ImpactSummary;
  previous: ImpactSummary | null;
  previousLabel: string;
  debias: boolean;
  format: (annual: number) => string;
}) {
  const change =
    previous && previous.total !== 0
      ? (summary.total - previous.total) / Math.abs(previous.total)
      : null;
  return (
    <Grid columns={{ initial: "2", md: "4" }} gap="3" mb="4">
      <KpiCard
        label="Won"
        dot="var(--green-9)"
        value={format(summary.won)}
        detail={plural(summary.wonCount, "experiment")}
      />
      <KpiCard
        label="Avoided loss"
        dot="var(--red-9)"
        value={format(summary.avoidedLoss)}
        detail={`${plural(summary.lostCount, "rolled-back experiment")}`}
      />
      <KpiCard
        label="Total program value"
        value={format(summary.total)}
        detail={
          change === null ? (
            "No value in the previous period"
          ) : (
            <>
              <span
                style={{
                  color: change >= 0 ? "var(--green-11)" : "var(--red-11)",
                  fontWeight: 600,
                }}
              >
                {change >= 0 ? "▲" : "▼"} {Math.abs(change * 100).toFixed(0)}%
              </span>{" "}
              {previousLabel}
            </>
          )
        }
      />
      <KpiCard
        label="Median impact per win"
        value={summary.medianWin === null ? null : format(summary.medianWin)}
        detail={debias ? "De-biased estimate" : "Raw measured lift"}
      />
    </Grid>
  );
}
