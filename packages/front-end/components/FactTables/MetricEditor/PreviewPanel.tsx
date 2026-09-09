import { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
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
import { Select, SelectItem } from "@/ui/Select";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import Code from "@/components/SyntaxHighlighting/Code";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";

export type PreviewPart = {
  key: string;
  label: string;
  factTable: FactTableDefinition | null;
  rowFilters: RowFilter[];
};

// Row-level preview, not the metric's aggregated per-user value - the query
// GrowthBook actually runs during experiment analysis is relative to an
// exposure table this editor has no context for (same simplification the old
// modal's client-only "Live SQL Preview" made, now backed by a real query
// instead of a fake template).
export default function PreviewPanel({ parts }: { parts: PreviewPart[] }) {
  const { apiCall } = useAuth();
  const [partKey, setPartKey] = useState(parts[0]?.key);
  const [view, setView] = useState<"preview" | "sql">("preview");
  const [sqlByPart, setSqlByPart] = useState<Record<string, string>>({});
  const [sqlLoading, setSqlLoading] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [rowsByPart, setRowsByPart] = useState<
    Record<string, FactFilterTestResults | undefined>
  >({});
  const [rowsError, setRowsError] = useState<string | null>(null);

  const active = parts.find((p) => p.key === partKey) ?? parts[0];
  const factTableId = active?.factTable?.id;
  const rowFiltersKey = JSON.stringify(active?.rowFilters ?? []);

  // Building the SQL text is free - no warehouse round trip - so it updates
  // automatically as the definition changes, the same way other generated-
  // config previews in the app work. Only fetching sample rows (below) is a
  // deliberate action, since that runs a real query against the warehouse.
  useEffect(() => {
    if (!active || !factTableId) return;
    const key = active.key;
    const rowFilters = active.rowFilters;
    setSqlError(null);
    const timer = setTimeout(async () => {
      setSqlLoading(true);
      try {
        const res = await apiCall<{ sql: string }>(
          `/fact-tables/${factTableId}/preview-metric-sql`,
          { method: "POST", body: JSON.stringify({ rowFilters }) },
        );
        setSqlByPart((prev) => ({ ...prev, [key]: res.sql }));
      } catch (e) {
        setSqlError(e.message);
      }
      setSqlLoading(false);
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factTableId, rowFiltersKey]);

  if (!active) return null;

  const sql = sqlByPart[active.key];
  const rows = rowsByPart[active.key];

  async function runPreview() {
    if (!active.factTable) return;
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
        {parts.length > 1 && (
          <Select value={partKey} setValue={setPartKey}>
            {parts.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.label}
              </SelectItem>
            ))}
          </Select>
        )}
      </Flex>

      {!active.factTable && (
        <Text color="text-mid" as="div">
          Select a fact table to preview this metric&apos;s data.
        </Text>
      )}

      {active.factTable && view === "sql" && (
        <>
          {sqlError && (
            <Callout status="error" mb="3">
              {sqlError}
            </Callout>
          )}
          {sql ? (
            <Code language="sql" code={sql} expandable />
          ) : (
            <Text color="text-mid" as="div">
              {sqlLoading ? "Generating SQL…" : "Waiting for the SQL…"}
            </Text>
          )}
        </>
      )}

      {active.factTable && view === "preview" && (
        <Flex direction="column" gap="3">
          {rowsError && <Callout status="error">{rowsError}</Callout>}
          {rows ? (
            <DisplayTestQueryResults
              duration={rows.duration || 0}
              results={rows.results || []}
              sql={rows.sql || ""}
              error={rows.error || ""}
              expandable
            />
          ) : (
            <>
              <Text color="text-mid" as="div">
                Run the preview to see a sample of the rows this metric selects.
              </Text>
              <Flex>
                <Button onClick={runPreview} setError={setRowsError}>
                  Run Preview
                </Button>
              </Flex>
            </>
          )}
        </Flex>
      )}
    </Frame>
  );
}
