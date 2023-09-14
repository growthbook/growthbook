import { useRouter } from "next/router";
import Link from "next/link";
import { useState } from "react";
import { date } from "shared/dates";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import Markdown from "@/components/Markdown/Markdown";
import { GBAddCircle, GBCircleArrowLeft } from "@/components/Icons";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import FactTableModal from "@/components/FactTables/FactTableModal";
import Code from "@/components/SyntaxHighlighting/Code";
import FactModal from "@/components/FactTables/FactModal";

export default function FactTablePage() {
  const router = useRouter();
  const { ftid } = router.query;

  const [editOpen, setEditOpen] = useState(false);

  const [editFactOpen, setEditFactOpen] = useState("");
  const [newFactOpen, setNewFactOpen] = useState(false);

  const { apiCall } = useAuth();

  const {
    factTables,
    ready,
    mutateDefinitions,
    getProjectById,
    projects,
    getDatasourceById,
  } = useDefinitions();
  const factTable = factTables.find((f) => f.id === ftid);

  if (!ready) return <LoadingOverlay />;

  if (!factTable) {
    return (
      <div className="alert alert-danger">
        Could not find the requested fact table.{" "}
        <Link href="/fact-tables">Back to all fact tables</Link>
      </div>
    );
  }

  return (
    <div className="pagecontents container-fluid pt-5">
      {editOpen && (
        <FactTableModal close={() => setEditOpen(false)} existing={factTable} />
      )}
      {newFactOpen && (
        <FactModal close={() => setNewFactOpen(false)} factTable={factTable} />
      )}
      {editFactOpen && (
        <FactModal
          close={() => setEditFactOpen("")}
          factTable={factTable}
          existing={factTable.facts.find((f) => f.id === editFactOpen)}
        />
      )}
      <div className="row mb-3">
        <div className="col-auto">
          <Link href="/fact-tables">
            <a>
              <GBCircleArrowLeft /> Back to all fact tables
            </a>
          </Link>
          <h1>{factTable.name}</h1>
        </div>
        <div className="ml-auto">
          <MoreMenu>
            <button
              className="dropdown-link"
              onClick={(e) => {
                e.preventDefault();
                setEditOpen(true);
              }}
            >
              Edit Fact Table
            </button>
            <DeleteButton
              className="dropdown-link"
              displayName="Fact Table"
              useIcon={false}
              text="Delete Fact Table"
              onClick={async () => {
                await apiCall(`/fact-tables/${factTable.id}`, {
                  method: "DELETE",
                });
                mutateDefinitions();
                router.push("/fact-tables");
              }}
            />
          </MoreMenu>
        </div>
      </div>
      <div className="row mb-3">
        {projects.length > 0 ? (
          <div className="col-auto">
            Projects:{" "}
            {factTable.projects.length > 0 ? (
              factTable.projects
                .map((p) => (
                  <span className="badge badge-secondary" key={p}>
                    {getProjectById(p)?.name || p}
                  </span>
                ))
                .join("")
            ) : (
              <em>None</em>
            )}
          </div>
        ) : null}
        <div className="col-auto">
          Data source:{" "}
          <Link href={`/datasources/${factTable.datasource}`}>
            <a className="font-weight-bold">
              {getDatasourceById(factTable.datasource)?.name || "Unknown"}
            </a>
          </Link>
        </div>
      </div>

      {factTable.description && (
        <>
          <h3>Description</h3>
          <div className="appbox p-3 bg-light mb-3">
            <Markdown>{factTable.description}</Markdown>
          </div>
        </>
      )}

      <div className="mb-4">
        <h3>SQL Definition</h3>
        <Code code={factTable.sql} language="sql" expandable={true} />
      </div>

      <div className="row mb-2">
        <div className="col-auto">
          <h3 className="mb-0">Facts</h3>
        </div>
        <div className="ml-auto col-auto">
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.preventDefault();
              setNewFactOpen(true);
            }}
          >
            <GBAddCircle /> Add Fact
          </button>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Type</th>
            <th>Column</th>
            <th>Number Format</th>
            <th>WHERE filter</th>
            <th>Last Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {factTable.facts.map((fact) => (
            <tr key={fact.id}>
              <td>{fact.name}</td>
              <td>
                <Markdown>{fact.description}</Markdown>
              </td>
              <td>{fact.type}</td>
              <td>{fact.type === "number" ? fact.column : ""}</td>
              <td>{fact.type === "number" ? fact.numberFormat : ""}</td>
              <td>
                <Code language="sql" expandable={true} code={fact.where} />
              </td>
              <td>{date(fact.dateUpdated)}</td>
              <td>
                <MoreMenu>
                  <button
                    className="dropdown-item"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditFactOpen(fact.id);
                    }}
                  >
                    Edit
                  </button>
                  <DeleteButton
                    displayName="Fact"
                    useIcon={false}
                    text="Delete"
                    onClick={async () => {
                      await apiCall(`/fact-tables/${factTable.id}/${fact.id}`, {
                        method: "DELETE",
                      });
                    }}
                  />
                </MoreMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
