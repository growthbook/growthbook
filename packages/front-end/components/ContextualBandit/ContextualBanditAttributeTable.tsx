import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import type { ContextualBanditSseStep } from "shared/experiments";
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
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import {
  attributeSseReductions,
  SseSplitDetails,
  type AttributeSseReduction,
} from "@/components/ContextualBandit/ContextualBanditSseChart";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

function fractionRemoved(reduction: number, rootSse: number): number {
  return rootSse > 0 ? reduction / rootSse : 0;
}

function AttributeSplitsModal({
  entry,
  rootSse,
  sseByNumSplits,
  close,
}: {
  entry: AttributeSseReduction;
  rootSse: number;
  sseByNumSplits: Map<number, number>;
  close: () => void;
}) {
  const steps = useMemo(
    () => [...entry.steps].sort((a, b) => a.numSplits - b.numSplits),
    [entry.steps],
  );

  return (
    <ModalStandard
      open
      close={close}
      trackingEventModalType="contextual-bandit-attribute-splits"
      header={
        entry.isOther
          ? "Splits on Other Attributes"
          : `Splits on ${entry.label}`
      }
      subheader={`Removed ${percentFormatter.format(
        fractionRemoved(entry.totalReduction, rootSse),
      )} of the starting within-context error.`}
      closeCta="Close"
      size="lg"
    >
      <Flex direction="column" gap="3">
        {steps.map((step) => {
          const prevSse = sseByNumSplits.get(step.numSplits - 1);
          const gain = prevSse !== undefined ? prevSse - step.totalSse : 0;
          return (
            <Box
              key={`split-${step.numSplits}`}
              p="3"
              style={{
                border: "1px solid var(--gray-a5)",
                borderRadius: 6,
              }}
            >
              <SseSplitDetails
                step={step}
                variant="detail"
                percentReducedLabel={percentFormatter.format(
                  fractionRemoved(gain, rootSse),
                )}
              />
            </Box>
          );
        })}
      </Flex>
    </ModalStandard>
  );
}

/** Number of attributes shown before the "Show more" toggle is needed. */
const DEFAULT_VISIBLE_ROWS = 5;

/**
 * Ranks context attributes by the total SSE (within-context error) reduction
 * their splits contributed while the tree was built.
 */
export default function ContextualBanditAttributeTable({
  steps,
}: {
  steps: ContextualBanditSseStep[];
}) {
  const rows = useMemo(
    () => attributeSseReductions(steps, Number.MAX_SAFE_INTEGER),
    [steps],
  );
  const rootSse = useMemo(
    () => Math.max(...steps.map((s) => s.totalSse), 0),
    [steps],
  );
  const sseByNumSplits = useMemo(() => {
    const map = new Map<number, number>();
    steps.forEach((s) => map.set(s.numSplits, s.totalSse));
    return map;
  }, [steps]);
  const [selected, setSelected] = useState<AttributeSseReduction | null>(null);
  const [expanded, setExpanded] = useState(false);

  if (!rows.length) return null;

  const visibleRows = expanded ? rows : rows.slice(0, DEFAULT_VISIBLE_ROWS);
  const hiddenCount = rows.length - DEFAULT_VISIBLE_ROWS;

  return (
    <>
      <Table variant="ghost" size="sm" style={{ maxWidth: 420 }}>
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Attribute</TableColumnHeader>
            <TableColumnHeader justify="end">Error removed</TableColumnHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((row) => (
            <TableRow
              key={row.key}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(row)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(row);
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <TableRowHeaderCell>
                <Text size="sm" weight="medium">
                  {row.isOther ? "Other" : row.label}
                </Text>
              </TableRowHeaderCell>
              <TableCell justify="end">
                <Text size="sm">
                  {percentFormatter.format(
                    fractionRemoved(row.totalReduction, rootSse),
                  )}
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

      {selected ? (
        <AttributeSplitsModal
          entry={selected}
          rootSse={rootSse}
          sseByNumSplits={sseByNumSplits}
          close={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}
