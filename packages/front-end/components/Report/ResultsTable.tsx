import { FC } from "react";
import { QueryResult } from "../../types/reports";

const ResultsTable: FC<QueryResult> = ({ rows }) => {
  if (!rows || !rows.length) {
    return (
      <p>
        <em>Your SQL results will appear here once you run the query.</em>
      </p>
    );
  }

  return (
    <table
      className="table table-bordered"
      style={{
        maxHeight: 300,
        overflow: "auto",
      }}
    >
      <thead>
        <tr>
          {Object.keys(rows[0]).map((k) => (
            <th key={k}>{k}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {Object.keys(row).map((k) => (
              <td key={k}>{row[k] ?? <em className="text-muted">null</em>}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default ResultsTable;
