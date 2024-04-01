import { useRouter } from "next/router";
import Link from "next/link";
import { useState } from "react";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
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

export default function FactTablePage() {
  const router = useRouter();
  const { ftid } = router.query;

  const [editOpen, setEditOpen] = useState(false);
  const [showSQL, setShowSQL] = useState(false);

  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);

  const { apiCall } = useAuth();

  const permissionsUtil = usePermissionsUtil();

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

  const canEdit =
    !factTable.managedBy &&
    permissionsUtil.canUpdateFactTable(factTable, factTable);

  const hasColumns = factTable.columns?.some((col) => !col.deleted);

  return (
    <div className="pagecontents container-fluid">
      {editOpen && (
        <FactTableModal close={() => setEditOpen(false)} existing={factTable} />
      )}
      {editProjectsOpen && (
        <EditProjectsForm
          projects={factTable.projects}
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
        />
      )}
      <PageHead
        breadcrumb={[
          { display: "Fact Tables", href: "/fact-tables" },
          { display: factTable.name },
        ]}
      />
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

      <div className="mb-4">
        {hasColumns && (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowSQL(!showSQL);
            }}
            className="text-dark"
          >
            {showSQL ? "Hide" : "Show"} Fact Table SQL{" "}
            {showSQL ? <FaAngleDown /> : <FaAngleRight />}
          </a>
        )}
        {(showSQL || !hasColumns) && (
          <div className="appbox p-3">
            <Code
              code={factTable.sql}
              language="sql"
              containerClassName="m-0"
              className="mb-4"
              filename={
                canEdit ? (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditOpen(true);
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
              <div className="mt-2">
                <strong>eventName</strong> = <code>{factTable.eventName}</code>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="row mb-4">
        <div className="col">
          <div className="mb-4">
            <h3>Columns</h3>
            <div className="mb-1">
              All of the columns returned by the Fact Table SQL.
            </div>
            <div className="appbox p-3">
              <ColumnList factTable={factTable} />
            </div>
          </div>
        </div>
        <div className="col">
          <div className="mb-4">
            <h3>Filters</h3>
            <div className="mb-4">
              <div className="mb-1">
                Filters are re-usable SQL snippets that let you limit the rows
                that are included in a Metric.
              </div>
              <div className="appbox p-3">
                <FactFilterList factTable={factTable} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <h3>Metrics</h3>
      <div className="mb-4">
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
