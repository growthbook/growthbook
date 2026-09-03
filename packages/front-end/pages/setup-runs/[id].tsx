import { useRouter } from "next/router";
import { Box, Container, Flex, Grid } from "@radix-ui/themes";
import { ApiSetupRun, setupRunMetaString } from "shared/validators";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import {
  ExperimentFeatureCard,
  FeatureFlagFeatureCard,
} from "@/components/GetStarted/FeaturedCards";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import UiLink from "@/ui/Link";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import useApi from "@/hooks/useApi";

type Artifact = ApiSetupRun["artifacts"][number];
type ArtifactKind = Artifact["kind"];

// Type label and destination per kind. No icon: an icon is the one thing that
// cannot come from the API, so every new artifact type would need an entry in this
// file before it could render at all. The Type column already names it.
const KIND: Record<
  ArtifactKind,
  { label: string; href: (id: string) => string }
> = {
  "sdk-connection": { label: "SDK Connection", href: (id) => `/sdks/${id}` },
  feature: { label: "Feature Flag", href: (id) => `/features/${id}` },
  // Singular. /experiments is the list page.
  experiment: { label: "Experiment", href: (id) => `/experiment/${id}` },
  attribute: {
    label: "Attribute",
    href: (id) => `/attributes/${encodeURIComponent(id)}`,
  },
  metric: {
    label: "Metric",
    // Fact metrics have their own page; /metric is the legacy SQL-metric route.
    href: (id) =>
      id.startsWith("fact__") ? `/fact-metrics/${id}` : `/metric/${id}`,
  },
  "fact-table": { label: "Fact Table", href: (id) => `/fact-tables/${id}` },
};

function NameCell({
  name,
  subtitle,
}: {
  name: string;
  subtitle?: string | null;
}) {
  return (
    <Box>
      <Text weight="medium">{name}</Text>
      {subtitle && (
        <Text as="p" size="sm" color="text-mid">
          {subtitle}
        </Text>
      )}
    </Box>
  );
}

function ReviewCell({ href }: { href: string }) {
  return (
    <TableCell justify="end" style={{ whiteSpace: "nowrap" }}>
      <UiLink href={href}>Review</UiLink>
    </TableCell>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Box mb="5">
      <Heading as="h2" size="lg" weight="semibold" mb="2">
        {title}
      </Heading>
      <Text as="p" color="text-mid" mb="4">
        {description}
      </Text>
      {children}
    </Box>
  );
}

/** Name | Type | Environment | Review — environment applies to both row types here. */
function CreatedTable({
  artifacts,
  environment,
}: {
  artifacts: Artifact[];
  environment: string | null;
}) {
  return (
    <Table variant="list">
      <TableHeader>
        <TableRow>
          <TableColumnHeader>Name</TableColumnHeader>
          <TableColumnHeader>Type</TableColumnHeader>
          <TableColumnHeader>Environment</TableColumnHeader>
          <TableColumnHeader style={{ width: "1%" }} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {artifacts.map((a) => (
          <TableRow key={`${a.kind}:${a.id}`}>
            <TableCell style={{ verticalAlign: "middle" }}>
              <NameCell name={a.label} subtitle={a.detail} />
            </TableCell>
            <TableCell>
              <Text color="text-mid">{KIND[a.kind].label}</Text>
            </TableCell>
            <TableCell>
              {environment && <Text color="text-mid">{environment}</Text>}
            </TableCell>
            <ReviewCell href={KIND[a.kind].href(a.id)} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Type | Name | Review — no environment column; it doesn't apply to these. */
function SetUpTable({ artifacts }: { artifacts: Artifact[] }) {
  return (
    <Table variant="list">
      <TableHeader>
        <TableRow>
          <TableColumnHeader>Type</TableColumnHeader>
          <TableColumnHeader>Name</TableColumnHeader>
          <TableColumnHeader style={{ width: "1%" }} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {artifacts.map((a) => (
          <TableRow key={`${a.kind}:${a.id}`}>
            <TableCell>
              <Text color="text-mid">{KIND[a.kind].label}</Text>
            </TableCell>
            <TableCell style={{ verticalAlign: "middle" }}>
              <NameCell name={a.label} subtitle={a.detail} />
            </TableCell>
            <ReviewCell href={KIND[a.kind].href(a.id)} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
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

  // Distinguish the three states rather than showing one overlay for all of them.
  // A loading spinner that never resolves is indistinguishable from a blank page,
  // which makes it impossible to tell a failed request from a missing record.
  if (error) {
    return (
      <Container
        size="3"
        px={{ initial: "2", xs: "4", sm: "7" }}
        py={{ initial: "1", xs: "3", sm: "6" }}
      >
        <Callout status="error">
          Couldn&apos;t load this setup run: {error.message}
          {/not found/i.test(error.message)
            ? ". If the setup ran in another of your organizations, switch to it and reload."
            : ""}
        </Callout>
      </Container>
    );
  }
  if (!router.isReady || isLoading) return <LoadingOverlay />;
  if (!run) {
    return (
      <Container
        size="3"
        px={{ initial: "2", xs: "4", sm: "7" }}
        py={{ initial: "1", xs: "3", sm: "6" }}
      >
        <Callout status="warning">
          No setup run with id <code>{String(id)}</code>. It may belong to
          another organization.
        </Callout>
      </Container>
    );
  }

  const byDeveloper = run.artifacts.filter((a) => a.by === "developer");
  const byGrowthBook = run.artifacts.filter((a) => a.by === "growthbook");
  const failing = run.checks.filter((c) => !c.ok && c.required);
  const environment = setupRunMetaString(run.metadata, "environment");

  return (
    <Container
      size="3"
      px={{ initial: "2", xs: "4", sm: "7" }}
      py={{ initial: "1", xs: "3", sm: "6" }}
    >
      <PageHead
        breadcrumb={[{ display: "Get Started", href: "/getstarted" }]}
      />

      <Box mt="4" mb="5">
        <Heading as="h1" size="2xl" mb="0">
          {completed ? "Setup Complete!" : "Almost There"}
        </Heading>
      </Box>

      {failing.length > 0 && (
        <Callout status="warning" size="md" mb="5">
          <Text weight="medium" as="div">
            {failing.length === 1
              ? "1 step still to finish"
              : `${failing.length} steps still to finish`}
          </Text>
          <Box mt="1">
            {failing.map((c) => (
              <Text as="div" size="sm" key={c.name}>
                {c.name}
              </Text>
            ))}
          </Box>
        </Callout>
      )}

      {byDeveloper.length > 0 && (
        <Section
          title="What You Created"
          description="The SDK Connection and Feature Flag created during setup."
        >
          <CreatedTable artifacts={byDeveloper} environment={environment} />
        </Section>
      )}

      {byGrowthBook.length > 0 && (
        <Section
          title="What We Set Up for You"
          description="A quick preview of what the AI agent found and configured. Take a look and confirm everything looks right."
        >
          <SetUpTable artifacts={byGrowthBook} />
        </Section>
      )}

      <Heading as="h2" mt="5" mb="2">
        What Do You Want to Do Next?
      </Heading>
      {/* Both cards hang a decorative image off their right edge with mr="-9".
          Clipped here so that negative margin cannot widen the page and push
          content under the sidebar. */}
      <Box overflow="hidden">
        <Grid columns={{ initial: "1fr", xs: "1fr 1fr" }} gap="3" mb="3">
          <FeatureFlagFeatureCard />
          <ExperimentFeatureCard />
        </Grid>
      </Box>

      <Flex justify="end" mt="4">
        <LinkButton href="/getstarted">Exit setup</LinkButton>
      </Flex>
    </Container>
  );
}
