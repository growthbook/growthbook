import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type { ContextualBanditSseStep } from "shared/experiments";
import Text from "@/ui/Text";
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
  close,
}: {
  entry: AttributeSseReduction;
  rootSse: number;
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
          ? "Splits on other attributes"
          : `Splits on ${entry.label}`
      }
      subheader={`Removed ${percentFormatter.format(
        fractionRemoved(entry.totalReduction, rootSse),
      )} of the starting within-context error.`}
      closeCta="Close"
      size="lg"
    >
      <Flex direction="column" gap="3">
        {steps.map((step) => (
          <Box
            key={`split-${step.numSplits}`}
            p="3"
            style={{
              border: "1px solid var(--gray-a5)",
              borderRadius: 6,
            }}
          >
            <SseSplitDetails step={step} />
          </Box>
        ))}
      </Flex>
    </ModalStandard>
  );
}

/**
 * Ranks context attributes by the total SSE (within-context error) reduction
 * their splits contributed while the tree was built, showing the top few plus
 * an "Other" bucket. Selecting a row opens a modal describing each split for
 * that attribute in the same format as the SSE plot tooltip.
 */
export default function ContextualBanditAttributeTable({
  steps,
}: {
  steps: ContextualBanditSseStep[];
}) {
  const rows = useMemo(() => attributeSseReductions(steps, 3), [steps]);
  const rootSse = useMemo(
    () => Math.max(...steps.map((s) => s.totalSse), 0),
    [steps],
  );
  const [selected, setSelected] = useState<AttributeSseReduction | null>(null);

  if (!rows.length) return null;

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
          {rows.map((row) => (
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

      {selected ? (
        <AttributeSplitsModal
          entry={selected}
          rootSse={rootSse}
          close={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}
