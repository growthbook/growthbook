import { useRouter } from "next/router";
import Link from "next/link";
import { useEffect } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { ApiSetupRun } from "shared/validators";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import useApi from "@/hooks/useApi";
import { useCelebration } from "@/hooks/useCelebration";

type Artifact = ApiSetupRun["artifacts"][number];
type ArtifactKind = Artifact["kind"];

const KIND_LABEL: Record<ArtifactKind, string> = {
  "sdk-connection": "SDK Connection",
  feature: "Feature Flag",
  experiment: "Experiment",
  attribute: "Attribute",
  metric: "Metric",
  "fact-table": "Fact Table",
};

function hrefFor(kind: ArtifactKind, id: string): string | null {
  switch (kind) {
    case "sdk-connection":
      return `/sdks/${id}`;
    case "feature":
      return `/features/${id}`;
    // Singular. /experiments is the list page.
    case "experiment":
      return `/experiment/${id}`;
    case "attribute":
      return "/attributes";
    case "metric":
      return `/metric/${id}`;
    case "fact-table":
      return `/fact-tables/${id}`;
    default:
      return null;
  }
}

function ArtifactList({ artifacts }: { artifacts: Artifact[] }) {
  return (
    <>
      {artifacts.map((a, i) => {
        const href = hrefFor(a.kind, a.id);
        return (
          <Flex
            key={`${a.kind}:${a.id}`}
            align="center"
            gap="3"
            py="3"
            className={i > 0 ? "border-top" : undefined}
          >
            <Box style={{ minWidth: 0, flex: 1 }}>
              <Flex align="center" gap="2" mb="1" wrap="wrap">
                <Text weight="medium">{a.label}</Text>
                <Badge
                  label={KIND_LABEL[a.kind]}
                  color="violet"
                  radius="full"
                />
              </Flex>
              {a.detail && (
                <Text size="small" color="text-mid" as="div">
                  {a.detail}
                </Text>
              )}
            </Box>
            {href && (
              <Link href={href} style={{ whiteSpace: "nowrap" }}>
                Open →
              </Link>
            )}
          </Flex>
        );
      })}
    </>
  );
}

export default function SetupRunPage() {
  const router = useRouter();
  const { id } = router.query;

  const { data, error } = useApi<{ setupRun: ApiSetupRun }>(
    `/api/v1/setup-runs/${id}`,
    { shouldRun: () => !!id },
  );

  const run = data?.setupRun;
  const completed = run?.outcome === "completed";

  const startCelebration = useCelebration(1);
  useEffect(() => {
    // Only for a run whose checks actually passed. Confetti over a half-done
    // install is the same dishonesty as a green tick over a failing check.
    if (completed) startCelebration();
  }, [completed, startCelebration]);

  if (error) {
    return (
      <div className="contents container pagecontents">
        <Callout status="error">{error.message}</Callout>
      </div>
    );
  }
  if (!run) return <LoadingOverlay />;

  const byDeveloper = run.artifacts.filter((a) => a.by === "developer");
  const byGrowthBook = run.artifacts.filter((a) => a.by === "growthbook");
  const failing = run.checks.filter((c) => !c.ok && c.required);
  const appName = run.appName || "your app";

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
      <PageHead breadcrumb={[{ display: "Set Up", href: "/setup" }]} />

      <Box mb="4">
        <Heading as="h1" size="x-large" mb="1">
          {completed
            ? `GrowthBook is live in ${appName}`
            : `Almost there in ${appName}`}
        </Heading>
        <Text color="text-mid">
          {completed
            ? "Everything below now exists. Each item links straight to it."
            : "The pieces below exist, but a few things still need finishing."}
        </Text>
      </Box>

      {failing.length > 0 && (
        <Callout status="warning" size="md" mb="4">
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
        <Frame mb="4">
          <Heading as="h2" size="small" mb="2">
            What You Created
          </Heading>
          <ArtifactList artifacts={byDeveloper} />
        </Frame>
      )}

      {byGrowthBook.length > 0 && (
        <Frame mb="4">
          <Heading as="h2" size="small" mb="1">
            What We Set Up for You
          </Heading>
          <Box mb="2">
            <Text size="small" color="text-mid" as="div">
              Found in your code during setup.
            </Text>
          </Box>
          <ArtifactList artifacts={byGrowthBook} />
        </Frame>
      )}

      <Heading as="h2" size="small" mb="2">
        What Next
      </Heading>
      <Grid columns={{ initial: "1fr", sm: "1fr 1fr" }} gap="3" mb="4">
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
