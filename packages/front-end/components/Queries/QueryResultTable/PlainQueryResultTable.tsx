import { ReactNode } from "react";
import { RESULT_TABLE_MAX_HEIGHT } from "./constants";

export default function PlainQueryResultTable({
  rows,
  columns,
  renderValue,
}: {
  rows: Record<string, unknown>[];
  columns: string[];
  renderValue: (value: unknown) => ReactNode;
}) {
  return (
    <div style={{ maxHeight: RESULT_TABLE_MAX_HEIGHT, overflow: "auto" }}>
      <table className="table table-bordered table-sm query-table">
        <thead>
          <tr style={{ position: "sticky", top: -1 }}>
            <th></th>
            {columns.map((key) => (
              <th key={key}>{key}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <th>{rowIndex}</th>
              {columns.map((key) => (
                <td key={key}>{renderValue(row[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
