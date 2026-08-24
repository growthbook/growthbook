import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import { ApiContextualBanditInterface } from "shared/validators";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
  TableRowHeaderCell,
} from "@/ui/Table";
import VariationLabel from "@/ui/VariationLabel";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBInfo } from "@/components/Icons";
import { getVariationColor } from "@/services/features";

const numberFormatter = new Intl.NumberFormat();

/** Number of variations shown before the "Show more" toggle is needed. */
const DEFAULT_VISIBLE_ROWS = 5;

type OverviewRow = {
  id: string;
  index: number;
  name: string;
  mean: number | null;
  weight: number | null;
  units: number;
};

/**
 * Geometry for a horizontal "data bar" drawn from a zero baseline. `left` and
 * `width` are percentages of the track so bars in the same column share a
 * scale, and negative values grow left of the baseline.
 */
function barGeometry(
  value: number,
  values: (number | null)[],
): { left: number; width: number } {
  const nums = values.filter((v): v is number => v !== null);
  const domainMax = Math.max(0, ...nums);
  const domainMin = Math.min(0, ...nums);
  const span = domainMax - domainMin || 1;
  const pct = (v: number) => ((v - domainMin) / span) * 100;
  const zero = pct(0);
  const val = pct(value);
  return { left: Math.min(zero, val), width: Math.abs(val - zero) };
}

function DataBarCell({
  value,
  index,
  columnValues,
  formatValue,
}: {
  value: number | null;
  index: number;
  columnValues: (number | null)[];
  formatValue: (value: number) => string;
}) {
  const geometry = value === null ? null : barGeometry(value, columnValues);

  return (
    <Flex direction="column" gap="1" style={{ minWidth: 120 }}>
      <Text size="sm">{value === null ? "—" : formatValue(value)}</Text>
      {geometry ? (
        <Box
          style={{
            position: "relative",
            height: 6,
            width: "100%",
            background: "var(--slate-a3)",
            borderRadius: 3,
          }}
        >
          <Box
            style={{
              position: "absolute",
              top: 0,
              height: 6,
              left: `${geometry.left}%`,
              width: `${geometry.width}%`,
              minWidth: 2,
              background: getVariationColor(index, true),
              borderRadius: 3,
            }}
          />
        </Box>
      ) : null}
    </Flex>
  );
}

/**
 * Compact tabular view combining the overall variation means and weights, one
 * row per variation. Each numeric cell carries an inline data bar so the
 * magnitude comparison of the separate bar charts is preserved in a single,
 * aligned view. Rows are sorted by mean descending, with variations missing a
 * mean listed last.
 */
export default function ContextualBanditOverviewTable({
  variations,
  means,
  weights,
  units,
  unitDisplayName,
  goalMetricName,
  formatMean,
  formatWeight,
}: {
  variations: ApiContextualBanditInterface["variations"];
  means: (number | null)[];
  weights: (number | null)[];
  units: number[];
  unitDisplayName: string;
  goalMetricName: string;
  formatMean: (value: number) => string;
  formatWeight: (value: number) => string;
}) {
  const [expanded, setExpanded] = useState(false);

  const rows: OverviewRow[] = useMemo(
    () =>
      variations
        .map((v, index) => ({
          id: v.id,
          index,
          name: v.name,
          mean: means[index] ?? null,
          weight: weights[index] ?? null,
          units: units[index] ?? 0,
        }))
        .sort((a, b) => (b.mean ?? -Infinity) - (a.mean ?? -Infinity)),
    [variations, means, weights, units],
  );

  if (!rows.length) return null;

  const visibleRows = expanded ? rows : rows.slice(0, DEFAULT_VISIBLE_ROWS);
  const hiddenCount = rows.length - DEFAULT_VISIBLE_ROWS;

  const meanColumn = visibleRows.map((r) => r.mean);
  const weightColumn = visibleRows.map((r) => r.weight);

  return (
    <Box>
      <Table variant="ghost" size="sm">
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Variation</TableColumnHeader>
            <TableColumnHeader>
              Weight{" "}
              <Tooltip body="Current share of traffic.">
                <GBInfo />
              </Tooltip>
            </TableColumnHeader>
            <TableColumnHeader>
              Mean {goalMetricName}{" "}
              <Tooltip
                body={`Mean ${goalMetricName} if all traffic were allocated to a single variation.`}
              >
                <GBInfo />
              </Tooltip>
            </TableColumnHeader>
            <TableColumnHeader justify="end">
              {unitDisplayName}{" "}
              <Tooltip body="Number of units historically allocated.">
                <GBInfo />
              </Tooltip>
            </TableColumnHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((row) => (
            <TableRow key={row.id}>
              <TableRowHeaderCell style={{ minWidth: 160 }}>
                <VariationLabel
                  number={row.index}
                  name={row.name}
                  size="sm"
                  maxWidth="200px"
                />
              </TableRowHeaderCell>
              <TableCell>
                <DataBarCell
                  value={row.weight}
                  index={row.index}
                  columnValues={weightColumn}
                  formatValue={formatWeight}
                />
              </TableCell>
              <TableCell>
                <DataBarCell
                  value={row.mean}
                  index={row.index}
                  columnValues={meanColumn}
                  formatValue={formatMean}
                />
              </TableCell>
              <TableCell justify="end">
                <Text size="sm" color="text-low">
                  {numberFormatter.format(row.units)}
                </Text>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {hiddenCount > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          mt="2"
          icon={expanded ? <PiCaretDown /> : <PiCaretRight />}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "Show less" : `Show ${hiddenCount} more`}
        </Button>
      ) : null}
    </Box>
  );
}
