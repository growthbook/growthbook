import { CSSProperties, ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { LABEL_WIDTH } from "@/components/Experiment/TabbedPage/SetupFieldRow";

// A diff's before and after halves, as the feature diff colours them.
const DIFF_TINT = {
  before: { background: "var(--red-a2)", borderColor: "var(--red-a5)" },
  after: { background: "var(--green-a2)", borderColor: "var(--green-a5)" },
} as const;
type DiffTint = (typeof DIFF_TINT)[keyof typeof DIFF_TINT];

/**
 * The room a tinted side takes. Labels and headers take it too (`flush` drops
 * the sides, for the label column) so every cell's text starts level.
 */
function DiffInset({
  tint,
  flush = false,
  children,
}: {
  tint?: DiffTint;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <Box
      px={flush ? "0" : "2"}
      py="1"
      minWidth="0"
      style={{
        borderRadius: "var(--radius-3)",
        border: "1px solid transparent",
        ...tint,
      }}
    >
      {children}
    </Box>
  );
}

function ColumnLabel({ children }: { children: string }) {
  return (
    <Text size="md" weight="semibold" color="text-low">
      {children}
    </Text>
  );
}

// The rule between the before and after columns.
const AFTER_COLUMN = { borderLeft: "1px solid var(--gray-a5)" };

// Rows sit close, the tints already setting them apart; a group's rule gets
// more room.
const rowGap = (ruledAbove: boolean, ruledBelow: boolean) => ({
  paddingTop: ruledAbove ? "var(--space-3)" : "var(--space-2)",
  paddingBottom: ruledBelow ? "var(--space-3)" : "var(--space-2)",
});

export type ChangesTableRow = {
  key: string;
  label: string;
  changed: boolean;
  before: ReactNode;
  after: ReactNode;
  /** The settings a summarizing row stands for, shown in it with the details. */
  details?: { label: string; before: ReactNode; after: ReactNode }[];
};

/** Each setting as it is on the left and as it will be on the right, tinted where it changes. */
export default function ChangesTable({
  before,
  after,
  groups,
}: {
  before: string;
  after: string;
  /** Rows that belong together, each group ruled off from the next. */
  groups: ChangesTableRow[][];
}) {
  const shown = groups.filter((group) => group.length);
  const [showDetails, setShowDetails] = useState(false);
  const hasDetails = shown.some((group) =>
    group.some((row) => row.details?.length),
  );
  const side = (row: ChangesTableRow, which: keyof typeof DIFF_TINT) => (
    <DiffInset tint={row.changed ? DIFF_TINT[which] : undefined}>
      {row[which]}
      {showDetails
        ? row.details?.map((detail) => (
            <Box key={detail.label} mt="1" style={{ overflowWrap: "anywhere" }}>
              <Text size="sm" color="text-mid">
                {detail.label}: {detail[which]}
              </Text>
            </Box>
          ))
        : null}
    </DiffInset>
  );
  return (
    // Fixed, so the two sides split what the labels leave evenly.
    <Table variant="ghost" layout="fixed">
      <TableHeader>
        <TableRow style={{ verticalAlign: "middle" }}>
          <TableColumnHeader style={{ width: LABEL_WIDTH, paddingLeft: 0 }}>
            {hasDetails ? (
              <Link
                size="sm"
                aria-expanded={showDetails}
                onClick={(e) => {
                  e.preventDefault();
                  setShowDetails(!showDetails);
                }}
              >
                <Flex align="center" gap="1">
                  {showDetails ? "Hide details" : "Show details"}
                  {showDetails ? <PiCaretDown /> : <PiCaretRight />}
                </Flex>
              </Link>
            ) : null}
          </TableColumnHeader>
          <TableColumnHeader>
            <DiffInset>
              <ColumnLabel>{before}</ColumnLabel>
            </DiffInset>
          </TableColumnHeader>
          <TableColumnHeader style={AFTER_COLUMN}>
            <DiffInset>
              <ColumnLabel>{after}</ColumnLabel>
            </DiffInset>
          </TableColumnHeader>
        </TableRow>
      </TableHeader>
      {/* Only the header and the groups are ruled; the tints mark the changes. */}
      <TableBody
        style={
          {
            "--table-row-box-shadow": "none",
            "--table-cell-min-height": "auto",
          } as CSSProperties
        }
      >
        {shown.flatMap((group, g) =>
          group.map((row, i) => {
            const ruledBelow = i === group.length - 1 && g < shown.length - 1;
            const gap = rowGap(i === 0 && g > 0, ruledBelow);
            return (
              <TableRow
                key={row.key}
                style={
                  ruledBelow
                    ? ({
                        "--table-row-box-shadow": "inset 0 -1px var(--gray-a5)",
                      } as CSSProperties)
                    : undefined
                }
              >
                {/* Flush, so the labels line up with the page's other rows. */}
                <TableCell
                  style={{ width: LABEL_WIDTH, paddingLeft: 0, ...gap }}
                >
                  <DiffInset flush>
                    <Text weight="medium" color="text-high">
                      {row.label}
                    </Text>
                  </DiffInset>
                </TableCell>
                <TableCell style={gap}>{side(row, "before")}</TableCell>
                <TableCell style={{ ...AFTER_COLUMN, ...gap }}>
                  {side(row, "after")}
                </TableCell>
              </TableRow>
            );
          }),
        )}
      </TableBody>
    </Table>
  );
}
