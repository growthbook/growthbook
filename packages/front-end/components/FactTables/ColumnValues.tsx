import { Box, Flex } from "@radix-ui/themes";
import { ColumnInterface } from "shared/types/fact-table";
import { DEFAULT_TOP_VALUES_LOOKBACK_VALUE } from "shared/settings";
import { useState } from "react";
import useOrgSettings from "@/hooks/useOrgSettings";
import { ValueCount } from "@/hooks/useColumnValueCounts";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { Popover } from "@/ui/Popover";

const CHIPS = 4;

export function useTopValuesLookbackDays(): number {
  const { topValuesLookbackValue } = useOrgSettings();
  return topValuesLookbackValue ?? DEFAULT_TOP_VALUES_LOOKBACK_VALUE;
}

export function LoadRowCountsButton({
  loading,
  error,
  onLoad,
}: {
  loading: boolean;
  error?: string;
  onLoad: () => void;
}) {
  return (
    <Flex direction="column" gap="1" align="start">
      <Button size="sm" variant="outline" loading={loading} onClick={onLoad}>
        Load row counts
      </Button>
      {error ? (
        <Text size="sm" color="text-low">
          {error}
        </Text>
      ) : null}
    </Flex>
  );
}

export default function ColumnValues({
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
  const [open, setOpen] = useState(false);
  const lookbackDays = useTopValuesLookbackDays();
  const values = column.topValues || [];
  if (!values.length) return null;

  const rows: { value: string; count?: number }[] =
    counts ?? values.map((value) => ({ value }));

  return (
    <Flex gap="1" align="center" wrap="wrap">
      {values.slice(0, CHIPS).map((v) => (
        <Badge key={v} label={v} color="gray" variant="soft" />
      ))}
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="bottom"
        align="start"
        contentStyle={{ width: 360 }}
        trigger={
          <Link>
            {values.length > CHIPS
              ? `+${values.length - CHIPS} more`
              : "Details"}
          </Link>
        }
        content={
          <Flex direction="column" gap="2">
            {!counts && onLoad ? (
              <LoadRowCountsButton
                loading={loading}
                error={error}
                onLoad={onLoad}
              />
            ) : null}
            <Box style={{ maxHeight: 300, overflowY: "auto" }}>
              {rows.map((r) => (
                <Flex key={r.value} justify="between" gap="3" py="1">
                  <Text>{r.value}</Text>
                  {r.count !== undefined ? (
                    <Text color="text-mid">{r.count.toLocaleString()}</Text>
                  ) : null}
                </Flex>
              ))}
            </Box>
            <Text size="sm" color="text-low">
              Top {rows.length} values over the last {lookbackDays} days
              {counts
                ? ". Counts may be approximate on some data sources."
                : ""}
            </Text>
          </Flex>
        }
      />
    </Flex>
  );
}
