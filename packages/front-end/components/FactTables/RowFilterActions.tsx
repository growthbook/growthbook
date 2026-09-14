import { Box, Flex } from "@radix-ui/themes";
import { RowFilter, RowFilterTestResults } from "shared/types/fact-table";
import { PiArrowsClockwise, PiPlus, PiTable } from "react-icons/pi";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { isEqual } from "lodash";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useFullFactTable from "@/hooks/useFullFactTable";
import Button from "@/ui/Button";
import Modal from "@/ui/Modal";
import Frame from "@/ui/Frame";
import LoadingSpinner from "@/components/LoadingSpinner";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Tooltip from "@/components/Tooltip/Tooltip";
import { isRowFilterComplete } from "./rowFilterUtils";
import { RowFilterInput } from "./RowFilterInput";

function SampleRowsModal({
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

  // Edits are local until saved, so Cancel can discard them.
  const [draft, setDraft] = useState<RowFilter[]>(rowFilters);
  // The filters the displayed results were produced from. Diverges from `draft`
  // as soon as the form is edited, which is what marks the results stale.
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
    // Kick off once on open with the filters as they were at click time
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
      dismissible
    >
      <Modal.Header>
        <Modal.Title>
          Sample Rows in {factTable?.name ?? factTableId}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Frame mb="3" py="4" px="4" height="100%">
          {factTable && (
            <RowFilterInput
              factTable={factTable}
              value={draft}
              setValue={setDraft}
              showSampleRows={false}
            />
          )}
        </Frame>

        <Flex justify="end" flexShrink="0">
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

        <Box
          style={{
            maxHeight: 350,
            overflowY: "auto",
            width: "100%",
            maxWidth: "calc(100vw - 7rem)",
            overflowX: "auto",
          }}
        >
          {result ? (
            // Dimmed rather than replaced while refreshing, so the rows you were
            // reading stay put. The Refresh button carries the spinner.
            <Box style={{ opacity: loading ? 0.5 : 1 }}>
              <DisplayTestQueryResults
                duration={result.duration || 0}
                results={result.results || []}
                sql={result.sql || ""}
                error={result.error || ""}
                expandable={true}
                allowDownload={true}
                tableOnly={true}
              />
            </Box>
          ) : (
            <Flex align="center" gap="2" py="4">
              <LoadingSpinner /> Running query...
            </Flex>
          )}
        </Box>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="soft" color="gray" onClick={close}>
          Cancel
        </Button>
        <Button
          disabled={!hasUnsavedChanges}
          onClick={() => {
            setRowFilters(draft);
            close();
          }}
        >
          Save
        </Button>
      </Modal.Footer>
    </Modal.Root>
  );
}

/**
 * The add/preview links that sit under a list of row filters. `factTableId` is
 * omitted for sources that aren't backed by a fact table (e.g. a raw data
 * source in the explorer), which hides the sample rows preview.
 */
export function RowFilterActions({
  value,
  setValue,
  factTableId,
  disabled,
  showSampleRows = true,
  children,
}: {
  value: RowFilter[];
  setValue: (value: RowFilter[]) => void;
  factTableId?: string;
  disabled?: boolean;
  /**
   * False inside the sample rows modal itself, which renders this same form and
   * would otherwise offer to open a second copy of the modal. Also false in the
   * Product Analytics explorer: its sidebar is too narrow to fit a third link
   * beside the unit selector, and the chart already updates as filters change,
   * so a sample of rows adds little there.
   */
  showSampleRows?: boolean;
  /** Extra content rendered at the end of the row (e.g. a unit picker). */
  children?: ReactNode;
}) {
  const [sampleRowsOpen, setSampleRowsOpen] = useState(false);
  const { getFactTableById, getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  const datasource = getDatasourceById(
    (factTableId && getFactTableById(factTableId)?.datasource) || "",
  );
  const showSampleRowsAction =
    showSampleRows &&
    !!factTableId &&
    !!datasource &&
    permissionsUtil.canRunTestQueries(datasource);

  // An unfiltered preview is allowed — seeing the raw rows is how you work out
  // what to filter on. Only a half-finished filter blocks it, since that would
  // silently query something other than what the form shows.
  const canViewSampleRows = value.every(isRowFilterComplete);

  return (
    <>
      {sampleRowsOpen && factTableId && (
        <SampleRowsModal
          factTableId={factTableId}
          rowFilters={value}
          setRowFilters={setValue}
          close={() => setSampleRowsOpen(false)}
        />
      )}
      <Flex align="center" justify="between" gap="2" wrap="wrap">
        <Flex align="center" gap="2" wrap="wrap">
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            icon={<PiPlus size={14} />}
            onClick={() =>
              setValue([...value, { column: "", operator: "=", values: [""] }])
            }
          >
            Add filter
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            icon={<PiPlus size={14} />}
            onClick={() =>
              setValue([...value, { operator: "sql_expr", values: [""] }])
            }
          >
            Add SQL filter
          </Button>
        </Flex>
        <Flex align="center" gap="2" wrap="wrap">
          {showSampleRowsAction && (
            <Tooltip
              shouldDisplay={!canViewSampleRows}
              body="Fill out all filters first"
            >
              <Button
                size="sm"
                variant="ghost"
                disabled={!canViewSampleRows}
                icon={<PiTable size={14} />}
                onClick={() => setSampleRowsOpen(true)}
              >
                View sample rows
              </Button>
            </Tooltip>
          )}
          {children}
        </Flex>
      </Flex>
    </>
  );
}
