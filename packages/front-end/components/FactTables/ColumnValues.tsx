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
import { getColumnTopValues } from "@/services/factTableColumns";

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

const compact = new Intl.NumberFormat(undefined, { notation: "compact" });

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
          <TextField
            size="sm"
            type="search"
            placeholder={`Search ${rows.length} values`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
      <Table variant="list" roundedCorners>
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Value</TableColumnHeader>
            {showCounts ? (
              <>
                <TableColumnHeader justify="end">Rows</TableColumnHeader>
                <TableColumnHeader>
                  <Tooltip
                    content={`Each value's share of all rows across the top ${rows.length} values from the last ${lookbackDays} days. Rows with values not listed aren't counted.`}
                  >
                    <Flex align="center" gap="1" display="inline-flex">
                      Share of sample rows <PiInfo />
                    </Flex>
                  </Tooltip>
                </TableColumnHeader>
              </>
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
                <>
                  <TableCell justify="end">
                    {r.count !== undefined ? (
                      <span title={r.count.toLocaleString()}>
                        {compact.format(r.count)}
                      </span>
                    ) : (
                      <Text color="text-low">…</Text>
                    )}
                  </TableCell>
                  <TableCell>
                    <CountBar count={r.count} max={totalCount} />
                  </TableCell>
                </>
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
      <Text size="sm" color="text-low">
        {`Top ${rows.length} values${showCounts ? " by row count" : ""} over the last ${lookbackDays} days.`}
        {showCounts
          ? " Counts may be approximate on some data sources."
          : onLoad
            ? " Refresh to load row counts."
            : ""}
      </Text>
    </Flex>
  );
}
