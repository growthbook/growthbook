import { useState } from "react";
import { useRouter } from "next/router";
import { Box, Container, Flex, Grid } from "@radix-ui/themes";
import { ApiAutoRun, autoRunMetaString } from "shared/validators";
import {
  createdByRun,
  TeardownFailure,
  teardownRun,
  updatedByLaterRuns,
} from "@/services/importing/eppo/eppo-importing";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import {
  ExperimentFeatureCard,
  FeatureFlagFeatureCard,
} from "@/components/GetStarted/FeaturedCards";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
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
  TableRowHeaderCell,
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
  { label: string; href: (id: string) => string; review?: string }
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
  environment: {
    label: "Environment",
    href: () => "/environments",
    review: "Environments",
  },
  tag: { label: "Tag", href: () => "/tags", review: "Tags" },
};

// Named resources stay Title Case; experiment, environment and tag are plain
const NOUN: Record<ArtifactKind, [string, string]> = {
  "sdk-connection": ["SDK Connection", "SDK Connections"],
  feature: ["Feature Flag", "Feature Flags"],
  experiment: ["experiment", "experiments"],
  attribute: ["attribute", "attributes"],
  metric: ["Fact Metric", "Fact Metrics"],
  "fact-table": ["Fact Table", "Fact Tables"],
  "saved-group": ["Saved Group", "Saved Groups"],
  environment: ["environment", "environments"],
  tag: ["tag", "tags"],
};

// Legacy SQL metrics and Fact Metrics share a kind; the id tells them apart
const typeLabel = (a: Pick<Artifact, "kind" | "id">) =>
  a.kind === "metric" && !a.id.startsWith("fact__")
    ? "Metric"
    : NOUN[a.kind][0];

function kindList(artifacts: Artifact[]): string {
  const counts = new Map<ArtifactKind, number>();
  artifacts.forEach((a) => counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1));
  const names = [...counts].map(([kind, n]) => NOUN[kind][n === 1 ? 0 : 1]);
  if (!names.length) return "Items";
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return artifacts.length === 1 ? `The ${list}` : list;
}

function NameCell({
  name,
  subtitle,
  error = false,
}: {
  name: string;
  subtitle?: string | null;
  error?: boolean;
}) {
  return (
    <Box>
      <Text weight="medium">{name}</Text>
      {subtitle && error && (
        <HelperText status="error" size="sm">
          {subtitle}
        </HelperText>
      )}
      {subtitle && !error && (
        <Text as="p" size="sm" color="text-mid">
          {subtitle}
        </Text>
      )}
    </Box>
  );
}

function ReviewCell({
  href,
  label = "Review",
}: {
  href: string;
  label?: string;
}) {
  return (
    <TableCell justify="end" style={{ whiteSpace: "nowrap" }}>
      <UiLink href={href}>{label}</UiLink>
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
function SetUpTable({
  artifacts,
  review = true,
}: {
  artifacts: Artifact[];
  review?: boolean;
}) {
  return (
    <Table variant="list">
      <TableHeader>
        <TableRow>
          <TableColumnHeader>Type</TableColumnHeader>
          <TableColumnHeader>Name</TableColumnHeader>
          {review && (
            <TableColumnHeader style={{ width: "1%" }}>
              Review
            </TableColumnHeader>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {artifacts.map((a) => (
          <TableRow key={`${a.kind}:${a.id}`}>
            <TableCell>
              <Text color="text-mid">{typeLabel(a)}</Text>
            </TableCell>
            <TableRowHeaderCell style={{ verticalAlign: "middle" }}>
              <NameCell
                name={a.label}
                subtitle={
                  a.detail === "Deleted" || a.action === "existing"
                    ? null
                    : a.detail
                }
                error={a.action === "failed"}
              />
            </TableRowHeaderCell>
            {review && (
              <ReviewCell
                href={KIND[a.kind].href(a.id)}
                label={KIND[a.kind].review}
              />
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DeleteRunButton({
  run,
  onDone,
}: {
  run: ApiAutoRun;
  onDone: (failures: TeardownFailure[]) => Promise<unknown>;
}) {
  const { apiCall } = useAuth();
  const { userId } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [confirming, setConfirming] = useState(false);
  const canRecord =
    !run.createdBy ||
    run.createdBy === userId ||
    permissionsUtil.canManageOrgSettings();
  const created = canRecord ? createdByRun(run) : [];
  const { data: runsData } = useApi<{ autoRuns: ApiAutoRun[] }>("/auto-runs", {
    shouldRun: () => created.length > 0,
  });
  const updatedLater = updatedByLaterRuns(run, runsData?.autoRuns ?? []);
  return (
    <>
      {created.length > 0 ? (
        <Button
          color="red"
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(true)}
        >
          {created.length === 1
            ? "Delete the item this run created"
            : `Delete the ${created.length} items this run created`}
        </Button>
      ) : (
        <span />
      )}
      {confirming && (
        <ConfirmDialog
          title="Delete everything this run created?"
          content={
            <>
              {`${kindList(created)} created by this import will be deleted. Items this run only updated are kept.`}
              {updatedLater.length > 0 &&
                ` A later import has since updated ${updatedLater.map((a) => `${typeLabel(a)} ${a.label}`).join(", ")}; ${updatedLater.length === 1 ? "it" : "they"} will be deleted too.`}{" "}
              This can&apos;t be undone.
            </>
          }
          yesText="Delete"
          color="red"
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            const result = await teardownRun(run, apiCall);
            setConfirming(false);
            await onDone(result.failures);
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
  const [failures, setFailures] = useState<TeardownFailure[]>([]);

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

  if (run.source === "eppo-import") {
    const failed = run.metadata.failed;
    const failedItems = run.artifacts.filter((a) => a.action === "failed");
    const deletedItems = run.artifacts.filter((a) => a.action === "deleted");
    const existingItems = run.artifacts.filter((a) => a.action === "existing");
    const imported = run.artifacts.filter(
      (a) =>
        a.action !== "failed" &&
        a.action !== "deleted" &&
        a.action !== "existing",
    );
    return (
      <Container
        size="3"
        px={{ initial: "2", xs: "4", sm: "7" }}
        py={{ initial: "1", xs: "3", sm: "6" }}
      >
        <PageHead
          breadcrumb={[
            { display: "Import Your Data", href: "/importing" },
            { display: "Eppo Importer", href: "/importing/eppo" },
            { display: "Eppo Import Report" },
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
            title="Imported From Eppo"
            description="Open an item to review its settings. Importing again updates created and updated items instead of creating duplicates."
          >
            <SetUpTable artifacts={imported} />
          </Section>
        ) : (
          <Callout status="info" mb="5">
            Nothing was imported in this run.
          </Callout>
        )}
        {existingItems.length > 0 && (
          <Section
            title="Already in GrowthBook"
            description="Left as they were."
          >
            <SetUpTable artifacts={existingItems} />
          </Section>
        )}
        {failedItems.length > 0 && (
          <Section
            title="Failed to Import"
            description="Why each item couldn't be imported. Fix the cause and import again."
          >
            <SetUpTable artifacts={failedItems} review={false} />
          </Section>
        )}
        {deletedItems.length > 0 && (
          <Section
            title="Deleted"
            description="Removed from GrowthBook. The next import creates them again."
          >
            <SetUpTable artifacts={deletedItems} review={false} />
          </Section>
        )}
        {failures.length > 0 && (
          <Callout status="error" size="md" mt="5">
            <Text weight="medium" as="div">
              {failures.length === 1
                ? "1 item couldn't be deleted"
                : `${failures.length} items couldn't be deleted`}
            </Text>
            <Box mt="1">
              {failures.map(({ artifact, error }) => (
                <Text
                  as="div"
                  size="sm"
                  key={`${artifact.kind}:${artifact.id}`}
                >
                  {typeLabel(artifact)} {artifact.label}: {error}
                </Text>
              ))}
            </Box>
          </Callout>
        )}
        <Flex justify="between" align="center" mt="6" gap="3" wrap="wrap">
          <DeleteRunButton
            run={run}
            onDone={(result) => {
              setFailures(result);
              return Promise.all([
                mutate(),
                mutateDefinitions(),
                refreshOrganization(),
              ]);
            }}
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
