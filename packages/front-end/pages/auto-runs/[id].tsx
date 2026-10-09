import { useState } from "react";
import { useRouter } from "next/router";
import { Box, Container, Flex, Grid } from "@radix-ui/themes";
import { ApiAutoRun, autoRunMetaString } from "shared/validators";
import {
  createdByRun,
  TeardownFailure,
  teardownRun,
} from "@/services/importing/eppo/eppo-importing";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import {
  ExperimentFeatureCard,
  FeatureFlagFeatureCard,
} from "@/components/GetStarted/FeaturedCards";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
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

type Artifact = ApiAutoRun["artifacts"][number];
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
  "saved-group": { label: "Saved Group", href: (id) => `/saved-groups/${id}` },
  environment: { label: "Environment", href: () => "/environments" },
  tag: { label: "Tag", href: () => "/tags" },
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
          <TableColumnHeader style={{ width: "1%" }}>Review</TableColumnHeader>
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
  const reviewable = (a: Artifact) =>
    a.action !== "deleted" && a.action !== "failed";
  return (
    <Table variant="list">
      <TableHeader>
        <TableRow>
          <TableColumnHeader>Type</TableColumnHeader>
          <TableColumnHeader>Name</TableColumnHeader>
          <TableColumnHeader style={{ width: "1%" }}>Review</TableColumnHeader>
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
            {reviewable(a) ? (
              <ReviewCell href={KIND[a.kind].href(a.id)} />
            ) : (
              <TableCell />
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Removes everything an import run created, with a confirmation step
function DeleteRunButton({
  run,
  onDone,
}: {
  run: ApiAutoRun;
  onDone: () => Promise<unknown>;
}) {
  const { apiCall } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [failures, setFailures] = useState<TeardownFailure[]>([]);
  const created = createdByRun(run);
  return (
    <>
      {failures.length > 0 && (
        <Callout status="error" size="md" mb="4" style={{ width: "100%" }}>
          <Text weight="medium" as="div">
            {failures.length === 1
              ? "1 item couldn't be deleted"
              : `${failures.length} items couldn't be deleted`}
          </Text>
          <Box mt="1">
            {failures.map(({ artifact, error }) => (
              <Text as="div" size="sm" key={`${artifact.kind}:${artifact.id}`}>
                {KIND[artifact.kind].label} {artifact.label}: {error}
              </Text>
            ))}
          </Box>
        </Callout>
      )}
      {created.length > 0 ? (
        <Button
          color="red"
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(true)}
        >
          {created.length === 1
            ? "Delete the 1 item this run created"
            : `Delete the ${created.length} items this run created`}
        </Button>
      ) : (
        <span />
      )}
      {confirming && (
        <ConfirmDialog
          title="Delete everything this run created?"
          content="Everything this import created is deleted: Feature Flags, experiments, metrics, Fact Tables, Saved Groups, environments and tags, including any a later import has updated since. Items this run only updated are kept. This can't be undone."
          yesText="Delete"
          color="red"
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            const result = await teardownRun(run, apiCall);
            setFailures(result.failures);
            setConfirming(false);
            await onDone();
          }}
        />
      )}
    </>
  );
}

export default function AutoRunPage() {
  const router = useRouter();
  const { id } = router.query;

  const { data, error, isLoading, mutate } = useApi<{ autoRun: ApiAutoRun }>(
    `/auto-runs/${id}`,
    { shouldRun: () => router.isReady && !!id },
  );
  const { mutateDefinitions } = useDefinitions();
  const { refreshOrganization } = useUser();

  const run = data?.autoRun;
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
          Couldn&apos;t load this setup report: {error.message}
          {/not found/i.test(error.message)
            ? ". If this setup belongs to another organization, switch to it and reload."
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
          No setup run found with ID <code>{String(id)}</code>. It may belong to
          another organization.
        </Callout>
      </Container>
    );
  }

  const byDeveloper = run.artifacts.filter((a) => a.by === "developer");
  const byGrowthBook = run.artifacts.filter((a) => a.by === "growthbook");
  const failing = run.checks.filter((c) => !c.ok && c.required);
  const environment = autoRunMetaString(run.metadata, "environment");

  // An importer run is a record of what it created, not a setup to finish
  if (run.source === "eppo-import") {
    const failed = run.metadata.failed;
    const failedItems = run.artifacts.filter((a) => a.action === "failed");
    const imported = run.artifacts.filter((a) => a.action !== "failed");
    return (
      <Container
        size="3"
        px={{ initial: "2", xs: "4", sm: "7" }}
        py={{ initial: "1", xs: "3", sm: "6" }}
      >
        <PageHead
          breadcrumb={[
            { display: "Import your data", href: "/importing" },
            { display: "Eppo", href: "/importing/eppo" },
          ]}
        />
        <Box mt="4" mb="5">
          <Heading as="h1" size="2xl" mb="0">
            Eppo Import Report
          </Heading>
        </Box>
        {typeof failed === "number" && failed > 0 && (
          <Callout status="warning" size="md" mb="5">
            {failed === 1
              ? "1 item failed to import"
              : `${failed} items failed to import`}
            . Fetch from Eppo again to retry; imported items update in place
            instead of being created twice.
          </Callout>
        )}
        {imported.length > 0 ? (
          <Section
            title="Imported from Eppo"
            description="Open an item to review its settings. Importing again updates these instead of creating duplicates."
          >
            <SetUpTable artifacts={imported} />
          </Section>
        ) : (
          <Callout status="info">Nothing was imported in this run.</Callout>
        )}
        {failedItems.length > 0 && (
          <Section
            title="Failed to import"
            description="Why each item couldn't be imported. Fix the cause and import again."
          >
            <SetUpTable artifacts={failedItems} />
          </Section>
        )}
        <Flex justify="between" align="center" mt="6" gap="3" wrap="wrap">
          <DeleteRunButton
            run={run}
            onDone={() =>
              Promise.all([
                mutate(),
                mutateDefinitions(),
                refreshOrganization(),
              ])
            }
          />
          <LinkButton href="/">Continue to home</LinkButton>
        </Flex>
      </Container>
    );
  }

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
          {completed ? "Setup Complete" : "Setup Report"}
        </Heading>
      </Box>

      {failing.length > 0 && (
        <Callout status="warning" size="md" mb="5">
          <Text weight="medium" as="div">
            {failing.length === 1
              ? "1 required check failed"
              : `${failing.length} required checks failed`}
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
          title="Created During Setup"
          description="Open an item to review its settings."
        >
          <CreatedTable artifacts={byDeveloper} environment={environment} />
        </Section>
      )}

      {byGrowthBook.length > 0 && (
        <Section
          title="Configured by Your Agent"
          description="Review the attributes and other settings your coding agent configured."
        >
          <SetUpTable artifacts={byGrowthBook} />
        </Section>
      )}

      <Heading as="h2" mt="5" mb="2">
        Next Steps
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
