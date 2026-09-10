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
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import Code from "@/components/SyntaxHighlighting/Code";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import { MetricPreviewSql } from "@/components/FactTables/MetricEditor/previewSql";

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
    Record<string, FactFilterTestResults | undefined>
  >({});
  const [rowsError, setRowsError] = useState<string | null>(null);

  const active = parts.find((p) => p.key === partKey) ?? parts[0];

  if (!active && !previewSql) return null;

  const rows = active ? rowsByPart[active.key] : undefined;

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
    setRowsByPart((prev) => ({ ...prev, [active.key]: res.result }));
  }

  return (
    <Frame>
      <Flex direction="column" gap="2" mb="3">
        <Flex justify="between" align="center">
          <Heading as="h4" size="sm" mb="0">
            Preview
          </Heading>
          <Tabs
            value={view}
            onValueChange={(v) => setView(v as "preview" | "sql")}
          >
            <TabsList>
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="sql">SQL</TabsTrigger>
            </TabsList>
          </Tabs>
        </Flex>
        {view === "preview" && parts.length > 1 && (
          <Select value={partKey} setValue={setPartKey}>
            {parts.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.label}
              </SelectItem>
            ))}
          </Select>
        )}
      </Flex>

      {/* One shared box for both tabs, sized off the design's proportions
          (not a fixed pixel height, so it scales with the sidebar's own
          width as the viewport changes) - keeps the card the same size
          switching between them instead of jumping to whichever tab's
          content happens to be shorter. Content that doesn't fit scrolls
          within it. */}
      <div
        style={{
          aspectRatio: "83 / 92",
          alignSelf: "stretch",
          overflow: "auto",
        }}
      >
        {view === "sql" ? (
          previewSql?.sql ? (
            <Flex direction="column" gap="4">
              <div>
                <Text weight="semibold" as="div" mb="1">
                  Metric Value (per user)
                </Text>
                <Code language="sql" code={previewSql.sql} expandable />
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
                  />
                </div>
              )}
              <div>
                <Flex justify="between" align="center" mb="1">
                  <Text weight="semibold" as="div">
                    Experiment Results
                  </Text>
                  <Link onClick={() => setShowExperimentSql((v) => !v)}>
                    {showExperimentSql ? "hide" : "show"}
                  </Link>
                </Flex>
                {showExperimentSql && (
                  <Code
                    language="sql"
                    code={previewSql.experimentSQL}
                    expandable
                  />
                )}
              </div>
            </Flex>
          ) : (
            <Text color="text-mid" as="div">
              Configure a metric definition to see a preview.
            </Text>
          )
        ) : !active?.factTable ? (
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
                    Configure a filter to see live sample data.
                  </Text>
                </Flex>
                {/* Fetching rows runs a real query against the customer's
                    warehouse - kept as an explicit, deliberate action even
                    though the design's empty state doesn't show a button. */}
                <Button onClick={runPreview} setError={setRowsError}>
                  Run Preview
                </Button>
              </Flex>
            )}
          </Flex>
        )}
      </div>
    </Frame>
  );
}
