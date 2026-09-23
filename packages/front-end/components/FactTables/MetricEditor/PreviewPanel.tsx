import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FactMetricInterface } from "shared/types/fact-table";
import { CreateFactMetricFormProps } from "@/services/metrics";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Code from "@/components/SyntaxHighlighting/Code";
import { MetricPreviewSql } from "@/components/FactTables/MetricEditor/previewSql";
import MetricPerformance from "@/enterprise/components/ProductAnalytics/MetricPerformance";
import {
  getMetricPreviewUnavailableReason,
  getDraftMetricPreview,
} from "./draftMetricPreview";
import styles from "./PreviewPanel.module.scss";

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
  const previewMetric = draft ? getDraftMetricPreview(draft) : (metric ?? null);
  const currentMetric = draft ?? metric;
  const unavailableReason = currentMetric
    ? getMetricPreviewUnavailableReason(currentMetric)
    : null;

  return (
    <Frame
      className={`${styles.panel} ${view === "sql" ? styles.sqlPanel : ""}`}
      p="4"
      mb="0"
    >
      <Tabs
        className={styles.tabRoot}
        value={view}
        onValueChange={(v) => setView(v as "preview" | "sql")}
      >
        <Flex direction="column" gap="2" mb="3" className={styles.header}>
          <Flex justify="between" align="center">
            <Heading as="h4" size="sm" mb="0">
              Preview
            </Heading>
            <TabsList className={styles.tabs}>
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="sql">SQL</TabsTrigger>
            </TabsList>
          </Flex>
        </Flex>

        <Box className={styles.content} width="100%">
          <TabsContent value="sql" className={styles.sqlPreview}>
            {previewSql?.sql ? (
              <Flex direction="column" gap="4">
                <Text size="sm" color="text-mid" as="div">
                  Illustrative SQL showing how this metric is calculated.
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
              height: "100%",
              display: view === "preview" ? undefined : "none",
            }}
          >
            {unavailableReason ? (
              <Flex direction="column" gap="3" justify="center" height="100%">
                <Text weight="semibold">
                  Preview not available for this metric
                </Text>
                <Text size="sm" color="text-mid">
                  {unavailableReason}
                </Text>
              </Flex>
            ) : (
              <MetricPerformance
                metric={previewMetric}
                datasourceId={currentMetric?.datasource ?? ""}
                draft={!!draft}
              />
            )}
          </TabsContent>
        </Box>
      </Tabs>
    </Frame>
  );
}
