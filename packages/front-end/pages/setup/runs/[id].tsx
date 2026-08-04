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
import Text from "@/ui/Text";
import useApi from "@/hooks/useApi";
import { useCelebration } from "@/hooks/useCelebration";
import {
  ExperimentFeatureCard,
  FeatureFlagFeatureCard,
} from "@/components/GetStarted/FeaturedCards";

type ArtifactKind = ApiSetupRun["artifacts"][number]["kind"];

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

function ArtifactRow({
  artifact,
}: {
  artifact: ApiSetupRun["artifacts"][number];
}) {
  const href = hrefFor(artifact.kind, artifact.id);
  return (
    <Flex align="start" gap="3" py="3" className="border-bottom">
      <Box style={{ minWidth: 0, flex: 1 }}>
        <Flex align="center" gap="2" mb="1">
          <Text weight="medium">{artifact.label}</Text>
          <Badge label={KIND_LABEL[artifact.kind]} color="violet" />
        </Flex>
        {artifact.detail ? (
          <Text size="small" color="text-mid">
            {artifact.detail}
          </Text>
        ) : null}
      </Box>
      {href ? (
        <Link href={href} className="text-nowrap">
          Open →
        </Link>
      ) : null}
    </Flex>
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
    // Only for a run that actually finished. Confetti over a half-done install is
    // the same dishonesty as a green tick over a failing check.
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

  return (
    <div className="contents container pagecontents pagecontents-fluid">
      <PageHead breadcrumb={[{ display: "Set Up", href: "/setup" }]} />

      <Box mb="5">
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

      {byDeveloper.length > 0 && (
        <Frame mb="4">
          <Heading as="h2" size="small" mb="2">
            What You Created
          </Heading>
          {byDeveloper.map((a) => (
            <ArtifactRow key={`${a.kind}:${a.id}`} artifact={a} />
          ))}
        </Frame>
      )}

      {byGrowthBook.length > 0 && (
        <Frame mb="4">
          <Heading as="h2" size="small" mb="1">
            What We Set Up for You
          </Heading>
          <Text size="small" color="text-mid">
            Derived from your code and warehouse during setup.
          </Text>
          <Box mt="2">
            {byGrowthBook.map((a) => (
              <ArtifactRow key={`${a.kind}:${a.id}`} artifact={a} />
            ))}
          </Box>
        </Frame>
      )}

      {failing.length > 0 && (
        <Callout status="warning" mb="4">
          <Text weight="medium">
            {failing.length === 1
              ? "1 thing still to finish"
              : `${failing.length} things still to finish`}
          </Text>
          <Box mt="2">
            {failing.map((c) => (
              <Text as="div" key={c.name} size="small">
                {c.name}
              </Text>
            ))}
          </Box>
          <Text as="div" size="small">
            Ask your coding agent to finish these, then re-run{" "}
            <code>gb-check</code>.
          </Text>
        </Callout>
      )}

      <Box mb="3">
        <Heading as="h2" size="small">
          What Next
        </Heading>
      </Box>
      <Grid columns={{ initial: "1fr", xs: "1fr 1fr" }} gap="3">
        {run.intent === "experiment" ? (
          <>
            <ExperimentFeatureCard />
            <FeatureFlagFeatureCard />
          </>
        ) : (
          <>
            <FeatureFlagFeatureCard />
            <ExperimentFeatureCard />
          </>
        )}
      </Grid>
    </div>
  );
}
