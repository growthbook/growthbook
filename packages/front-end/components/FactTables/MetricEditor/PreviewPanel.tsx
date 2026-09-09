import { useState } from "react";
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
  const [results, setResults] = useState<
    Record<string, FactFilterTestResults | undefined>
  >({});
  const [error, setError] = useState<string | null>(null);

  if (!parts.length) return null;

  const active = parts.find((p) => p.key === partKey) ?? parts[0];
  const result = results[active.key];

  async function runPreview() {
    if (!active.factTable) return;
    setError(null);
    const res = await apiCall<{ result: FactFilterTestResults }>(
      `/fact-tables/${active.factTable.id}/preview-metric-rows`,
      {
        method: "POST",
        body: JSON.stringify({ rowFilters: active.rowFilters }),
      },
    );
    setResults((prev) => ({ ...prev, [active.key]: res.result }));
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
        <Button
          onClick={runPreview}
          setError={setError}
          disabled={!active.factTable}
        >
          Run Preview
        </Button>
      </Flex>
      {error && (
        <Callout status="error" mb="3">
          {error}
        </Callout>
      )}
      {!result && !error && (
        <Text color="text-mid" as="div">
          {active.factTable
            ? "Run the preview to see sample rows and the SQL that selects them."
            : "Select a fact table to preview this metric's data."}
        </Text>
      )}
      {result &&
        (view === "sql" ? (
          <Code language="sql" code={result.sql || ""} expandable />
        ) : (
          <DisplayTestQueryResults
            duration={result.duration || 0}
            results={result.results || []}
            sql={result.sql || ""}
            error={result.error || ""}
            expandable
          />
        ))}
    </Frame>
  );
}
