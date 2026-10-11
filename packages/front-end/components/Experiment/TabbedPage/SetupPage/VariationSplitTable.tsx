import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import VariationNumber from "@/ui/VariationNumber";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

// The variations-and-splits table (set in review): the Edit Split % modal's
// (SplitEditModal, editable fields) and the Edit Traffic & Variations
// modal's read-only one (EditTrafficModal), styled the same. A row per
// variation: its number in a circle of its colour, 8px before its name, and
// its split in a 108px column at the right edge, under a Variation / Split %
// header row. Built only from design-system parts: @/ui/Table,
// @/ui/VariationNumber, @/ui/Text.

// The split column's width (108px, set in review; it was 96px): the Split %
// fields' width, enough for "100.0", with room for the label and Split Even
// above.
export const SPLIT_COLUMN_PX = 108;

// The header cells (set in review): 12px clear between the labels and the
// divider below them. The table's 44px minimum row height had left 15px;
// sized to fit instead, with the divider's 1px (drawn inside the cell's
// bottom edge) added to the 12px padding. The labels take the fields'
// value colour, gray-12 (set in review); the table's rows are otherwise
// --color-text-high (indigo-12).
const HEADER_CELL_STYLE = {
  height: "auto",
  paddingBottom: "calc(var(--space-3) + 1px)",
  color: "var(--gray-12)",
};

// listStyle (set in review; the Edit Split % modal): the header labels as
// the experiments list's column headers, 12px at 500 in --slate-11, and the
// variation names at 500 in the modal title's colour, --text-color-main
// (tried --color-text-high).
const LIST_HEADER_CELL_STYLE = {
  ...HEADER_CELL_STYLE,
  color: "var(--slate-11)",
};

export default function VariationSplitTable({
  variations,
  splitHeaderAction,
  renderSplit,
  listStyle = false,
}: {
  // In the page's order.
  variations: { id: string; name: string }[];
  // Beside the Split % label, e.g. Split Even.
  splitHeaderAction?: ReactNode;
  // The split cell's content, set at the column's right edge. Its name is
  // the element with id `split-label-${variation.id}` (for aria-labelledby).
  renderSplit: (
    variation: { id: string; name: string },
    i: number,
  ) => ReactNode;
  // See LIST_HEADER_CELL_STYLE. Optional and additive.
  listStyle?: boolean;
}) {
  const headerCellStyle = listStyle
    ? LIST_HEADER_CELL_STYLE
    : HEADER_CELL_STYLE;
  return (
    <Table variant="ghost">
      <TableHeader>
        <TableRow>
          {/* Labels sized as the Stats Engine label (set in review): 12px at
            weight 500. */}
          <TableColumnHeader style={headerCellStyle}>
            <Text as="div" size="sm" weight="medium">
              Variation
            </Text>
          </TableColumnHeader>
          <TableColumnHeader style={headerCellStyle}>
            {/* Starts where the values do (set in review): a box the split
              column's width at the right edge, inset by a field's 8px text
              padding (Radix size 2). An action sits 8px to the label's right
              (set in review), on one line; it runs past the box into the
              cell's padding rather than move the label. */}
            <Flex justify="end">
              <Flex
                align="center"
                gap="2"
                style={{
                  width: SPLIT_COLUMN_PX,
                  paddingLeft: "var(--space-2)",
                  whiteSpace: "nowrap",
                }}
              >
                {/* On one line (fixed in review): Text sets its own
                  white-space, so the row's nowrap didn't reach it. */}
                <Text as="div" size="sm" weight="medium" whiteSpace="nowrap">
                  Split %
                </Text>
                {splitHeaderAction}
              </Flex>
            </Flex>
          </TableColumnHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {variations.map((v, i) => (
          <TableRow key={v.id} align="center">
            <TableCell>
              <Flex align="center" gap="2" minWidth="0">
                <VariationNumber number={i} />
                <Text weight={listStyle ? "medium" : "semibold"} truncate>
                  <span
                    id={`split-label-${v.id}`}
                    style={
                      listStyle
                        ? { color: "var(--text-color-main)" }
                        : undefined
                    }
                  >
                    {v.name}
                  </span>
                </Text>
              </Flex>
            </TableCell>
            <TableCell justify="end">
              {/* At the cell's right edge, under the right-aligned Split %
                header (set in review). The cell's justify aligns text only;
                a field is a block. */}
              <Flex justify="end">{renderSplit(v, i)}</Flex>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// A read-only split value, placed as a Split % field's value sits: the
// column's width, its text 8px in, so it lines up with the header label,
// and the field's 32px height, so the rows are the same height as the Edit
// Split % modal's.
export function SplitValueText({ children }: { children: ReactNode }) {
  return (
    <Flex
      align="center"
      style={{
        width: SPLIT_COLUMN_PX,
        minHeight: 32,
        paddingLeft: "var(--space-2)",
      }}
    >
      <Text>{children}</Text>
    </Flex>
  );
}
