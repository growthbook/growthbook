import { FactTableInterface } from "back-end/types/fact-table";

export interface Props {
  factTable: FactTableInterface;
}

export default function ColumnTable({ factTable }: Props) {
  return (
    <table className="table gbtable">
      <tbody>
        {factTable.columns?.map((col) => (
          <tr key={col.column}>
            <td>{col.column}</td>
            <td>
              <em className="text-muted">
                {col.datatype === "date" ? "date / datetime" : col.datatype}
              </em>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
