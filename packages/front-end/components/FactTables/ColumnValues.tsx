import { Box, Flex } from "@radix-ui/themes";
import { ColumnInterface } from "shared/types/fact-table";
import { DEFAULT_TOP_VALUES_LOOKBACK_VALUE } from "shared/settings";
import { useState } from "react";
import { PiArrowClockwise, PiInfo } from "react-icons/pi";
import { ago } from "shared/dates";
import useOrgSettings from "@/hooks/useOrgSettings";
import { FreshValueCounts } from "@/hooks/useColumnValueCounts";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import TextField from "@/ui/TextField";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/ui/Tooltip";
import {
  getColumnTopValues,
  getTopValuesNote,
  pluralize,
} from "@/services/factTableColumns";
import columnStyles from "./FactTableDetailsPage.module.scss";

const CHIPS = 4;

export function useTopValuesLookbackDays(): number {
  const { topValuesLookbackValue } = useOrgSettings();
  return topValuesLookbackValue ?? DEFAULT_TOP_VALUES_LOOKBACK_VALUE;
}

// Compact chips for the collapsed row; the full list lives in ColumnValuesPanel
export default function ColumnValues({ column }: { column: ColumnInterface }) {
  const values = column.topValues || [];
  if (!values.length) return null;

  return (
    <Flex gap="1" align="center" wrap="wrap">
      {values.slice(0, CHIPS).map((v) => (
        <Badge key={v} label={v} color="gray" variant="soft" />
      ))}
      {values.length > CHIPS ? (
        <Text color="text-low">+{values.length - CHIPS} more</Text>
      ) : null}
    </Flex>
  );
}

const percent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

// Row count as a share of `max`, as a bar and a percentage
export function CountBar({ count, max }: { count?: number; max: number }) {
  const share = (count ?? 0) / max;
  return (
    <Flex align="center" gap="3">
      <Box
        aria-hidden
        style={{
          flexGrow: 1,
          minWidth: 120,
          height: 6,
          borderRadius: 3,
          background: "var(--gray-a3)",
          overflow: "hidden",
        }}
      >
        <Box
          style={{
            width: `${share * 100}%`,
            height: "100%",
            background: "var(--accent-9)",
          }}
        />
      </Box>
      <Box style={{ minWidth: 48, textAlign: "right" }}>
        {count !== undefined ? percent.format(share) : null}
      </Box>
    </Flex>
  );
}

// The Rows and Share headers, shared by every top values table
export function CountColumnHeaders({
  noun,
  count,
  lookbackDays,
}: {
  // Singular, for example "value" or "event"
  noun: string;
  count: number;
  lookbackDays: number;
}) {
  return (
    <>
      <TableColumnHeader justify="end">Rows</TableColumnHeader>
      <TableColumnHeader>
        <Tooltip
          content={`Each ${noun}'s share of all rows across the top ${pluralize(count, noun)} from the last ${lookbackDays} days. Rows from ${noun}s not listed aren't counted.`}
        >
          <Flex align="center" gap="1" display="inline-flex">
            Share of listed rows <PiInfo />
          </Flex>
        </Tooltip>
      </TableColumnHeader>
    </>
  );
}

// The Rows and Share cells that go under CountColumnHeaders
export function CountCells({ count, max }: { count?: number; max: number }) {
  return (
    <>
      {/* Tabular figures keep digits and separators aligned down the column */}
      <TableCell justify="end" style={{ fontVariantNumeric: "tabular-nums" }}>
        {count !== undefined ? (
          // The exact number, so nothing is hidden behind a hover
          count.toLocaleString()
        ) : (
          <Text color="text-low">…</Text>
        )}
      </TableCell>
      <TableCell>
        <CountBar count={count} max={max} />
      </TableCell>
    </>
  );
}

// Only the top values; the rest stay stored for auto slices
const MAX_VALUE_ROWS = 20;

export function ColumnValuesPanel({
  column,
  counts,
  loading,
  error,
  onLoad,
}: {
  column: ColumnInterface;
  counts?: FreshValueCounts;
  loading: boolean;
  error?: string;
  // Omitted when the viewer can't run the top-values query
  onLoad?: () => void;
}) {
  const [search, setSearch] = useState("");
  const lookbackDays = useTopValuesLookbackDays();

  const topValues = getColumnTopValues(column, counts);
  const rows = topValues.values.slice(0, MAX_VALUE_ROWS);
  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => !q || r.value.toLowerCase().includes(q));
  const showCounts = topValues.hasCounts;
  // Total of the listed values only; the table's full row count is unknown
  const totalCount = Math.max(
    1,
    rows.reduce((sum, r) => sum + (r.count ?? 0), 0),
  );

  return (
    <Flex direction="column" gap="2" style={{ maxWidth: 900 }}>
      <Flex justify="between" align="center" gap="3">
        <Box flexGrow="1" style={{ maxWidth: 400 }}>
          {rows.length > 0 ? (
            <TextField
              size="sm"
              type="search"
              placeholder={`Search ${rows.length} values`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          ) : null}
        </Box>
        {onLoad ? (
          <Flex align="center" gap="3">
            {topValues.refreshedAt ? (
              <Text size="sm" color="text-mid">
                Refreshed {ago(topValues.refreshedAt)}
              </Text>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              icon={<PiArrowClockwise />}
              loading={loading}
              onClick={onLoad}
            >
              Refresh
            </Button>
          </Flex>
        ) : null}
      </Flex>
      {error ? (
        <HelperText status="error" size="sm">
          Couldn&apos;t refresh values: {error}
        </HelperText>
      ) : null}
      {rows.length === 0 ? (
        <Text color="text-mid">
          No values found for{" "}
          <span className={columnStyles.mono}>{column.column}</span>
          {topValues.refreshedAt
            ? ` in the last ${lookbackDays} days.`
            : ` yet.${onLoad ? " Refresh to load them." : ""}`}
        </Text>
      ) : (
        <Table variant="list" roundedCorners>
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Value</TableColumnHeader>
              {showCounts ? (
                <CountColumnHeaders
                  noun="value"
                  count={rows.length}
                  lookbackDays={lookbackDays}
                />
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.value}>
                <TableCell>
                  <code>{r.value}</code>
                </TableCell>
                {showCounts ? (
                  <CountCells count={r.count} max={totalCount} />
                ) : null}
              </TableRow>
            ))}
            {!visible.length ? (
              <TableRow>
                <TableCell colSpan={showCounts ? 3 : 1}>
                  <Text color="text-mid">No values match “{search}”.</Text>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      )}
      {rows.length > 0 ? (
        <Text size="sm" color="text-low">
          {getTopValuesNote({
            count: rows.length,
            noun: "value",
            lookbackDays,
            hasCounts: showCounts,
            countsUnavailable: topValues.countsUnavailable,
            canRefresh: !!onLoad,
          })}
        </Text>
      ) : null}
    </Flex>
  );
}
