import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ApiContextualBanditInterface } from "shared/validators";
import type { RadixColor } from "@/ui/HelperText";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import DataList, { DataListItem } from "@/ui/DataList";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Text from "@/ui/Text";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import ContextualBanditResultsTable from "@/components/ContextualBandit/ContextualBanditResultsTable";

const STATUS_COLOR: Record<string, RadixColor> = {
  draft: "gray",
  running: "green",
  stopped: "amber",
};

/**
 * Lean CB-native detail page. Consumes the CB API shape directly — no experiment
 * SnapshotProvider/TabbedPage, no phases, no experiment-shaped adapter. Start/stop live in the
 * header; refresh is owned by the results table. Edit affordances are rendered when their
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

  const start = async () => {
    await apiCall(`${updateEndpoint}/start`, { method: "POST" });
    mutate();
  };
  const stop = async () => {
    await apiCall(`${updateEndpoint}/stop`, { method: "POST" });
    mutate();
  };

  const overviewData: DataListItem[] = [
    { label: "Status", value: cb.status },
    { label: "Owner", value: cb.ownerEmail || cb.owner || "—" },
    { label: "Project", value: projectName },
    { label: "Tags", value: cb.tags.length ? cb.tags.join(", ") : "—" },
    { label: "Tracking Key", value: cb.trackingKey },
    {
      label: "Description",
      value: cb.description || "—",
    },
  ];

  const setupData: DataListItem[] = [
    { label: "Data Source", value: datasourceName || "—" },
    { label: "Assignment Query", value: cb.exposureQueryId || "—" },
    { label: "Hash Attribute", value: cb.hashAttribute || "—" },
    {
      label: "Coverage",
      value: cb.coverage != null ? `${Math.round(cb.coverage * 100)}%` : "100%",
    },
    {
      label: "Contextual Attributes",
      value: cb.contextualAttributes.length
        ? cb.contextualAttributes.join(", ")
        : "—",
    },
    { label: "Targeting Condition", value: cb.condition || "—" },
  ];

  const metricsData: DataListItem[] = [
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
  ];

  const banditSettingsData: DataListItem[] = [
    { label: "Tree Model", value: cb.treeModel },
    { label: "Max Leaves", value: String(cb.maxLeaves) },
    { label: "Min Users / Leaf", value: String(cb.minUsersPerLeaf) },
    { label: "Max Contexts", value: String(cb.maxContexts) },
  ];

  return (
    <Box>
      <Flex justify="between" align="center" mb="4" gap="3" wrap="wrap">
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

      <Frame>
        <Flex justify="between" align="center" mb="3">
          <Heading as="h2" size="medium" mb="0">
            Overview
          </Heading>
          {editTags || editProject ? (
            <Flex gap="2">
              {editTags ? (
                <Button variant="ghost" onClick={editTags}>
                  Edit Tags
                </Button>
              ) : null}
              {editProject ? (
                <Button variant="ghost" onClick={editProject}>
                  Edit Project
                </Button>
              ) : null}
            </Flex>
          ) : null}
        </Flex>
        <DataList data={overviewData} columns={3} />
      </Frame>

      <Frame>
        <Flex justify="between" align="center" mb="3">
          <Heading as="h2" size="medium" mb="0">
            Setup
          </Heading>
          {editTargeting ? (
            <Button variant="ghost" onClick={editTargeting}>
              Edit Targeting
            </Button>
          ) : null}
        </Flex>
        <DataList data={setupData} columns={3} />
      </Frame>

      <Frame>
        <Flex justify="between" align="center" mb="3">
          <Heading as="h2" size="medium" mb="0">
            Metrics
          </Heading>
          {editMetrics ? (
            <Button variant="ghost" onClick={editMetrics}>
              Edit Metrics
            </Button>
          ) : null}
        </Flex>
        <DataList data={metricsData} columns={3} />
      </Frame>

      <Frame>
        <Flex justify="between" align="center" mb="3">
          <Heading as="h2" size="medium" mb="0">
            Variations
          </Heading>
          {editVariations ? (
            <Button variant="ghost" onClick={editVariations}>
              Edit Variations
            </Button>
          ) : null}
        </Flex>
        <Table variant="list">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Variation</TableColumnHeader>
              <TableColumnHeader>Key</TableColumnHeader>
              <TableColumnHeader justify="end">
                Initial Weight
              </TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cb.variations.map((v, i) => (
              <TableRow key={v.id}>
                <TableCell>
                  <Text weight="medium">{v.name}</Text>
                </TableCell>
                <TableCell>
                  <Text color="text-low">{v.key}</Text>
                </TableCell>
                <TableCell justify="end">
                  <Text color="text-low">
                    {formatWeight(weightForIndex(i))}
                  </Text>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Frame>

      <Frame>
        <Heading as="h2" size="medium" mb="3">
          Bandit Settings
        </Heading>
        <DataList data={banditSettingsData} columns={4} />
      </Frame>

      <Frame>
        <Heading as="h2" size="medium" mb="3">
          Results
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
