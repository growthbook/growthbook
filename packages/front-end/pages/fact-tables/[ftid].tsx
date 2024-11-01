import { useRouter } from "next/router";
import Link from "next/link";
import { useState } from "react";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBEdit } from "@/components/Icons";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import FactTableModal from "@/components/FactTables/FactTableModal";
import Code from "@/components/SyntaxHighlighting/Code";
import ColumnList from "@/components/FactTables/ColumnList";
import FactFilterList from "@/components/FactTables/FactFilterList";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import PageHead from "@/components/Layout/PageHead";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import SortedTags from "@/components/Tags/SortedTags";
import FactMetricList from "@/components/FactTables/FactMetricList";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import { usesEventName } from "@/components/Metrics/MetricForm";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import EditFactTableSQLModal from "@/components/FactTables/EditFactTableSQLModal";

export default function FactTablePage() {
  const router = useRouter();
  const { ftid } = router.query;

  const [editOpen, setEditOpen] = useState(false);
  const [editSQLOpen, setEditSQLOpen] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);

  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);

  const { apiCall } = useAuth();

  const permissionsUtil = usePermissionsUtil();

  const {
    getFactTableById,
    ready,
    mutateDefinitions,
    getProjectById,
    projects,
    getDatasourceById,
  } = useDefinitions();
  const factTable = getFactTableById(ftid as string);

  if (!ready) return <LoadingOverlay />;

  if (!factTable) {
    return (
      <div className="alert alert-danger">
        Could not find the requested fact table.{" "}
        <Link href="/fact-tables">Back to all fact tables</Link>
      </div>
    );
  }

  const canEdit =
    !factTable.managedBy &&
    permissionsUtil.canViewEditFactTableModal(factTable);

  return (
    <div className="pagecontents container-fluid">
      {editOpen && (
        <FactTableModal close={() => setEditOpen(false)} existing={factTable} />
      )}
      {editSQLOpen && (
        <EditFactTableSQLModal
          close={() => setEditSQLOpen(false)}
          factTable={factTable}
          save={async (data) => {
            await apiCall(`/fact-tables/${factTable.id}`, {
              method: "PUT",
              body: JSON.stringify(data),
            });
            await mutateDefinitions();
          }}
        />
      )}
      {editOwnerModal && (
        <EditOwnerModal
          cancel={() => setEditOwnerModal(false)}
          owner={factTable.owner}
          save={async (owner) => {
            await apiCall(`/fact-tables/${factTable.id}`, {
              method: "PUT",
              body: JSON.stringify({ owner }),
            });
          }}
          mutate={mutateDefinitions}
        />
      )}
      {editProjectsOpen && (
        <EditProjectsForm
          label={
            <>
              Projects{" "}
              <Tooltip
                body={
                  "The dropdown below has been filtered to only include projects where you have permission to update Fact Tables"
                }
              />
            </>
          }
          value={factTable.projects}
          permissionRequired={(project) =>
            permissionsUtil.canUpdateFactTable({ projects: [project] }, {})
          }
          cancel={() => setEditProjectsOpen(false)}
          save={async (projects) => {
            await apiCall(`/fact-tables/${factTable.id}`, {
              method: "PUT",
              body: JSON.stringify({
                projects,
              }),
            });
          }}
          mutate={mutateDefinitions}
          entityName="Fact Table"
        />
      )}
      {editTagsModal && (
        <EditTagsForm
          tags={factTable.tags}
          save={async (tags) => {
            await apiCall(`/fact-tables/${factTable.id}`, {
              method: "PUT",
              body: JSON.stringify({ tags }),
            });
          }}
          cancel={() => setEditTagsModal(false)}
          mutate={mutateDefinitions}
          source="ftid"
        />
      )}
      <PageHead
        breadcrumb={[
          { display: "Fact Tables", href: "/fact-tables" },
          { display: factTable.name },
        ]}
      />
      {factTable.archived && (
        <div className="alert alert-secondary mb-2">
          <strong>This Fact Table is archived.</strong> Existing references will
          continue working, but you will be unable to add metrics from this Fact
          Table to new experiments.
        </div>
      )}
      <div className="row mb-3">
        <div className="col-auto">
          <h1 className="mb-0">
            {factTable.name}{" "}
            <OfficialBadge type="Fact Table" managedBy={factTable.managedBy} />
          </h1>
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
              <button
                className="dropdown-item"
                onClick={async () => {
                  await apiCall(
                    `/fact-tables/${factTable.id}/${
                      factTable.archived ? "unarchive" : "archive"
                    }`,
                    {
                      method: "POST",
                    }
                  );
                  mutateDefinitions();
                }}
              >
                {factTable.archived ? "Unarchive" : "Archive"} Fact Table
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
                <span className="badge badge-secondary mr-1" key={p}>
                  {getProjectById(p)?.name || p}
                </span>
              ))
            ) : (
              <em className="mr-1">All Projects</em>
            )}
            {canEdit && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setEditProjectsOpen(true);
                }}
              >
                <GBEdit />
              </a>
            )}
          </div>
        ) : null}
        <div className="col-auto">
          Tags: <SortedTags tags={factTable.tags} />
          {canEdit && (
            <a
              className="ml-1 cursor-pointer"
              onClick={() => setEditTagsModal(true)}
            >
              <GBEdit />
            </a>
          )}
        </div>
        {(factTable.owner || canEdit) && (
          <div className="col-auto">
            Owner: {factTable.owner}
            {canEdit && (
              <a
                className="ml-1 cursor-pointer"
                onClick={() => setEditOwnerModal(true)}
              >
                <GBEdit />
              </a>
            )}
          </div>
        )}
        <div className="col-auto">
          Data source:{" "}
          <Link
            href={`/datasources/${factTable.datasource}`}
            className="font-weight-bold"
          >
            {getDatasourceById(factTable.datasource)?.name || "Unknown"}
          </Link>
        </div>
      </div>

      <div className="appbox p-3 bg-white mb-3">
        <MarkdownInlineEdit
          canEdit={canEdit}
          canCreate={canEdit}
          value={factTable.description}
          save={async (description) => {
            await apiCall(`/fact-tables/${factTable.id}`, {
              method: "PUT",
              body: JSON.stringify({
                description,
              }),
            });
            mutateDefinitions();
          }}
        />
      </div>

      <div className="row mb-4">
        <div className="col col-md-6 d-flex flex-column">
          <h3>SQL Definition</h3>
          <Code
            code={factTable.sql}
            language="sql"
            containerClassName="m-0 flex-1"
            className="flex-1"
            maxHeight="405px"
            filename={
              canEdit ? (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setEditSQLOpen(true);
                  }}
                >
                  Edit SQL <GBEdit />
                </a>
              ) : (
                "SQL"
              )
            }
          />
          {usesEventName(factTable.sql) && (
            <div className="p-2 bg-light border border-top-0">
              <strong>eventName</strong> = <code>{factTable.eventName}</code>
            </div>
          )}
        </div>
        <div className="col col-md-6 d-flex flex-column">
          <h3>Columns</h3>
          <div className="appbox p-3 flex-1 mb-0">
            <ColumnList factTable={factTable} />
          </div>
        </div>
      </div>

      <div className="row mb-4">
        <div className="col d-flex flex-column">
          <h3>Filters</h3>
          <div className="mb-1">
            Filters are re-usable SQL snippets that let you limit the rows that
            are included in a Metric.
          </div>
          <div className="appbox p-3 flex-1">
            <FactFilterList factTable={factTable} />
          </div>
        </div>
      </div>

      <h3>Metrics</h3>
      <div className="mb-5">
        <div className="mb-1">
          Metrics are built on top of Columns and Filters. These are what you
          use as Goals and Guardrails in experiments. This page only shows
          metrics tied to this Fact Table.{" "}
          <Link href="/metrics">View all Metrics</Link>
        </div>
        <div className="appbox p-3">
          <FactMetricList factTable={factTable} />
        </div>
      </div>
    </div>
  );
}
