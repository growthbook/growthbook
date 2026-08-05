import { FactTableInterface } from "shared/types/fact-table";
import Link from "@/ui/Link";

export interface Props {
  factTable: FactTableInterface;
  // When provided, each column name becomes clickable and calls this with the
  // column name (e.g. to insert it into a SQL expression at the cursor).
  onColumnClick?: (column: string) => void;
  // Optionally hide a column (e.g. the virtual column currently being edited,
  // so it can't reference itself).
  excludeColumn?: string;
}

export default function FactTableSchema({
  factTable,
  onColumnClick,
  excludeColumn,
}: Props) {
  const columns = (factTable.columns || []).filter(
    (col) => !col.deleted && col.column !== excludeColumn,
  );

  return (
    <table className="table gbtable table-sm">
      <tbody>
        {columns.map((col) => (
          <tr key={col.column}>
            <td>
              {onColumnClick ? (
                <Link
                  onClick={(e) => {
                    e.preventDefault();
                    onColumnClick(col.column);
                  }}
                >
                  {col.column}
                </Link>
              ) : (
                col.column
              )}
            </td>
            <td>
              <em className="text-muted ml-1">
                {col.datatype === "date"
                  ? "date / datetime"
                  : !col.datatype
                    ? "unknown"
                    : col.datatype}
                {col.isVirtual ? " (virtual)" : ""}
              </em>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
