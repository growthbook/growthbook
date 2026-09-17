import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiEye } from "react-icons/pi";
import { FactMetricInterface } from "shared/types/fact-table";
import { CreateFactMetricFormProps } from "@/services/metrics";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Avatar from "@/ui/Avatar";
import Link from "@/ui/Link";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Code from "@/components/SyntaxHighlighting/Code";
import { MetricPreviewSql } from "@/components/FactTables/MetricEditor/previewSql";
import MetricPerformance from "@/enterprise/components/ProductAnalytics/MetricPerformance";
import {
  draftMetricNeedsPopulation,
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
  const [showExperimentSql, setShowExperimentSql] = useState(false);
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  const draftMetric = draft ? getDraftMetricPreview(draft) : null;
  const isRetention = (draft ?? metric)?.metricType === "retention";
  const needsPopulation =
    !!draft && draftMetricNeedsPopulation(draft.metricType);
  const previewUnavailable = isRetention || needsPopulation;
  const requestKey = JSON.stringify(draftMetric);
  const previewMetric =
    metric ?? (submittedKey === requestKey ? draftMetric : null);

  return (
    <Frame className={styles.panel} mb="0">
      <Tabs
        className={styles.tabRoot}
        value={view}
        onValueChange={(v) => setView(v as "preview" | "sql")}
      >
        <Flex direction="column" gap="2" mb="4" className={styles.header}>
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
                    expandable
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
                      expandable
                      showLineNumbers={false}
                    />
                  </div>
                )}
                <div>
                  <Flex justify="between" align="center" mb="1">
                    <Text weight="semibold" as="div">
                      Experiment results
                    </Text>
                    <Link onClick={() => setShowExperimentSql((v) => !v)}>
                      {showExperimentSql ? "Hide" : "Show"}
                    </Link>
                  </Flex>
                  {showExperimentSql && (
                    <Code
                      language="sql"
                      code={previewSql.experimentSQL}
                      expandable
                      showLineNumbers={false}
                    />
                  )}
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
            className={styles.previewContent}
            style={{ height: "100%" }}
          >
            {previewMetric && !previewUnavailable ? (
              <MetricPerformance
                key={JSON.stringify(previewMetric)}
                metric={previewMetric}
                draft={!!draft}
              />
            ) : (
              <Flex
                direction="column"
                align="center"
                justify="center"
                gap="3"
                height="100%"
              >
                <Avatar color="violet" variant="soft" size="lg">
                  <PiEye />
                </Avatar>
                <Text weight="semibold" as="div">
                  {previewUnavailable
                    ? "Preview not available for this metric"
                    : "Preview will appear here"}
                </Text>
                {previewUnavailable ? (
                  <Text size="sm" color="text-mid" as="div">
                    Calculating this rate requires an eligible user population.
                    A source activity count would not represent this metric.
                  </Text>
                ) : (
                  <Text size="sm" color="text-mid" as="div">
                    {draftMetric
                      ? "Run the query to calculate this metric over the last 7 days."
                      : "Complete the metric definition to preview its calculated value."}
                  </Text>
                )}
              </Flex>
            )}
          </TabsContent>
        </Box>
        {draft && !previewMetric && !previewUnavailable && (
          <Flex
            mt="3"
            flexShrink="0"
            style={{ visibility: view === "preview" ? "visible" : "hidden" }}
          >
            <Button
              disabled={!draftMetric}
              onClick={() => setSubmittedKey(requestKey)}
            >
              Run query
            </Button>
          </Flex>
        )}
      </Tabs>
    </Frame>
  );
}
