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
import usePermissions from "@/hooks/usePermissions";
import { useSearch } from "@/services/search";
import Tooltip from "@/components/Tooltip/Tooltip";
import Field from "@/components/Forms/Field";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";

export default function FactTablePage() {
  const router = useRouter();
  const { ftid } = router.query;

  const [editOpen, setEditOpen] = useState(false);

  const [editFactOpen, setEditFactOpen] = useState("");
  const [newFactOpen, setNewFactOpen] = useState(false);

  const { apiCall } = useAuth();

  const permissions = usePermissions();

  const {
    factTables,
    ready,
    mutateDefinitions,
    getProjectById,
    projects,
    getDatasourceById,
  } = useDefinitions();
  const factTable = factTables.find((f) => f.id === ftid);

  const { items, searchInputProps, isFiltered, SortableTH, clear } = useSearch({
    items: factTable?.facts || [],
    defaultSortField: "name",
    localStorageKey: "facts",
    searchFields: ["name^3", "description", "column^2", "where"],
  });

  if (!ready) return <LoadingOverlay />;

  if (!factTable) {
    return (
      <div className="alert alert-danger">
        Could not find the requested fact table.{" "}
        <Link href="/fact-tables">Back to all fact tables</Link>
      </div>
    );
  }

  const canEdit = permissions.check(
    "manageFactTables",
    factTable.projects || ""
  );

  return (
    <div className="pagecontents container-fluid">
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
          <h1 className="mb-0">{factTable.name}</h1>
        </div>
        {canEdit && (
          <div className="ml-auto">
            <MoreMenu>
              <button
                className="dropdown-item"
                onClick={(e) => {
                  e.preventDefault();
                  setEditOpen(true);
                }}
              >
                Edit Fact Table
              </button>
              <DeleteButton
                className="dropdown-item"
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
        )}
      </div>
      <div className="row mb-3">
        {projects.length > 0 ? (
          <div className="col-auto">
            Projects:{" "}
            {factTable.projects.length > 0 ? (
              factTable.projects.map((p) => (
                <span className="badge badge-secondary" key={p}>
                  {getProjectById(p)?.name || p}
                </span>
              ))
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

      <div className="row mb-2 align-items-center">
        <div className="col-auto">
          <h3 className="mb-0">Facts</h3>
        </div>
      </div>
      <div className="row mb-2 align-items-center">
        {factTable.facts.length > 0 && (
          <div className="col-lg-3 col-md-4 col-6 mr-auto">
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
          </div>
        )}
        <div className="col-auto">
          <Tooltip
            body={
              canEdit ? "" : `You don't have permission to edit this fact table`
            }
          >
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                if (!canEdit) return;
                setNewFactOpen(true);
              }}
              disabled={!canEdit}
            >
              <GBAddCircle /> Add Fact
            </button>
          </Tooltip>
        </div>
      </div>
      {factTable.facts.length > 0 && (
        <>
          <table className="table appbox gbtable">
            <thead>
              <tr>
                <SortableTH field="name">Name</SortableTH>
                <th>Description</th>
                <SortableTH field="type">Type</SortableTH>
                <SortableTH field="column">Column</SortableTH>
                <th>Number Format</th>
                <th>WHERE filter</th>
                <SortableTH field="dateUpdated">Last Updated</SortableTH>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((fact) => (
                <tr key={fact.id}>
                  <td>{fact.name}</td>
                  <td>
                    <Markdown>{fact.description}</Markdown>
                  </td>
                  <td>{fact.type}</td>
                  <td>{fact.type === "number" ? fact.column : ""}</td>
                  <td>{fact.type === "number" ? fact.numberFormat : ""}</td>
                  <td>
                    <InlineCode language="sql" code={fact.where} />
                  </td>
                  <td>{date(fact.dateUpdated)}</td>
                  <td>
                    {canEdit && (
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
                          className="dropdown-item"
                          useIcon={false}
                          text="Delete"
                          onClick={async () => {
                            await apiCall(
                              `/fact-tables/${factTable.id}/${fact.id}`,
                              {
                                method: "DELETE",
                              }
                            );
                          }}
                        />
                      </MoreMenu>
                    )}
                  </td>
                </tr>
              ))}
              {!items.length && isFiltered && (
                <tr>
                  <td colSpan={8} align={"center"}>
                    No matching facts.{" "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        clear();
                      }}
                    >
                      Clear search field
                    </a>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
