import { FactTableInterface } from "back-end/types/fact-table";
import { Table, TableBody, TableRow, TableCell } from "@/ui/Table";

export interface Props {
  factTable: FactTableInterface;
}

export default function FactTableSchema({ factTable }: Props) {
  const columns = (factTable.columns || []).filter((col) => !col.deleted);

  return (
    <Table variant="standard" className="table-sm">
      <TableBody>
        {columns.map((col) => (
          <TableRow key={col.column}>
            <TableCell>{col.column}</TableCell>
            <TableCell>
              <em className="text-muted ml-1">
                {col.datatype === "date"
                  ? "date / datetime"
                  : !col.datatype
                    ? "unknown"
                    : col.datatype}
              </em>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
