import { ReactNode, useState } from "react";
import { Box, Flex, Grid, Separator } from "@radix-ui/themes";
import { date } from "shared/dates";
import { ApiContextualBanditInterface } from "shared/validators";
import type { RadixColor } from "@/ui/HelperText";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import DataList, { DataListItem } from "@/ui/DataList";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import ConfirmDialog from "@/ui/ConfirmDialog";
import SortedTags from "@/components/Tags/SortedTags";
import ContextualBanditResultsTable from "@/components/ContextualBandit/ContextualBanditResultsTable";

const STATUS_COLOR: Record<string, RadixColor> = {
  draft: "gray",
  running: "green",
  stopped: "amber",
};

/** Titled section-card header with an optional Edit affordance on the right. */
function SectionHeader({
  title,
  onEdit,
  editLabel = "Edit",
}: {
  title: string;
  onEdit?: () => void;
  editLabel?: string;
}) {
  return (
    <Flex justify="between" align="center" mb="3" gap="3">
      <Heading as="h2" size="medium" mb="0">
        {title}
      </Heading>
      {onEdit ? (
        <Button variant="ghost" onClick={onEdit}>
          {editLabel}
        </Button>
      ) : null}
    </Flex>
  );
}

/** One "Label: value" item in the header metadata row. */
function MetaItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Text size="small" color="text-mid">
      <Text as="span" color="text-low">
        {label}:{" "}
      </Text>
      {value}
    </Text>
  );
}

/**
 * CB-native detail page. Consumes the CB API shape directly — no experiment
 * SnapshotProvider/TabbedPage, no phases, no experiment-shaped adapter. Mirrors the experiment
 * detail page visually (header + Overview-tab sections) using Radix Themes for layout/typography
 * and @/ui wrappers for the mandated design-system components. Start/stop live in the header;
 * the leaf heatmap is owned by ContextualBanditResultsTable. Edit affordances render when their
 * callbacks are supplied (wired to the CB-native modals).
 */
export default function ContextualBanditDetailPage({
  cb,
  mutate,
  canRun = false,
  editMetrics,
  editVariations,
  editTargeting,
  editTags,
  editProject,
  duplicate,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  canRun?: boolean;
  editMetrics?: () => void;
  editVariations?: () => void;
  editTargeting?: () => void;
  editTags?: () => void;
  editProject?: () => void;
  duplicate?: () => void;
}) {
  const { getDatasourceById, getExperimentMetricById, projects } =
    useDefinitions();
  const { apiCall } = useAuth();
  const [confirmStop, setConfirmStop] = useState(false);

  const updateEndpoint = `/api/v1/contextual-bandits/${cb.id}`;

  const numVariations = cb.variations.length;
  const weightForIndex = (i: number): number =>
    cb.variationWeights?.[i] ?? (numVariations > 0 ? 1 / numVariations : 0);
  const formatWeight = (w: number): string =>
    new Intl.NumberFormat(undefined, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(w);

  const datasourceName =
    (cb.datasource && getDatasourceById(cb.datasource)?.name) || cb.datasource;
  const projectName =
    projects.find((p) => p.id === cb.project)?.name ?? cb.project ?? "None";
  const metricName = (id: string) => getExperimentMetricById(id)?.name ?? id;

  const coveragePct = cb.coverage != null ? Math.round(cb.coverage * 100) : 100;
  const splitLabel = cb.variations
    .map((_, i) => formatWeight(weightForIndex(i)))
    .join(" / ");

  const start = async () => {
    await apiCall(`${updateEndpoint}/start`, { method: "POST" });
    mutate();
  };
  const stop = async () => {
    await apiCall(`${updateEndpoint}/stop`, { method: "POST" });
    mutate();
  };

  const trafficData: DataListItem[] = [
    { label: "Traffic", value: `${coveragePct}% included · ${splitLabel}` },
    { label: "Assignment Attribute", value: cb.hashAttribute || "—" },
  ];

  const analysisData: DataListItem[] = [
    { label: "Data Source", value: datasourceName || "—" },
    { label: "Experiment Assignment Query", value: cb.exposureQueryId || "—" },
    {
      label: "Decision Metric",
      value: cb.goalMetrics.length ? metricName(cb.goalMetrics[0]) : "—",
    },
    {
      label: "Secondary Metrics",
      value: cb.secondaryMetrics.length
        ? cb.secondaryMetrics.map(metricName).join(", ")
        : "—",
    },
    {
      label: "Guardrail Metrics",
      value: cb.guardrailMetrics.length
        ? cb.guardrailMetrics.map(metricName).join(", ")
        : "—",
    },
    {
      label: "Contextual Attributes",
      value: cb.contextualAttributes.length
        ? cb.contextualAttributes.join(", ")
        : "—",
    },
  ];

  const banditSettingsData: DataListItem[] = [
    { label: "Tree Model", value: cb.treeModel },
    { label: "Max Leaves", value: String(cb.maxLeaves) },
    { label: "Min Users / Leaf", value: String(cb.minUsersPerLeaf) },
    { label: "Max Contexts", value: String(cb.maxContexts) },
  ];

  return (
    <Box>
      {/* Header — title, status, actions */}
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <Flex align="center" gap="3">
          <Heading as="h1" size="x-large" mb="0">
            {cb.name}
          </Heading>
          <Badge color={STATUS_COLOR[cb.status] ?? "gray"} label={cb.status} />
          {cb.archived ? <Badge color="gray" label="archived" /> : null}
        </Flex>
        <Flex align="center" gap="2">
          {duplicate ? (
            <Button variant="outline" onClick={duplicate}>
              Duplicate
            </Button>
          ) : null}
          {canRun && cb.status === "draft" ? (
            <Button onClick={start}>Start</Button>
          ) : null}
          {canRun && cb.status === "running" ? (
            <Button
              variant="outline"
              color="red"
              onClick={() => setConfirmStop(true)}
            >
              Stop
            </Button>
          ) : null}
        </Flex>
      </Flex>

      {/* Header — metadata line */}
      <Flex gap="4" wrap="wrap" align="center" mt="2">
        <MetaItem label="Project" value={projectName} />
        {editProject ? (
          <Button variant="ghost" onClick={editProject}>
            Edit
          </Button>
        ) : null}
        <MetaItem label="Experiment Key" value={cb.trackingKey} />
        <MetaItem label="Created" value={date(cb.dateCreated)} />
        <MetaItem label="Owner" value={cb.ownerEmail || cb.owner || "—"} />
      </Flex>

      {/* Header — tags */}
      <Flex align="center" gap="2" mt="2" mb="4" wrap="wrap">
        {cb.tags.length ? (
          <SortedTags tags={cb.tags} />
        ) : (
          <Text size="small" color="text-low">
            No tags
          </Text>
        )}
        {editTags ? (
          <Button variant="ghost" onClick={editTags}>
            + Add
          </Button>
        ) : null}
      </Flex>

      {/* Overview */}
      <Frame>
        <SectionHeader title="Overview" />
        <DataList
          data={[{ label: "Description", value: cb.description || "—" }]}
          columns={1}
        />
      </Frame>

      {/* Implementation — Variations & Values */}
      <Frame>
        <SectionHeader
          title="Implementation"
          onEdit={editVariations}
          editLabel="Edit Variations"
        />
        <Heading as="h3" size="small" mb="2">
          Variations &amp; Values
        </Heading>
        <Grid
          columns={{ initial: "1", sm: String(Math.max(numVariations, 1)) }}
          gap="3"
        >
          {cb.variations.map((v, i) => (
            <Box key={v.id} className="appbox" p="3" mb="0">
              <Text weight="medium">{v.name}</Text>
              <Box mt="1">
                <Text size="small" color="text-low">
                  {v.key}
                </Text>
              </Box>
              <Box mt="2">
                <Text size="small" color="text-low">
                  Initial weight: {formatWeight(weightForIndex(i))}
                </Text>
              </Box>
            </Box>
          ))}
        </Grid>
      </Frame>

      {/* Traffic Allocation */}
      <Frame>
        <SectionHeader title="Traffic Allocation" onEdit={editTargeting} />
        <DataList data={trafficData} columns={2} />
      </Frame>

      {/* Targeting */}
      <Frame>
        <SectionHeader title="Targeting" onEdit={editTargeting} />
        {cb.condition ? (
          <DataList
            data={[{ label: "Targeting Condition", value: cb.condition }]}
            columns={1}
          />
        ) : (
          <Text color="text-low">
            No targeting; this contextual bandit will include all traffic.
          </Text>
        )}
      </Frame>

      {/* Analysis Settings */}
      <Frame>
        <SectionHeader
          title="Analysis Settings"
          onEdit={editMetrics}
          editLabel="Edit Metrics"
        />
        <DataList data={analysisData} columns={3} />
        <Separator my="4" size="4" />
        <DataList data={banditSettingsData} columns={4} />
      </Frame>

      {/* Current Results — leaf heatmap */}
      <Frame>
        <Heading as="h2" size="medium" mb="3">
          Current Results
        </Heading>
        <ContextualBanditResultsTable cb={cb} mutate={mutate} />
      </Frame>

      {confirmStop ? (
        <ConfirmDialog
          title="Stop this Contextual Bandit?"
          content="Stopping freezes the current variation weights. You can review results but the bandit will no longer reweight."
          yesText="Stop"
          onConfirm={async () => {
            await stop();
            setConfirmStop(false);
          }}
          onCancel={() => setConfirmStop(false)}
        />
      ) : null}
    </Box>
  );
}
