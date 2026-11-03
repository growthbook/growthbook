import { Box, Flex } from "@radix-ui/themes";
import { ColumnInterface } from "shared/types/fact-table";
import { DEFAULT_TOP_VALUES_LOOKBACK_VALUE } from "shared/settings";
import { useState } from "react";
import { PiArrowClockwise } from "react-icons/pi";
import { ago } from "shared/dates";
import useOrgSettings from "@/hooks/useOrgSettings";
import { ValueCount } from "@/hooks/useColumnValueCounts";
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

export function ColumnValuesPanel({
  column,
  counts,
  loading,
  error,
  onLoad,
}: {
  column: ColumnInterface;
  counts?: ValueCount[];
  loading: boolean;
  error?: string;
  // Omitted when the viewer can't run the top-values query
  onLoad?: () => void;
}) {
  const [search, setSearch] = useState("");
  const lookbackDays = useTopValuesLookbackDays();

  // Columns saved before counts existed show values only until refreshed
  const withCounts =
    counts ??
    (column.topValueCounts?.length ? column.topValueCounts : undefined);
  const rows: { value: string; count?: number }[] =
    withCounts ?? (column.topValues || []).map((value) => ({ value }));
  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => !q || r.value.toLowerCase().includes(q));
  const showCounts = !!withCounts;
  // Bars are relative to the top value; the table's total row count is unknown
  const maxCount = Math.max(1, ...rows.map((r) => r.count ?? 0));

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
            {column.topValuesDate ? (
              <Text size="sm" color="text-mid">
                Refreshed {ago(column.topValuesDate)}
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
        <Text size="sm" color="text-low">
          Couldn&apos;t refresh values: {error}
        </Text>
      ) : null}
      <Table variant="list" roundedCorners>
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Value</TableColumnHeader>
            {showCounts ? (
              <>
                <TableColumnHeader justify="end">Rows</TableColumnHeader>
                <TableColumnHeader>Relative to top value</TableColumnHeader>
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
                    <Box
                      aria-hidden
                      style={{
                        width: "100%",
                        minWidth: 120,
                        height: 6,
                        borderRadius: 3,
                        background: "var(--gray-a3)",
                        overflow: "hidden",
                      }}
                    >
                      <Box
                        style={{
                          width: `${((r.count ?? 0) / maxCount) * 100}%`,
                          height: "100%",
                          background: "var(--accent-9)",
                        }}
                      />
                    </Box>
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
