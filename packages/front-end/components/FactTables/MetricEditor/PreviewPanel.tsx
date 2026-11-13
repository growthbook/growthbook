import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FactMetricInterface } from "shared/types/fact-table";
import { CreateFactMetricFormProps } from "@/services/metrics";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Callout from "@/ui/Callout";
import Code from "@/components/SyntaxHighlighting/Code";
import useDebouncedValue from "@/hooks/useDebouncedValue";
import { MetricPreviewSql } from "@/components/FactTables/MetricEditor/previewSql";
import MetricPerformance from "@/enterprise/components/ProductAnalytics/MetricPerformance";
import styles from "./PreviewPanel.module.scss";
import { getPreviewDraftMetric } from "./metricPreview";
import {
  getMetricPreviewUnavailableReason,
  getDraftMetricPreview,
  getMetricPreviewCaveat,
} from "./draftMetricPreview";

export default function PreviewPanel({
  draft,
  previewSql,
  metric,
}: {
  metric?: FactMetricInterface | null;
  draft: CreateFactMetricFormProps | null;
  previewSql: MetricPreviewSql | null;
}) {
  const [view, setView] = useState<"preview" | "sql">("preview");
  const liveDraftMetric = draft ? getDraftMetricPreview(draft) : null;
  // Only the query-relevant fields count as a change.
  const debouncedDraftMetric = useDebouncedValue(
    liveDraftMetric
      ? JSON.stringify(getPreviewDraftMetric(liveDraftMetric))
      : "",
    liveDraftMetric,
  );
  // An incomplete draft disables the preview at once instead of after the
  // delay, so a half-filled filter can't run the query from before the edit.
  const previewMetric = draft
    ? liveDraftMetric && debouncedDraftMetric
    : (metric ?? null);
  const currentMetric = draft ?? metric;
  const caveatMetric = draft ? liveDraftMetric : (metric ?? null);
  const caveat = caveatMetric ? getMetricPreviewCaveat(caveatMetric) : null;
  const unavailableReason = currentMetric
    ? getMetricPreviewUnavailableReason(currentMetric)
    : null;

  return (
    <Frame className={styles.panel} px="0" py="0" mb="0">
      <Tabs
        className={styles.tabRoot}
        value={view}
        onValueChange={(v) => setView(v as "preview" | "sql")}
      >
        <Flex justify="between" align="center" className={styles.header}>
          <Heading as="h4" size="sm" mb="0">
            Preview
          </Heading>
          <TabsList className={styles.tabs}>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="sql">SQL</TabsTrigger>
          </TabsList>
        </Flex>

        <Box className={styles.content} width="100%">
          <TabsContent value="sql" className={styles.sqlPreview}>
            {previewSql?.sql ? (
              <Flex direction="column" gap="4">
                <Text size="sm" color="text-mid" as="div">
                  Illustrative SQL showing how experiments calculate this
                  metric. The Preview tab runs a simpler daily query without
                  exposure, metric windows, or per-unit capping.
                </Text>
                <div>
                  <Text weight="semibold" as="div" mb="1">
                    Metric value (per user)
                  </Text>
                  <Code
                    language="sql"
                    code={previewSql.sql}
                    showLineNumbers={false}
                  />
                </div>
                {previewSql.denominatorSQL && (
                  <div>
                    <Text weight="semibold" as="div" mb="1">
                      Denominator
                    </Text>
                    <Code
                      language="sql"
                      code={previewSql.denominatorSQL}
                      showLineNumbers={false}
                    />
                  </div>
                )}
                <div>
                  <Text weight="semibold" as="div" mb="1">
                    Experiment results
                  </Text>
                  <Code
                    language="sql"
                    code={previewSql.experimentSQL}
                    showLineNumbers={false}
                  />
                </div>
              </Flex>
            ) : (
              <Text color="text-mid" as="div">
                Configure a metric definition to see the illustrative SQL.
              </Text>
            )}
          </TabsContent>
          <TabsContent
            value="preview"
            forceMount
            className={styles.previewContent}
            style={{
              display: view === "preview" ? undefined : "none",
            }}
          >
            {unavailableReason ? (
              <Flex direction="column" gap="3">
                <Text weight="semibold">
                  Preview not available for this metric
                </Text>
                <Text size="sm" color="text-mid">
                  {unavailableReason}
                </Text>
              </Flex>
            ) : (
              <Flex direction="column" gap="3" minHeight="0">
                {caveat && (
                  <Callout status="info" size="sm">
                    {caveat}
                  </Callout>
                )}
                <MetricPerformance
                  // A different metric type is a different query shape: start
                  // over from the empty state instead of flagging stale results.
                  key={currentMetric?.metricType}
                  metric={previewMetric}
                  datasourceId={currentMetric?.datasource ?? ""}
                  draft={!!draft}
                />
              </Flex>
            )}
          </TabsContent>
        </Box>
      </Tabs>
    </Frame>
  );
}
