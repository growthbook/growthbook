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

export type ChangesTableRow = {
  key: string;
  label: string;
  changed: boolean;
  before: ReactNode;
  after: ReactNode;
};

/** Each setting as it is on the left and as it will be on the right, tinted where it changes. */
export default function ChangesTable({
  before,
  after,
  rows,
}: {
  before: string;
  after: string;
  rows: ChangesTableRow[];
}) {
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
      {/* Only the header is ruled; the tints mark the changes. */}
      <TableBody
        style={
          {
            "--table-row-box-shadow": "none",
            "--table-cell-min-height": "auto",
          } as CSSProperties
        }
      >
        {rows.map((row) => (
          <TableRow key={row.key}>
            {/* Flush, so the labels line up with the page's other rows. */}
            <TableCell style={{ width: LABEL_WIDTH, paddingLeft: 0 }}>
              <DiffInset flush>
                <Text weight="medium" color="text-high">
                  {row.label}
                </Text>
              </DiffInset>
            </TableCell>
            <TableCell>
              <DiffInset tint={row.changed ? DIFF_TINT.before : undefined}>
                {row.before}
              </DiffInset>
            </TableCell>
            <TableCell style={AFTER_COLUMN}>
              <DiffInset tint={row.changed ? DIFF_TINT.after : undefined}>
                {row.after}
              </DiffInset>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
