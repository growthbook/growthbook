import React, { useState } from "react";
import {
  FaCheck,
  FaCircle,
  FaExclamationTriangle,
  FaSquare,
} from "react-icons/fa";
import { useRouter } from "next/router";
import { ago, datetime } from "shared/dates";
import { QueryInterface } from "shared/types/query";
import { capitalize } from "lodash";
import { useSearch } from "@/services/search";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import ExpandableQuery from "@/components/Queries/ExpandableQuery";
import usePermissions from "@/hooks/usePermissions";

const DataSourceQueries = (): React.ReactElement => {
  const permissions = usePermissions();
  const [modalData, setModalData] = useState<QueryInterface | null>(null);
  const router = useRouter();
  const { did } = router.query as { did: string };
  const { getDatasourceById, ready, error: datasourceError } = useDefinitions();
  const d = getDatasourceById(did);

  const canView = d && permissions.check("readData", d.projects || []);

  const { data, error: queriesError } = useApi<{
    queries: QueryInterface[];
  }>(`/datasource/${did}/queries`);

  const queries = data?.queries;

  const { items, SortableTH } = useSearch({
    items: queries || [],
    defaultSortField: "createdAt",
    localStorageKey: "datasourceQueries",
    searchFields: ["status", "queryType", "externalId"],
  });

  if (!canView) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  if (datasourceError || queriesError) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          {datasourceError ?? queriesError?.message}
        </div>
      </div>
    );
  }

  if (!ready || !data) {
    return <LoadingOverlay />;
  }
  if (!d) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          Datasource <code>{did}</code> does not exist.
        </div>
      </div>
    );
  }

  if (!queries?.length) {
    return (
      <div className="container pagecontents p-4">
        <div className="d-flex">
          <h1>Data Source Queries</h1>
        </div>
        <p>No queries have been run on this Data Source.</p>
      </div>
    );
  }

  return (
    <div className="container pagecontents">
      {modalData && (
        <Modal
          trackingEventModalType=""
          open
          close={() => setModalData(null)}
          size="lg"
          header={"Inspect query"}
          includeCloseCta={false}
        >
          <ExpandableQuery query={modalData} i={0} total={1} />{" "}
        </Modal>
      )}

      <PageHead
        breadcrumb={[
          { display: "Data Sources" },
          { display: d.name, href: `/datasources/${did}` },
          { display: "Recent Queries" },
        ]}
      />
      <div className="filters md-form row mb-3 align-items-center">
        <div className="col-auto d-flex">
          <h1>
            Recent Queries{" "}
            <Tooltip
              className="small"
              body="The 50 most recent queries run on this Data Source"
            />
          </h1>
        </div>
        <div style={{ flex: 1 }} />
      </div>
      <table className="table appbox gbtable table-hover">
        <thead>
          <tr>
            <SortableTH field="query" className="col-4">
              Title
            </SortableTH>
            <SortableTH field="queryType" className="col-2">
              Type
            </SortableTH>
            <SortableTH field="createdAt" className="col-2">
              Created
            </SortableTH>
            <SortableTH field="startedAt" className="col-2">
              Started
            </SortableTH>
            <SortableTH field="finishedAt" className="col-2">
              Finished
            </SortableTH>
            <SortableTH field="status" className="col-1">
              Status
            </SortableTH>
            <SortableTH field="externalId" className="col-2">
              External ID
            </SortableTH>
          </tr>
        </thead>
        <tbody>
          {items.map((query) => {
            let title = "";
            if (query.language === "sql") {
              const comments = query.query.match(/(\n|^)\s*-- ([^\n]+)/);
              if (comments && comments[2]) {
                title = comments[2];
              }
            }

            return (
              <tr
                key={query.id}
                onClick={(e) => {
                  e.preventDefault();
                  setModalData(query);
                }}
                style={{ cursor: "pointer" }}
              >
                <td>
                  <button className="btn btn-link p-0 text-left">
                    {title}
                  </button>
                </td>
                <td>{query.queryType || "—"}</td>
                <td>{datetime(query.createdAt)}</td>
                <td
                  title={datetime(query.startedAt || "")}
                  className="d-none d-md-table-cell"
                >
                  {ago(query.startedAt || "")}
                </td>
                <td>{ago(query.finishedAt || "")}</td>
                <td>
                  <Tooltip
                    body={
                      <div>
                        <strong>{capitalize(query.status)}</strong>
                        {query.status === "failed" && (
                          <p className="mb-0">{query.error}</p>
                        )}
                      </div>
                    }
                    tipMinWidth="50px"
                    tipPosition="top"
                  >
                    {query.status === "running" && (
                      <FaCircle className="text-info mr-2" title="Running" />
                    )}
                    {query.status === "queued" && (
                      <FaSquare
                        className="text-secondary mr-2"
                        title="Queued"
                      />
                    )}
                    {query.status === "failed" && (
                      <FaExclamationTriangle
                        className="text-danger mr-2"
                        title="Failed"
                      />
                    )}
                    {query.status === "succeeded" && (
                      <FaCheck
                        className="text-success mr-2"
                        title="Succeeded"
                      />
                    )}
                  </Tooltip>
                </td>
                <td>{query.externalId || "N/A"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default DataSourceQueries;
