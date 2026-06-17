import { ReactNode, useState } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { date } from "shared/dates";
import { getMetricLink } from "shared/experiments";
import { ApiContextualBanditInterface } from "shared/validators";
import type { RadixColor } from "@/ui/HelperText";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Metadata from "@/ui/Metadata";
import SortedTags from "@/components/Tags/SortedTags";
import Markdown from "@/components/Markdown/Markdown";
import Owner from "@/components/Avatar/Owner";
import { tagLinkProps } from "@/services/search";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import {
  DetailSectionBox,
  DetailSectionColumn,
} from "@/components/DetailSectionBox";
import ContextualBanditResultsTable from "@/components/ContextualBandit/ContextualBanditResultsTable";
import { useContextualBanditQueries } from "@/hooks/useContextualBanditQueries";

const STATUS_COLOR: Record<string, RadixColor> = {
  draft: "gray",
  running: "green",
  stopped: "amber",
};

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
  editOverview,
  editMetrics,
  editAnalysisSettings,
  editVariations,
  editTargeting,
  editTags,
  editProject,
  editDescription,
  duplicate,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  canRun?: boolean;
  editOverview?: () => void;
  editMetrics?: () => void;
  editAnalysisSettings?: () => void;
  editVariations?: () => void;
  editTargeting?: () => void;
  editTags?: () => void;
  editProject?: () => void;
  editDescription?: () => void;
  duplicate?: () => void;
}) {
  const { getDatasourceById, getExperimentMetricById, projects } =
    useDefinitions();
  const { apiCall } = useAuth();
  const { contextualBanditQueriesMap } = useContextualBanditQueries(
    cb.datasource,
  );
  const [confirmStop, setConfirmStop] = useState(false);

  const updateEndpoint = `/api/v1/contextual-bandits/${cb.id}`;

  const numVariations = cb.variations.length;
  const weightForIndex = (i: number): number => {
    const fallback = numVariations > 0 ? 1 / numVariations : 0;
    const variationId = cb.variations[i]?.id;
    const match = cb.variationWeights?.find(
      (w) => w.variationId === variationId,
    );
    return match?.weight ?? fallback;
  };
  const formatWeight = (w: number): string =>
    new Intl.NumberFormat(undefined, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(w);

  const datasource = cb.datasource ? getDatasourceById(cb.datasource) : null;
  const datasourceName = datasource?.name ?? cb.datasource;
  const exposureQueryName =
    contextualBanditQueriesMap.get(cb.contextualBanditQueryId)?.name ??
    cb.contextualBanditQueryId;
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

  const renderMetricList = (ids: string[]): ReactNode =>
    ids.length ? (
      <ul className="list-unstyled mb-0">
        {ids.map((id) => (
          <li key={id}>
            <Link href={getMetricLink(id)}>{metricName(id)}</Link>
          </li>
        ))}
      </ul>
    ) : (
      <em>none</em>
    );

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
      <Flex gap="3" wrap="wrap" align="center" mt="2" mb="1">
        <Metadata label="Project" value={projectName} />
        {editProject ? (
          <Button variant="ghost" onClick={editProject}>
            Edit
          </Button>
        ) : null}
        <Metadata label="Experiment Key" value={cb.trackingKey} />
        <Metadata
          label="Owner"
          value={<Owner ownerId={cb.owner} gap="1" textColor="text-mid" />}
        />
        <Metadata label="Created" value={date(cb.dateCreated)} />
        {editOverview ? (
          <Button variant="ghost" onClick={editOverview}>
            Edit name / key / owner
          </Button>
        ) : null}
      </Flex>

      {/* Header — tags */}
      <Flex align="center" gap="2" mt="2" mb="4" wrap="wrap">
        <Metadata
          label="Tags"
          value={
            <Flex gap="1" align="center">
              {cb.tags.length ? (
                <SortedTags
                  tags={cb.tags}
                  useFlex
                  shouldShowEllipsis={false}
                  {...tagLinkProps("contextual-bandits")}
                />
              ) : (
                <Text size="small" color="text-low">
                  None
                </Text>
              )}
              {editTags ? (
                <Button variant="ghost" onClick={editTags}>
                  + Add
                </Button>
              ) : null}
            </Flex>
          }
        />
      </Flex>

      <Tabs defaultValue="overview" persistInURL={true}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Box pt="4">
            {/* Overview */}
            <Frame>
              <Flex align="start" justify="between" mb="2" gap="3">
                <Heading as="h4" size="small" mb="0">
                  Description
                </Heading>
                {editDescription ? (
                  <Button variant="ghost" onClick={editDescription}>
                    Edit
                  </Button>
                ) : null}
              </Flex>
              {cb.description ? (
                <Markdown>{cb.description}</Markdown>
              ) : (
                <Text color="text-low">
                  <em>
                    Add context about this contextual bandit for your team
                  </em>
                </Text>
              )}
            </Frame>

            {/* Implementation */}
            <h2 className="mt-4">Implementation</h2>
            <DetailSectionBox
              title="Variations & Values"
              onEdit={editVariations}
              editLabel="Edit Variations"
            >
              <Grid
                columns={{
                  initial: "1",
                  sm: String(Math.max(numVariations, 1)),
                }}
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
            </DetailSectionBox>

            {/* Traffic Allocation */}
            <DetailSectionBox title="Traffic Allocation" onEdit={editTargeting}>
              <div className="row">
                <DetailSectionColumn label="Traffic">
                  {coveragePct}% included, {splitLabel} split
                </DetailSectionColumn>
                <DetailSectionColumn label="Assignment Attribute">
                  <div className="d-flex flex-wrap align-items-center gap-1">
                    <AttributeBadge attributeId={cb.hashAttribute || "id"} />
                    {cb.fallbackAttribute ? (
                      <>
                        , <AttributeBadge attributeId={cb.fallbackAttribute} />
                      </>
                    ) : null}
                    <small className="text-muted ml-1">
                      (V{cb.hashVersion || 2} hashing)
                    </small>
                  </div>
                  {cb.disableStickyBucketing ? (
                    <div className="mt-1">
                      Sticky bucketing: <em>disabled</em>
                    </div>
                  ) : null}
                </DetailSectionColumn>
              </div>
            </DetailSectionBox>

            {/* Targeting */}
            <DetailSectionBox title="Targeting" onEdit={editTargeting}>
              <div className="row">
                <DetailSectionColumn label="Attribute Targeting">
                  {cb.condition && cb.condition !== "{}" ? (
                    <ConditionDisplay condition={cb.condition} />
                  ) : (
                    <em>None</em>
                  )}
                </DetailSectionColumn>
              </div>
            </DetailSectionBox>

            <DetailSectionBox
              title="Analysis Configuration"
              onEdit={editAnalysisSettings}
              editLabel="Edit"
            >
              <div className="row">
                <DetailSectionColumn label="Data Source">
                  {datasourceName || <em>none</em>}
                </DetailSectionColumn>
                <DetailSectionColumn label="Experiment Assignment Table">
                  {exposureQueryName || <em>none</em>}
                </DetailSectionColumn>
                <DetailSectionColumn label="Contextual Attributes">
                  {cb.contextualAttributes.length
                    ? cb.contextualAttributes.join(", ")
                    : "—"}
                </DetailSectionColumn>
              </div>
              <div className="row mt-3">
                <DetailSectionColumn label="Regression Adjustment">
                  {cb.regressionAdjustmentEnabled ? "On" : "Off"}
                </DetailSectionColumn>
                {cb.activationMetric ? (
                  <DetailSectionColumn label="Activation Metric">
                    <Link href={getMetricLink(cb.activationMetric)}>
                      {metricName(cb.activationMetric)}
                    </Link>
                  </DetailSectionColumn>
                ) : null}
              </div>
            </DetailSectionBox>

            <DetailSectionBox
              title="Metrics"
              onEdit={editMetrics}
              editLabel="Edit Metrics"
            >
              <div className="row">
                <DetailSectionColumn label="Decision Metric">
                  {renderMetricList(cb.goalMetrics.slice(0, 1))}
                </DetailSectionColumn>
              </div>
            </DetailSectionBox>
          </Box>
        </TabsContent>

        <TabsContent value="results">
          <Box pt="4">
            {/* Current Results — leaf heatmap */}
            <Frame>
              <ContextualBanditResultsTable cb={cb} mutate={mutate} />
            </Frame>
          </Box>
        </TabsContent>
      </Tabs>

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
