import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FactMetricInterface } from "shared/types/fact-table";
import { CreateFactMetricFormProps } from "@/services/metrics";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Callout from "@/ui/Callout";
import Code from "@/components/SyntaxHighlighting/Code";
import { MetricPreviewSql } from "@/components/FactTables/MetricEditor/previewSql";
import MetricPerformance from "@/enterprise/components/ProductAnalytics/MetricPerformance";
import {
  getMetricPreviewUnavailableReason,
  getDraftMetricPreview,
  getMetricPreviewCaveat,
} from "./draftMetricPreview";
import { getPreviewDraftMetric } from "./metricPreview";
import styles from "./PreviewPanel.module.scss";

const PREVIEW_DEBOUNCE_MS = 500;

// The form hands over a new draft object on every keystroke. Only publish a
// new preview metric once its query-relevant fields change and then settle,
// so typing doesn't fire a cache lookup per key.
function useSettledPreviewMetric(
  live: FactMetricInterface | null,
): FactMetricInterface | null {
  const key = live ? JSON.stringify(getPreviewDraftMetric(live)) : "";
  const liveRef = useRef(live);
  liveRef.current = live;
  const [settled, setSettled] = useState({ key, metric: live });
  useEffect(() => {
    if (key === settled.key) return;
    const timer = setTimeout(
      () => setSettled({ key, metric: liveRef.current }),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [key, settled.key]);
  return settled.metric;
}

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
  const settledDraftMetric = useSettledPreviewMetric(liveDraftMetric);
  // An incomplete draft disables the preview at once instead of after the
  // debounce, so a half-filled filter can't run the last settled query.
  const previewMetric = draft
    ? liveDraftMetric && settledDraftMetric
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
