import { Box, Flex } from "@radix-ui/themes";
import { RowFilter, RowFilterTestResults } from "shared/types/fact-table";
import { PiArrowsClockwise } from "react-icons/pi";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isEqual } from "lodash";
import { useAuth } from "@/services/auth";
import useFullFactTable from "@/hooks/useFullFactTable";
import Button from "@/ui/Button";
import Modal from "@/ui/Modal";
import Frame from "@/ui/Frame";
import LoadingSpinner from "@/components/LoadingSpinner";
import { TestQueryResultsTable } from "@/components/Settings/DisplayTestQueryResults";
import Tooltip from "@/components/Tooltip/Tooltip";
import Code from "@/components/SyntaxHighlighting/Code";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import { factTableToColumnSource, isRowFilterComplete } from "./rowFilterUtils";
import { RowFilterEditorRows } from "./RowFilterFields";
import { RowFilterActions } from "./RowFilterActions";

export function SampleRowsModal({
  factTableId,
  rowFilters,
  setRowFilters,
  close,
}: {
  factTableId: string;
  rowFilters: RowFilter[];
  setRowFilters: (value: RowFilter[]) => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const { factTable } = useFullFactTable(factTableId);
  const columnSource = useMemo(
    () => (factTable ? factTableToColumnSource(factTable) : null),
    [factTable],
  );

  const [draft, setDraft] = useState<RowFilter[]>(rowFilters);
  const [queried, setQueried] = useState<RowFilter[]>(rowFilters);
  const [result, setResult] = useState<RowFilterTestResults | null>(null);
  const [loading, setLoading] = useState(false);

  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const runQuery = useCallback(
    async (filters: RowFilter[]) => {
      setLoading(true);
      setQueried(filters);
      try {
        const res = await apiCall<{ result: RowFilterTestResults }>(
          `/fact-tables/${factTableId}/test-row-filters`,
          {
            method: "POST",
            body: JSON.stringify({ rowFilters: filters }),
          },
        );
        if (!cancelledRef.current) setResult(res.result);
      } catch (e) {
        if (!cancelledRef.current)
          setResult({ sql: "", where: "", error: e.message });
      }
      if (!cancelledRef.current) setLoading(false);
    },
    [apiCall, factTableId],
  );

  useEffect(() => {
    runQuery(rowFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resultsAreStale = !isEqual(draft, queried);
  const canRunQuery =
    draft.length > 0 && draft.every(isRowFilterComplete) && !loading;
  const hasUnsavedChanges = !isEqual(draft, rowFilters);

  return (
    <Modal.Root
      trackingEventModalType="row-filter-sample-rows"
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      size="xl"
      dismissible={!hasUnsavedChanges}
    >
      <Modal.Header>
        <Modal.Title>{factTable?.name ?? factTableId}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Frame mb="3" py="4" px="4" height="100%">
          {columnSource && (
            <Flex direction="column" gap="2">
              <RowFilterEditorRows
                value={draft}
                setValue={setDraft}
                columnSource={columnSource}
                dateInputWidth={260}
              />
              <RowFilterActions
                onAdd={(filter) => setDraft([...draft, filter])}
              />
            </Flex>
          )}
        </Frame>

        <Tabs defaultValue="results">
          <Flex align="center" justify="between" gap="2">
            <TabsList>
              <TabsTrigger value="results">Sample Rows</TabsTrigger>
              <TabsTrigger value="where">Generated SQL</TabsTrigger>
            </TabsList>
            <Tooltip
              shouldDisplay={!canRunQuery && !loading}
              body="Fill out all filters first"
            >
              <Button
                variant={resultsAreStale ? "solid" : "soft"}
                disabled={!canRunQuery}
                loading={loading}
                icon={<PiArrowsClockwise />}
                onClick={() => runQuery(draft)}
              >
                Refresh
              </Button>
            </Tooltip>
          </Flex>

          <TabsContent value="results">
            <Box
              style={{
                height: 300,
                overflowY: "auto",
                width: "100%",
                maxWidth: "calc(100vw - 7rem)",
                overflowX: "auto",
              }}
            >
              {result ? (
                <Box style={{ opacity: loading ? 0.5 : 1 }}>
                  <TestQueryResultsTable
                    duration={result.duration || 0}
                    results={result.results || []}
                    sql={result.sql || ""}
                    error={result.error || ""}
                    expandable={false}
                    allowDownload={true}
                  />
                </Box>
              ) : (
                <Flex align="center" gap="2" py="4">
                  <LoadingSpinner /> Running query...
                </Flex>
              )}
            </Box>
          </TabsContent>
          <TabsContent value="where">
            <Box style={{ height: 300, overflowY: "auto" }}>
              <Code code={result?.where || ""} language="sql" />
            </Box>
          </TabsContent>
        </Tabs>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="soft" color="gray" onClick={close}>
          {hasUnsavedChanges ? "Cancel" : "Close"}
        </Button>
        <Button
          disabled={!hasUnsavedChanges}
          onClick={() => {
            setRowFilters(draft);
            close();
          }}
        >
          Save Changes
        </Button>
      </Modal.Footer>
    </Modal.Root>
  );
}
