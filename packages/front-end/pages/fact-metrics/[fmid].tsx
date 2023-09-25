import { useRouter } from "next/router";
import Link from "next/link";
import { useState } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import Markdown from "@/components/Markdown/Markdown";
import { GBEdit } from "@/components/Icons";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import PageHead from "@/components/Layout/PageHead";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import SortedTags from "@/components/Tags/SortedTags";
import FactMetricModal from "@/components/FactTables/FactMetricModal";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";

export default function FactMetricPage() {
  const router = useRouter();
  const { fmid } = router.query;

  const [editOpen, setEditOpen] = useState(false);

  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);

  const { apiCall } = useAuth();

  const permissions = usePermissions();

  const {
    getFactTableById,
    getFactMetricById,
    ready,
    mutateDefinitions,
    getProjectById,
    projects,
    getDatasourceById,
  } = useDefinitions();

  if (!ready) return <LoadingOverlay />;

  const factMetric = getFactMetricById(fmid as string);

  if (!factMetric) {
    return (
      <div className="alert alert-danger">
        Could not find the requested fact metric.{" "}
        <Link href="/fact-tables">Back to all fact metrics</Link>
      </div>
    );
  }

  const canEdit = permissions.check("createMetrics", factMetric.projects || "");

  const numeratorFactTable = getFactTableById(factMetric.numerator.factTableId);
  const denominatorFactTable = getFactTableById(
    factMetric.denominator?.factTableId || ""
  );

  const numeratorFact = numeratorFactTable?.facts?.find(
    (f) => f.id === factMetric.numerator.factId
  );

  return (
    <div className="pagecontents container-fluid">
      {editOpen && (
        <FactMetricModal
          close={() => setEditOpen(false)}
          existing={factMetric}
        />
      )}
      {editProjectsOpen && (
        <EditProjectsForm
          projects={factMetric.projects}
          cancel={() => setEditProjectsOpen(false)}
          save={async (projects) => {
            await apiCall(`/fact-metrics/${factMetric.id}`, {
              method: "PUT",
              body: JSON.stringify({
                projects,
              }),
            });
          }}
          mutate={mutateDefinitions}
          entityName="Metric"
        />
      )}
      {editTagsModal && (
        <EditTagsForm
          tags={factMetric.tags}
          save={async (tags) => {
            await apiCall(`/fact-metrics/${factMetric.id}`, {
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
          { display: "Metrics", href: "/metrics" },
          { display: factMetric.name },
        ]}
      />
      <div className="row mb-3">
        <div className="col-auto">
          <h1 className="mb-0">{factMetric.name}</h1>
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
                Edit Metric
              </button>
              <DeleteButton
                className="dropdown-item"
                displayName="Metric"
                useIcon={false}
                text="Delete Metric"
                onClick={async () => {
                  await apiCall(`/fact-metrics/${factMetric.id}`, {
                    method: "DELETE",
                  });
                  mutateDefinitions();
                  router.push("/metrics");
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
            {factMetric.projects.length > 0 ? (
              factMetric.projects.map((p) => (
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
          Tags: <SortedTags tags={factMetric.tags} />
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
          <Link href={`/datasources/${factMetric.datasource}`}>
            <a className="font-weight-bold">
              {getDatasourceById(factMetric.datasource)?.name || "Unknown"}
            </a>
          </Link>
        </div>
      </div>

      {factMetric.description && (
        <>
          <h3>Description</h3>
          <div className="appbox p-3 bg-light mb-3">
            <Markdown>{factMetric.description}</Markdown>
          </div>
        </>
      )}

      <div className="mb-4">
        <h3>Metric Definition</h3>
        <div className="appbox p-3 mb-3">
          <div className="d-flex mb-2">
            <strong className="mr-2" style={{ width: 120 }}>
              Metric Type
            </strong>
            <span>{factMetric.metricType}</span>
          </div>
          {factMetric.metricType === "proportion" ? (
            <div className="d-flex">
              <strong className="mr-2" style={{ width: 120 }}>
                Value
              </strong>
              <span>
                Percent of experiment users that exist in the Fact Table{" "}
                <span className="badge badge-secondary">
                  {numeratorFactTable?.name}
                </span>{" "}
                {factMetric.numerator.filters.length > 0 && (
                  <>
                    matching the filters:{" "}
                    {factMetric.numerator.filters.map((f) => {
                      const filter = numeratorFactTable?.filters?.find(
                        (filter) => filter.id === f
                      );
                      if (!filter) return null;
                      return (
                        <span className="badge badge-secondary mr-2" key={f}>
                          {filter.name}
                        </span>
                      );
                    })}
                  </>
                )}
              </span>
            </div>
          ) : (
            <>
              <div className="d-flex mb-2">
                <strong className="mr-2" style={{ width: 120 }}>
                  Numerator
                </strong>
                <span>
                  <InlineCode
                    language="sql"
                    code={
                      factMetric.numerator.factId === "$$count"
                        ? "COUNT(*)"
                        : factMetric.numerator.factId === "$$distinctUsers"
                        ? `COUNT(DISTINCT \`Experiment User Id\`)`
                        : `SUM(\`${numeratorFact?.name}\`)`
                    }
                  />{" "}
                  in the Fact Table{" "}
                  <span className="badge badge-secondary">
                    {numeratorFactTable?.name}
                  </span>{" "}
                  {factMetric.numerator.filters.length > 0 && (
                    <>
                      matching the filters:{" "}
                      {factMetric.numerator.filters.map((f) => {
                        const filter = numeratorFactTable?.filters?.find(
                          (filter) => filter.id === f
                        );
                        if (!filter) return null;
                        return (
                          <span className="badge badge-secondary mr-2" key={f}>
                            {filter.name}
                          </span>
                        );
                      })}
                    </>
                  )}
                </span>
              </div>
              <div className="d-flex mb-2">
                <strong className="mr-2" style={{ width: 120 }}>
                  Denominator
                </strong>
                <span>
                  {factMetric.metricType === "mean" ? (
                    <InlineCode
                      language="sql"
                      code="COUNT(DISTINCT `Experiment User Id`)"
                    />
                  ) : (
                    <>
                      <InlineCode
                        language="sql"
                        code={
                          factMetric.denominator?.factId === "$$count"
                            ? "COUNT(*)"
                            : factMetric.denominator?.factId ===
                              "$$distinctUsers"
                            ? `COUNT(DISTINCT \`Experiment User Id\`)`
                            : `SUM(\`${
                                denominatorFactTable?.facts?.find(
                                  (f) => f.id === factMetric.denominator?.factId
                                )?.name
                              }\`)`
                        }
                      />{" "}
                      in the Fact Table{" "}
                      <span className="badge badge-secondary">
                        {denominatorFactTable?.name}
                      </span>{" "}
                      {!!factMetric.denominator?.filters?.length && (
                        <>
                          matching the filters:{" "}
                          {factMetric.denominator.filters.map((f) => {
                            const filter = denominatorFactTable?.filters?.find(
                              (filter) => filter.id === f
                            );
                            if (!filter) return null;
                            return (
                              <span
                                className="badge badge-secondary mr-2"
                                key={f}
                              >
                                {filter.name}
                              </span>
                            );
                          })}
                        </>
                      )}
                    </>
                  )}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
