import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiEye } from "react-icons/pi";
import {
  FactFilterTestResults,
  FactTableDefinition,
  RowFilter,
} from "shared/types/fact-table";
import { useAuth } from "@/services/auth";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Avatar from "@/ui/Avatar";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Code from "@/components/SyntaxHighlighting/Code";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import { MetricPreviewSql } from "@/components/FactTables/MetricEditor/previewSql";
import styles from "./PreviewPanel.module.scss";

export type PreviewPart = {
  key: string;
  label: string;
  factTable: FactTableDefinition | null;
  rowFilters: RowFilter[];
};

export default function PreviewPanel({
  parts,
  previewSql,
}: {
  parts: PreviewPart[];
  previewSql: MetricPreviewSql | null;
}) {
  const { apiCall } = useAuth();
  const [partKey, setPartKey] = useState(parts[0]?.key);
  const [view, setView] = useState<"preview" | "sql">("preview");
  const [showExperimentSql, setShowExperimentSql] = useState(false);
  const [rowsByPart, setRowsByPart] = useState<
    Record<
      string,
      { requestKey: string; result: FactFilterTestResults } | undefined
    >
  >({});
  const [rowsError, setRowsError] = useState<string | null>(null);

  const active = parts.find((p) => p.key === partKey) ?? parts[0];

  if (!active && !previewSql) return null;

  const requestKey = JSON.stringify([
    active?.factTable?.id,
    active?.rowFilters,
  ]);
  const cachedRows = active ? rowsByPart[active.key] : undefined;
  const rows =
    cachedRows?.requestKey === requestKey ? cachedRows.result : undefined;

  async function runPreview() {
    if (!active?.factTable) return;
    setRowsError(null);
    const res = await apiCall<{ result: FactFilterTestResults }>(
      `/fact-tables/${active.factTable.id}/preview-metric-rows`,
      {
        method: "POST",
        body: JSON.stringify({ rowFilters: active.rowFilters }),
      },
    );
    setRowsByPart((prev) => ({
      ...prev,
      [active.key]: { requestKey, result: res.result },
    }));
  }

  return (
    <Frame>
      <Tabs value={view} onValueChange={(v) => setView(v as "preview" | "sql")}>
        <Flex direction="column" gap="2" mb="3">
          <Flex justify="between" align="center">
            <Heading as="h4" size="sm" mb="0">
              Preview
            </Heading>
            <TabsList>
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="sql">SQL</TabsTrigger>
            </TabsList>
          </Flex>
          {view === "preview" && parts.length > 1 && (
            <Select
              label="Part to preview"
              value={active?.key}
              setValue={setPartKey}
            >
              {parts.map((p) => (
                <SelectItem key={p.key} value={p.key}>
                  {p.label}
                </SelectItem>
              ))}
            </Select>
          )}
        </Flex>

        <div
          style={{
            height: "clamp(280px, 40vh, 480px)",
            minWidth: 0,
            overflow: "auto",
          }}
        >
          <TabsContent value="sql" className={styles.sqlPreview}>
            {previewSql?.sql ? (
              <Flex direction="column" gap="4">
                <Text size="sm" color="text-mid" as="div">
                  Illustrative SQL showing how this metric is calculated. Sample
                  rows use a separate warehouse query.
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
          <TabsContent value="preview" style={{ height: "100%" }}>
            {!active ? (
              <Callout status="info">
                Row preview isn&apos;t available for funnel metrics yet. Use the
                SQL tab to see an illustrative query.
              </Callout>
            ) : !active.factTable ? (
              <Text color="text-mid" as="div">
                Select a fact table to preview this metric&apos;s data.
              </Text>
            ) : (
              <Flex direction="column" gap="3" height="100%">
                {rowsError && <Callout status="error">{rowsError}</Callout>}
                {rows ? (
                  <div style={{ height: "100%" }}>
                    <DisplayTestQueryResults
                      duration={rows.duration || 0}
                      results={rows.results || []}
                      sql={rows.sql || ""}
                      error={rows.error || ""}
                      sqlMaxHeight="140px"
                    />
                  </div>
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
                    <Flex direction="column" align="center" gap="1">
                      <Text weight="semibold" as="div">
                        Preview will appear here
                      </Text>
                      <Text size="sm" color="text-mid" as="div">
                        Run a sample query against this fact table. Filters are
                        optional.
                      </Text>
                    </Flex>
                  </Flex>
                )}
              </Flex>
            )}
          </TabsContent>
        </div>
        {view === "preview" && active?.factTable && (
          <Flex mt="3">
            <Button onClick={runPreview} setError={setRowsError}>
              {rows ? "Refresh preview" : "Run preview"}
            </Button>
          </Flex>
        )}
      </Tabs>
    </Frame>
  );
}
