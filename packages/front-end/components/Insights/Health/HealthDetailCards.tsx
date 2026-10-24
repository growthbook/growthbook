import { ReactNode } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { format } from "date-fns";
import { HealthDetails, HealthRatio } from "shared/enterprise";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { useUser } from "@/services/UserContext";

const days = (d: number | null) => (d === null ? "–" : `${Math.round(d)}d`);

function Card({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <Box className="appbox" mb="0" p="4" id={id} style={{ height: "100%" }}>
      <Heading as="h3" size="sm" mb="3">
        {title}
      </Heading>
      {children}
    </Box>
  );
}

function Stats({
  items,
}: {
  items: { label: string; value: ReactNode; color?: string }[];
}) {
  return (
    <Grid columns={String(items.length)} gap="3" mt="4">
      {items.map((s) => (
        <Box key={s.label}>
          <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>
            {s.value}
          </div>
          <Text size="sm" color="text-low">
            {s.label}
          </Text>
        </Box>
      ))}
    </Grid>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        padding: "2px 6px",
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
        background: `var(--${color}-a3)`,
        color: `var(--${color}-11)`,
      }}
    >
      {label}
    </span>
  );
}

function Columns({
  values,
  highlight,
  labels,
}: {
  values: number[];
  highlight: (i: number) => boolean;
  labels: string[];
}) {
  const max = Math.max(...values, 1);
  return (
    <Flex gap="2" align="end" style={{ height: 120 }}>
      {values.map((v, i) => (
        <Flex
          key={i}
          direction="column"
          align="center"
          justify="end"
          style={{ flex: 1, height: "100%" }}
        >
          <Text size="sm" color="text-mid">
            {v || ""}
          </Text>
          <Box
            style={{
              width: "100%",
              height: `${(v / max) * 80}%`,
              minHeight: v ? 2 : 0,
              borderRadius: "3px 3px 0 0",
              background: highlight(i) ? "var(--violet-9)" : "var(--violet-5)",
            }}
          />
          <Text size="sm" color="text-low">
            {labels[i]}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}

export function VelocityCard({
  monthlyStarts,
  startRate,
  started,
  runningNow,
  startRateChange,
}: {
  monthlyStarts: HealthDetails["monthlyStarts"];
  startRate: number;
  started: number;
  runningNow: number;
  startRateChange: number | null;
}) {
  return (
    <Card title="Experiment Velocity">
      <Text as="div" size="sm" color="text-low" mb="2">
        Experiments started per month
      </Text>
      <Columns
        values={monthlyStarts.map((m) => m.count)}
        highlight={(i) => i >= monthlyStarts.length - 3}
        labels={monthlyStarts.map((m) => format(m.month, "MMM"))}
      />
      <Stats
        items={[
          { label: "Start rate / mo", value: startRate.toFixed(1) },
          { label: "Started this period", value: started },
          { label: "Running now", value: runningNow },
          {
            label: "Change vs previous",
            value:
              startRateChange === null
                ? "–"
                : `${startRateChange >= 0 ? "+" : ""}${startRateChange.toFixed(1)} / mo`,
          },
        ]}
      />
    </Card>
  );
}

export function CycleTimeCard({ cycle }: { cycle: HealthDetails["cycle"] }) {
  const draft = cycle.medianDraftDays ?? 0;
  const run = cycle.medianRunDays ?? 0;
  const total = draft + run || 1;
  return (
    <Card title="Cycle Time">
      <Text as="div" size="sm" color="text-low" mb="1">
        Median time in each phase
      </Text>
      <Flex style={{ height: 22, borderRadius: 4, overflow: "hidden" }} mb="1">
        <Box
          style={{
            width: `${(draft / total) * 100}%`,
            background: "var(--violet-8)",
          }}
        />
        <Box
          style={{
            width: `${(run / total) * 100}%`,
            background: "var(--violet-10)",
          }}
        />
      </Flex>
      <Flex justify="between" mb="4">
        <Text size="sm" color="text-mid">
          Draft → launch {days(cycle.medianDraftDays)}
        </Text>
        <Text size="sm" color="text-mid">
          Launch → stop {days(cycle.medianRunDays)}
        </Text>
      </Flex>
      <Text as="div" size="sm" color="text-low" mb="2">
        Run duration, in weeks
      </Text>
      <Columns
        values={cycle.durationBins}
        highlight={(i) => i === cycle.medianBin}
        labels={cycle.durationBins.map((_, i) =>
          i === cycle.durationBins.length - 1 ? `${i}+` : String(i),
        )}
      />
      <Stats
        items={[
          { label: "Median duration", value: days(cycle.medianRunDays) },
          { label: "Draft → launch", value: days(cycle.medianDraftDays) },
          {
            label: "Drafts stuck > 30d",
            value: cycle.stuckDrafts,
            color: cycle.stuckDrafts ? "var(--amber-11)" : undefined,
          },
          { label: "Longest run", value: days(cycle.longestRunDays) },
        ]}
      />
    </Card>
  );
}

export function RunStabilityCard({
  stability,
}: {
  stability: HealthDetails["stability"];
}) {
  const total = stability.clean + stability.restarted + stability.dnf;
  const parts = [
    { label: "Clean runs", value: stability.clean, color: "green" },
    { label: "Restarted", value: stability.restarted, color: "amber" },
    { label: "Did not finish", value: stability.dnf, color: "red" },
  ];
  return (
    <Card title="Run Stability">
      {total === 0 ? (
        <Text color="text-mid">No completed experiments in this period.</Text>
      ) : (
        <>
          <Flex style={{ height: 10, borderRadius: 5, overflow: "hidden" }}>
            {parts.map((p) => (
              <Box
                key={p.label}
                style={{
                  width: `${(p.value / total) * 100}%`,
                  background: `var(--${p.color}-9)`,
                }}
              />
            ))}
          </Flex>
          <Grid columns="3" gap="3" mt="3">
            {parts.map((p) => (
              <Box key={p.label}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  {Math.round((p.value / total) * 100)}%
                </div>
                <Text size="sm" color="text-low">
                  {p.label} · {p.value}
                </Text>
              </Box>
            ))}
          </Grid>
        </>
      )}
      <Text as="div" size="sm" weight="semibold" color="text-mid" mt="4" mb="2">
        Most restarted
      </Text>
      {stability.mostRestarted.length === 0 ? (
        <Text size="sm" color="text-low">
          No restarts.
        </Text>
      ) : (
        <Flex direction="column" gap="2">
          {stability.mostRestarted.map((e) => (
            <Flex key={e.id} justify="between" align="center" gap="2">
              <Link href={`/experiment/${e.id}`} size="sm">
                {e.name}
              </Link>
              <Pill
                label={`${e.restarts} restart${e.restarts === 1 ? "" : "s"}`}
                color={e.restarts >= 2 ? "red" : "amber"}
              />
            </Flex>
          ))}
        </Flex>
      )}
      <Text as="p" size="sm" color="text-low" mt="3" mb="0">
        A restart is a new phase after the experiment started. It&apos;s usually
        a setup error.
      </Text>
    </Card>
  );
}

function ratioStatus(
  r: HealthRatio,
  {
    good,
    watch,
    lowerIsBetter = false,
  }: { good: number; watch: number; lowerIsBetter?: boolean },
) {
  if (!r.total)
    return { value: "–", pill: <Pill label="No data" color="gray" /> };
  const share = r.count / r.total;
  const score = lowerIsBetter ? 1 - share : share;
  const pill =
    score >= good ? (
      <Pill label="Good" color="green" />
    ) : score >= watch ? (
      <Pill label="Watch" color="amber" />
    ) : (
      <Pill label="Low" color="red" />
    );
  return { value: `${Math.round(share * 100)}%`, pill };
}

export function QualityDiagnosticsCard({
  diagnostics,
}: {
  diagnostics: HealthDetails["diagnostics"];
}) {
  const rows = [
    {
      label: "SRM checks passing",
      ...ratioStatus(diagnostics.srm, { good: 0.95, watch: 0.85 }),
      total: diagnostics.srm.total,
    },
    {
      label: "Reached target power",
      ...ratioStatus(diagnostics.power, { good: 0.8, watch: 0.6 }),
      total: diagnostics.power.total,
    },
    {
      label: "Hypothesis documented",
      ...ratioStatus(diagnostics.hypothesis, { good: 0.9, watch: 0.7 }),
      total: diagnostics.hypothesis.total,
    },
    {
      label: "Ended early / did not finish",
      ...ratioStatus(diagnostics.endedEarly, {
        good: 0.9,
        watch: 0.8,
        lowerIsBetter: true,
      }),
      total: diagnostics.endedEarly.total,
    },
  ];
  return (
    <Card title="Quality Diagnostics">
      <Flex direction="column">
        {rows.map((r) => (
          <Flex
            key={r.label}
            justify="between"
            align="center"
            py="2"
            style={{ borderBottom: "1px solid var(--gray-a4)" }}
          >
            <Box>
              <Text as="div">{r.label}</Text>
              <Text size="sm" color="text-low">
                {r.total} experiment{r.total === 1 ? "" : "s"} with data
              </Text>
            </Box>
            <Flex align="center" gap="3">
              <Text weight="semibold">{r.value}</Text>
              {r.pill}
            </Flex>
          </Flex>
        ))}
      </Flex>
    </Card>
  );
}

const ATTENTION_COLORS: Record<
  HealthDetails["attention"][number]["type"],
  string
> = {
  SRM: "red",
  Power: "amber",
  Stale: "amber",
  Draft: "amber",
};

const ATTENTION_CONTEXT: Record<
  HealthDetails["attention"][number]["type"],
  string
> = {
  SRM: "Sample ratio mismatch since",
  Power: "Underpowered since",
  Stale: "No results update since",
  Draft: "Draft since",
};

export function NeedsAttention({
  items,
}: {
  items: HealthDetails["attention"];
}) {
  const { getOwnerDisplay } = useUser();
  return (
    <Card title="Needs Attention" id="needs-attention">
      {items.length === 0 ? (
        <Text color="text-mid">Nothing needs attention right now.</Text>
      ) : (
        <Flex direction="column">
          {items.map((item) => (
            <Flex
              key={`${item.type}-${item.id}`}
              align="center"
              gap="3"
              py="2"
              style={{ borderBottom: "1px solid var(--gray-a4)" }}
            >
              <Box style={{ width: 56 }}>
                <Pill label={item.type} color={ATTENTION_COLORS[item.type]} />
              </Box>
              <Link href={`/experiment/${item.id}`}>{item.name}</Link>
              <Text size="sm" color="text-low">
                {ATTENTION_CONTEXT[item.type]} {format(item.since, "MMM d")}
                {item.owner ? ` · ${getOwnerDisplay(item.owner)}` : ""}
              </Text>
            </Flex>
          ))}
        </Flex>
      )}
    </Card>
  );
}
