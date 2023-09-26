import { useRouter } from "next/router";
import Link from "next/link";
import { useState } from "react";
import { FaExternalLinkAlt } from "react-icons/fa";
import { FactRef, FactTableInterface } from "back-end/types/fact-table";
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

function FactTableLink({ id }: { id?: string }) {
  const { getFactTableById } = useDefinitions();
  const factTable = getFactTableById(id || "");

  if (!factTable) return <em className="text-muted">Unknown Fact Table</em>;

  return (
    <Link href={`/fact-tables/${factTable.id}`}>
      <a className="font-weight-bold">
        {factTable.name} <FaExternalLinkAlt />
      </a>
    </Link>
  );
}

function FilterBadges({
  ids,
  factTable,
}: {
  ids: string[] | null | undefined;
  factTable?: FactTableInterface | null;
}) {
  if (!factTable || !ids) return null;

  return (
    <>
      {ids.map((id) => {
        const filter = factTable.filters.find((f) => f.id === id);
        if (!filter) return null;
        return (
          <span className="badge badge-secondary mr-2" key={filter.id}>
            {filter.name}
          </span>
        );
      })}
    </>
  );
}

function FactSQL({ fact }: { fact: FactRef | null }) {
  const { getFactTableById } = useDefinitions();
  if (!fact) return null;
  const factTable = getFactTableById(fact.factTableId);
  if (!factTable) return null;

  const data = factTable.facts.find((f) => f.id === id);
  if (!data) return null;

  const { name, id } = data;

  return (
    <InlineCode
      language="sql"
      code={
        id === "$$count"
          ? "COUNT(*)"
          : id === "$$distinctUsers"
          ? `COUNT(DISTINCT \`Experiment User Id\`)`
          : `SUM(\`${name}\`)`
      }
    />
  );
}

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
          <h1 className="mb-0">
            {factMetric.name}{" "}
            <span className="badge badge-purple ml-2">FACT</span>
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
                <FactTableLink id={numeratorFactTable?.id} />{" "}
                {factMetric.numerator.filters.length > 0 && (
                  <>
                    matching the filters:{" "}
                    <FilterBadges
                      ids={factMetric.numerator.filters}
                      factTable={numeratorFactTable}
                    />
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
                  <FactSQL fact={factMetric.numerator} />
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
                  <FactTableLink id={numeratorFactTable?.id} />{" "}
                  {factMetric.numerator.filters.length > 0 && (
                    <>
                      matching the filters:{" "}
                      <FilterBadges
                        ids={factMetric.numerator?.filters}
                        factTable={numeratorFactTable}
                      />
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
                      <FactSQL fact={factMetric.denominator} /> in the Fact
                      Table <FactTableLink id={numeratorFactTable?.id} />{" "}
                      {!!factMetric.denominator?.filters?.length && (
                        <>
                          matching the filters:{" "}
                          <FilterBadges
                            ids={factMetric.denominator?.filters}
                            factTable={denominatorFactTable}
                          />
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
