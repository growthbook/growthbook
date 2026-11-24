import { ReactNode } from "react";
import { Box } from "@radix-ui/themes";
import Table, { TableBody, TableCell, TableRow } from "@/ui/Table";
import Tooltip from "@/ui/Tooltip";
import VariationNumber from "@/ui/VariationNumber";
import styles from "./RuleVariationsTable.module.scss";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

type RuleVariationRow = {
  key: string;
  name: string;
  // Absent where the rule doesn't set the split, as a Bandit's.
  weight?: number;
  value: ReactNode;
};

export default function RuleVariationsTable({
  rows,
}: {
  rows: RuleVariationRow[];
}) {
  return (
    <Table variant="surface" className={styles.table}>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={row.key} style={{ color: "var(--color-text-high)" }}>
            <TableCell style={{ whiteSpace: "nowrap" }}>
              <Tooltip content={row.name}>
                <Box className={styles.marker}>
                  <VariationNumber number={i} />
                </Box>
              </Tooltip>
            </TableCell>
            {row.weight !== undefined ? (
              <TableCell
                style={{ color: "var(--color-text-mid)", textAlign: "right" }}
              >
                {percentFormatter.format(row.weight)}
              </TableCell>
            ) : null}
            <TableCell width="100%">{row.value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
