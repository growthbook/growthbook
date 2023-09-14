import { isProjectListValidForProject } from "shared/util";
import Link from "next/link";
import { useState } from "react";
import { date } from "shared/dates";
import Markdown from "@/components/Markdown/Markdown";
import { useDefinitions } from "@/services/DefinitionsContext";
import FactTableModal from "@/components/FactTables/FactTableModal";
import { GBAddCircle } from "@/components/Icons";

export default function FactTablesPage() {
  const { factTables, getDatasourceById, project } = useDefinitions();

  const [createFactOpen, setCreateFactOpen] = useState(false);

  const filteredFactTables = project
    ? factTables.filter((t) =>
        isProjectListValidForProject(t.projects, project)
      )
    : factTables;

  return (
    <div className="pagecontents container-fluid pt-5">
      {createFactOpen && (
        <FactTableModal close={() => setCreateFactOpen(false)} />
      )}
      <h1>Fact Tables</h1>
      <p>
        Fact Tables let you organize your metrics, cut down on repetitive tasks,
        and unlock massive SQL cost savings.
      </p>
      <button
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          setCreateFactOpen(true);
        }}
      >
        <GBAddCircle /> Add Fact Table
      </button>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Data Source</th>
            <th>User Id Types</th>
            <th>Facts</th>
            <th>Last Updated</th>
          </tr>
        </thead>
        <tbody>
          {filteredFactTables.map((f) => (
            <tr key={f.id}>
              <td>
                <Link href={`/fact-tables/${f.id}`}>{f.name}</Link>
              </td>
              <td>
                <div style={{ maxHeight: 80, overflow: "hidden" }}>
                  <Markdown>{f.description}</Markdown>
                </div>
              </td>
              <td>{getDatasourceById(f.datasource)?.name || f.datasource}</td>
              <td>{f.userIdTypes.join(", ")}</td>
              <td>{f.facts.length}</td>
              <td>{date(f.dateUpdated)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
