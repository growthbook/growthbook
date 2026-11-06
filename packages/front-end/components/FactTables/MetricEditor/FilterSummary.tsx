import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FactTableDefinition, RowFilter } from "shared/types/fact-table";
import {
  getRowFilterDescription,
  getRowFilterDisplaySQL,
} from "@/components/FactTables/rowFilterUtils";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import useIsOverflowing from "@/hooks/useIsOverflowing";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";

const SQL_PREVIEW_MAX_HEIGHT = 200;
// Matches Popover's content padding. The preview owns that padding so the
// pointer can rest on it without the preview closing.
const PREVIEW_PADDING = "15px 20px";
const PREVIEW_CLOSE_DELAY_MS = 120;

function RowFilterPopoverContent({
  sql,
  factTable,
  savedFilterId,
}: {
  sql: string;
  factTable: FactTableDefinition | null;
  savedFilterId: string | null;
}) {
  const sqlRef = useRef<HTMLDivElement>(null);
  const overflows = useIsOverflowing(sqlRef, SQL_PREVIEW_MAX_HEIGHT);
  const savedFilter = savedFilterId
    ? factTable?.filters.find((filter) => filter.id === savedFilterId)
    : undefined;
  const filterHref =
    savedFilter && factTable
      ? `/fact-tables/${factTable.id}?filter=${encodeURIComponent(savedFilter.id)}#filters`
      : null;
  // Long SQL is clipped when the fact table can show the rest; an inline
  // filter has no other home, so it scrolls here instead.
  const clipped = !!filterHref && overflows;

  return (
    <Flex direction="column" gap="2">
      {sql ? (
        <Box
          className={clipped ? "fade-mask-bottom-1rem" : undefined}
          style={{
            maxHeight: SQL_PREVIEW_MAX_HEIGHT,
            overflowY: filterHref ? "hidden" : "auto",
          }}
        >
          <div ref={sqlRef}>
            <InlineCode language="sql" code={sql} />
          </div>
        </Box>
      ) : (
        <Text size="sm" color="text-mid">
          {savedFilterId && factTable && !savedFilter
            ? "This saved filter was deleted"
            : "No SQL available"}
        </Text>
      )}
      {filterHref ? <Link href={filterHref}>View saved filter</Link> : null}
    </Flex>
  );
}

function RowFilterBadge({
  rowFilter,
  factTable,
}: {
  rowFilter: RowFilter;
  factTable: FactTableDefinition | null;
}) {
  const sql = getRowFilterDisplaySQL(rowFilter, factTable);
  const description = getRowFilterDescription(rowFilter, factTable);
  const savedFilterId =
    rowFilter.operator === "saved_filter"
      ? (rowFilter.values?.[0] ?? null)
      : null;
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedFromKeyboard = useRef(false);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openPreview = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(
      () => setOpen(false),
      PREVIEW_CLOSE_DELAY_MS,
    );
  };

  useEffect(() => cancelClose, []);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      contentStyle={{ maxWidth: 500, padding: 0 }}
      onOpenAutoFocus={(event) => {
        if (!openedFromKeyboard.current) event.preventDefault();
        openedFromKeyboard.current = false;
      }}
      onCloseAutoFocus={(event) => {
        const layer = event.currentTarget;
        const active = document.activeElement;
        const focusInside =
          layer instanceof Element &&
          active instanceof Node &&
          layer.contains(active);
        // A pointer close otherwise focuses this pill. That focus lands
        // outside the next preview and dismisses it.
        if (!focusInside) event.preventDefault();
      }}
      content={
        <div
          onMouseEnter={openPreview}
          onMouseLeave={scheduleClose}
          style={{ padding: PREVIEW_PADDING }}
        >
          <RowFilterPopoverContent
            sql={sql}
            factTable={factTable}
            savedFilterId={savedFilterId}
          />
        </div>
      }
      trigger={
        <button
          type="button"
          aria-label={description}
          onMouseEnter={openPreview}
          onMouseLeave={scheduleClose}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              openedFromKeyboard.current = true;
            }
          }}
          onPointerDown={() => {
            openedFromKeyboard.current = false;
          }}
          onClick={(event) => {
            // Skip Radix's click toggle, which would close a preview the
            // pointer already opened. Opening here keeps keyboard activation.
            event.preventDefault();
            openPreview();
          }}
          style={{
            display: "inline-flex",
            maxWidth: "100%",
            margin: 0,
            padding: 0,
            border: "none",
            background: "none",
            font: "inherit",
            color: "inherit",
            textAlign: "start",
            cursor: "pointer",
          }}
        >
          <Badge
            color="violet"
            radius="small"
            style={{
              whiteSpace: "normal",
              overflowWrap: "anywhere",
            }}
            label={description}
          />
        </button>
      }
    />
  );
}

export default function FilterSummary({
  rowFilters,
  factTable,
}: {
  rowFilters: RowFilter[];
  factTable: FactTableDefinition | null;
}) {
  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2">
        <Text weight="semibold">Row filter</Text>
        <Badge label={String(rowFilters.length)} color="gray" radius="full" />
      </Flex>
      <Box
        p="2"
        style={{
          border: "1px solid var(--gray-a7)",
          borderRadius: "var(--radius-2)",
        }}
      >
        {rowFilters.length ? (
          <Flex gap="2" wrap="wrap">
            {rowFilters.map((rf, i) => (
              <RowFilterBadge key={i} rowFilter={rf} factTable={factTable} />
            ))}
          </Flex>
        ) : (
          <Text size="sm" color="text-mid">
            No filters
          </Text>
        )}
      </Box>
    </Flex>
  );
}
