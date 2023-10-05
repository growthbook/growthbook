import { FactTableInterface } from "back-end/types/fact-table";

export interface Props {
  factTable: FactTableInterface;
}

export default function ColumnTable({ factTable }: Props) {
  const columns = (factTable.columns || []).filter((col) => !col.deleted);

  return (
    <table className="table gbtable table-sm">
      <tbody>
        {columns.map((col) => (
          <tr key={col.column}>
            <td>{col.column}</td>
            <td>
              <em className="text-muted ml-1">
                {col.datatype === "date" ? "date / datetime" : col.datatype}
              </em>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
