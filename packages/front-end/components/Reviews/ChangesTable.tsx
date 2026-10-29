import { CSSProperties, ReactNode } from "react";
import { Box } from "@radix-ui/themes";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import { LABEL_WIDTH } from "@/components/Experiment/TabbedPage/SetupFieldRow";

// A diff's before and after halves, as the feature diff colours them.
const DIFF_TINT = {
  before: { background: "var(--red-a2)", borderColor: "var(--red-a5)" },
  after: { background: "var(--green-a2)", borderColor: "var(--green-a5)" },
} as const;
type DiffTint = (typeof DIFF_TINT)[keyof typeof DIFF_TINT];

// The room a tinted side takes. Labels and headers take it too (`flush` drops
// the sides, for the label column) so every cell's text starts level.
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

type Line = {
  key: string;
  label: ReactNode;
  before?: ReactNode;
  after?: ReactNode;
};

type ChangesTableGroup = {
  key: string;
  rows: ChangesTableRow[];
  /** Under the rows, in the label column: what opens or widens the group. */
  footer?: ReactNode;
};

/** Each setting as it is on the left and as it will be on the right, tinted where it changes. */
export default function ChangesTable({
  before,
  after,
  groups,
  showDetails,
}: {
  before: string;
  after: string;
  /** Rows that belong together, each group ruled off from the next. */
  groups: ChangesTableGroup[];
  showDetails: boolean;
}) {
  const shown = groups.filter((group) => group.rows.length || group.footer);
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
  // A line of a group: its label and what's either side. The group's last line
  // carries its rule.
  const row = (line: Line, ruledAbove: boolean, ruledBelow: boolean) => {
    const gap = rowGap(ruledAbove, ruledBelow);
    return (
      <TableRow
        key={line.key}
        style={
          ruledBelow
            ? ({
                "--table-row-box-shadow": "inset 0 -1px var(--gray-a5)",
              } as CSSProperties)
            : undefined
        }
      >
        {/* Flush, so the labels line up with the page's other rows. */}
        <TableCell style={{ width: LABEL_WIDTH, paddingLeft: 0, ...gap }}>
          {line.label}
        </TableCell>
        <TableCell style={gap}>{line.before}</TableCell>
        <TableCell style={{ ...AFTER_COLUMN, ...gap }}>{line.after}</TableCell>
      </TableRow>
    );
  };
  return (
    // Fixed, so the two sides split what the labels leave evenly.
    <Table variant="ghost" layout="fixed">
      <TableHeader>
        <TableRow style={{ verticalAlign: "middle" }}>
          <TableColumnHeader style={{ width: LABEL_WIDTH, paddingLeft: 0 }} />
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
        {shown.flatMap((group, g) => {
          const lines: Line[] = group.rows.map((r) => ({
            key: r.key,
            label: (
              <DiffInset flush>
                <Text weight="medium" color="text-high">
                  {r.label}
                </Text>
              </DiffInset>
            ),
            before: side(r, "before"),
            after: side(r, "after"),
          }));
          if (group.footer) {
            lines.push({ key: `${group.key}.footer`, label: group.footer });
          }
          return lines.map((line, i) =>
            row(
              line,
              i === 0 && g > 0,
              i === lines.length - 1 && g < shown.length - 1,
            ),
          );
        })}
      </TableBody>
    </Table>
  );
}
