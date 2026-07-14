import { FactTableInterface } from "shared/types/fact-table";

export interface Props {
  factTable: FactTableInterface;
}

export default function FactTableSchema({ factTable }: Props) {
  // Only show real (SQL-detected) columns. Virtual columns are computed
  // expressions and can't be referenced inside raw SQL fragments.
  const columns = (factTable.columns || []).filter(
    (col) => !col.deleted && !col.isVirtual,
  );

  return (
    <table className="table gbtable table-sm">
      <tbody>
        {columns.map((col) => (
          <tr key={col.column}>
            <td>{col.column}</td>
            <td>
              <em className="text-muted ml-1">
                {col.datatype === "date"
                  ? "date / datetime"
                  : !col.datatype
                    ? "unknown"
                    : col.datatype}
              </em>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
