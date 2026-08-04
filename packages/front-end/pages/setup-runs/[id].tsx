import { useRouter } from "next/router";
import Link from "next/link";
import { useEffect, ReactNode } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { formatDistanceToNow } from "date-fns";
import {
  PiChartBarFill,
  PiFlagFill,
  PiFlaskFill,
  PiPlugsConnectedFill,
  PiTableFill,
  PiTagFill,
} from "react-icons/pi";
import { ApiSetupRun } from "shared/validators";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import useApi from "@/hooks/useApi";
import { useCelebration } from "@/hooks/useCelebration";

type Artifact = ApiSetupRun["artifacts"][number];
type ArtifactKind = Artifact["kind"];

const KIND: Record<
  ArtifactKind,
  { label: string; icon: ReactNode; cta: string; href: (id: string) => string }
> = {
  "sdk-connection": {
    label: "SDK Connection",
    icon: <PiPlugsConnectedFill />,
    cta: "Open",
    href: (id) => `/sdks/${id}`,
  },
  feature: {
    label: "Feature Flag",
    icon: <PiFlagFill />,
    cta: "Open the Feature Flag",
    href: (id) => `/features/${id}`,
  },
  experiment: {
    label: "Experiment",
    icon: <PiFlaskFill />,
    cta: "Open",
    // Singular. /experiments is the list page.
    href: (id) => `/experiment/${id}`,
  },
  attribute: {
    label: "Attribute",
    icon: <PiTagFill />,
    cta: "Review",
    href: () => "/attributes",
  },
  metric: {
    label: "Metric",
    icon: <PiChartBarFill />,
    cta: "Review",
    href: (id) => `/metric/${id}`,
  },
  "fact-table": {
    label: "Fact Table",
    icon: <PiTableFill />,
    cta: "Review",
    href: (id) => `/fact-tables/${id}`,
  },
};

function IconTile({ kind }: { kind: ArtifactKind }) {
  return (
    <Flex
      align="center"
      justify="center"
      style={{
        width: 30,
        height: 30,
        borderRadius: 7,
        flexShrink: 0,
        background: "var(--violet-a3)",
        color: "var(--violet-11)",
        fontSize: 15,
      }}
    >
      {KIND[kind].icon}
    </Flex>
  );
}

function SectionHeading({
  title,
  eyebrow,
  count,
}: {
  title: string;
  eyebrow: string;
  count?: string;
}) {
  return (
    <Flex align="baseline" gap="3" mb="2">
      <Heading as="h2" size="medium" mb="0">
        {title}
      </Heading>
      <Box
        style={{
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
          letterSpacing: ".06em",
        }}
      >
        <Text size="small" color="text-low" textTransform="uppercase">
          {eyebrow}
        </Text>
      </Box>
      {count && (
        <Box ml="auto">
          <Text size="small" color="text-low">
            {count}
          </Text>
        </Box>
      )}
    </Flex>
  );
}

function ArtifactRow({
  artifact,
  first,
}: {
  artifact: Artifact;
  first: boolean;
}) {
  const kind = KIND[artifact.kind];
  return (
    <Flex
      align="start"
      gap="3"
      py="3"
      className={first ? undefined : "border-top"}
    >
      <IconTile kind={artifact.kind} />
      <Box style={{ minWidth: 0, flex: 1 }}>
        <Text weight="semibold" as="div">
          {kind.label} · {artifact.label}
        </Text>
        {artifact.detail && (
          <Text size="small" color="text-mid" as="div">
            {artifact.detail}
          </Text>
        )}
      </Box>
      <Link
        href={kind.href(artifact.id)}
        style={{ whiteSpace: "nowrap", flexShrink: 0 }}
      >
        {kind.cta} →
      </Link>
    </Flex>
  );
}

function summarise(artifacts: Artifact[]): string {
  const counts = new Map<ArtifactKind, number>();
  artifacts.forEach((a) => counts.set(a.kind, (counts.get(a.kind) || 0) + 1));
  return [...counts.entries()]
    .map(
      ([kind, n]) =>
        `${n} ${KIND[kind].label.toLowerCase()}${n > 1 ? "s" : ""}`,
    )
    .join(" · ");
}

export default function SetupRunPage() {
  const router = useRouter();
  const { id } = router.query;

  const { data, error, isLoading } = useApi<{ setupRun: ApiSetupRun }>(
    `/setup-runs/${id}`,
    { shouldRun: () => router.isReady && !!id },
  );

  const run = data?.setupRun;
  const completed = run?.outcome === "completed";

  const startCelebration = useCelebration(1);
  useEffect(() => {
    // Only for a run whose checks actually passed. Confetti over a half-done
    // install is the same dishonesty as a green tick over a failing check.
    if (completed) startCelebration();
  }, [completed, startCelebration]);

  // Distinguish the three states rather than showing one overlay for all of them.
  // A loading spinner that never resolves is indistinguishable from a blank page,
  // which makes it impossible to tell a failed request from a missing record.
  if (error) {
    return (
      <div className="contents container pagecontents">
        <Callout status="error">
          Couldn&apos;t load this setup run: {error.message}
        </Callout>
      </div>
    );
  }
  if (!router.isReady || isLoading) return <LoadingOverlay />;
  if (!run) {
    return (
      <div className="contents container pagecontents">
        <Callout status="warning">
          No setup run with id <code>{String(id)}</code>. It may belong to
          another organization.
        </Callout>
      </div>
    );
  }

  const byDeveloper = run.artifacts.filter((a) => a.by === "developer");
  const byGrowthBook = run.artifacts.filter((a) => a.by === "growthbook");
  const failing = run.checks.filter((c) => !c.ok && c.required);
  const appName = run.appName || "your app";

  const when = formatDistanceToNow(new Date(run.dateCreated), {
    addSuffix: true,
  });
  const from = run.agent === "claudecode" ? "Claude Code" : run.agent;

  const flag = byDeveloper.find((a) => a.kind === "feature");
  const steps = [
    flag
      ? {
          title: "Turn the Feature Flag on",
          body: `Change the default value of ${flag.id}, then reload your app to see it take effect.`,
          href: `/features/${flag.id}`,
          cta: "Open the Feature Flag",
        }
      : {
          title: "Create a Feature Flag",
          body: "Wrap something in a flag you can turn on and off without a deploy.",
          href: "/features",
          cta: "Create a Feature Flag",
        },
    {
      title: "Run an Experiment",
      body: "Measure which version wins. Your SDK is already wired, so this needs no code changes.",
      href: "/experiments",
      cta: "Set up an Experiment",
    },
  ];
  // Lead with what they came for.
  if (run.intent === "experiment") steps.reverse();

  return (
    <div className="contents container pagecontents">
      <PageHead
        breadcrumb={[{ display: "Get Started", href: "/getstarted" }]}
      />

      <Box mb="5">
        <Heading as="h1" size="2x-large" mb="2">
          {completed ? "GrowthBook is live in " : "Almost there in "}
          <span style={{ color: "var(--violet-11)" }}>{appName}</span>
        </Heading>
        <Text color="text-mid">
          Set up {when}
          {from ? ` from ${from}` : ""}.{" "}
          {completed
            ? "Here's everything that now exists — every item links straight to it."
            : "A few things still need finishing."}
        </Text>
      </Box>

      {failing.length > 0 && (
        <Callout status="warning" size="md" mb="5">
          <Text weight="medium" as="div">
            {failing.length === 1
              ? "1 thing still to finish"
              : `${failing.length} things still to finish`}
          </Text>
          <Box mt="1">
            {failing.map((c) => (
              <Text as="div" key={c.name} size="small">
                {c.name}
              </Text>
            ))}
          </Box>
        </Callout>
      )}

      {byDeveloper.length > 0 && (
        <Box mb="5">
          <SectionHeading title="What You Created" eyebrow="your choices" />
          <Frame mb="0" py="3">
            {byDeveloper.map((a, i) => (
              <ArtifactRow
                key={`${a.kind}:${a.id}`}
                artifact={a}
                first={i === 0}
              />
            ))}
          </Frame>
        </Box>
      )}

      {byGrowthBook.length > 0 && (
        <Box mb="5">
          <SectionHeading
            title="What We Set Up for You"
            eyebrow="from your code"
            count={summarise(byGrowthBook)}
          />
          <Frame mb="0" py="3">
            {byGrowthBook.map((a, i) => (
              <ArtifactRow
                key={`${a.kind}:${a.id}`}
                artifact={a}
                first={i === 0}
              />
            ))}
          </Frame>
        </Box>
      )}

      <SectionHeading title="What Next" eyebrow="one step at a time" />
      <Grid columns={{ initial: "1fr", sm: "1fr 1fr" }} gap="3">
        {steps.map((s, i) => (
          <Frame key={s.title} mb="0">
            <Heading as="h3" size="small" mb="1">
              {s.title}
            </Heading>
            <Box mb="3">
              <Text size="small" color="text-mid" as="div">
                {s.body}
              </Text>
            </Box>
            <LinkButton href={s.href} variant={i === 0 ? "solid" : "outline"}>
              {s.cta}
            </LinkButton>
          </Frame>
        ))}
      </Grid>
    </div>
  );
}
