import { useState, useCallback, Fragment } from "react";
import { date, datetime } from "shared/dates";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import Link from "next/link";
import { BiHide, BiShow } from "react-icons/bi";
import { BsXCircle } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useSearch } from "@/services/search";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Button from "@/components/Button";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";
import { useAllDashboards } from "@/hooks/useDashboards";
import Callout from "@/components/Radix/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";

const MAX_REFERENCES = 10;

interface Props {
  savedQueries: SavedQuery[];
  mutate: () => void;
}

export default function SavedQueriesList({ savedQueries, mutate }: Props) {
  const { apiCall } = useAuth();
  const { getDatasourceById } = useDefinitions();
  const { dashboardsMap } = useAllDashboards();
  const permissionsUtil = usePermissionsUtil();
  const [selectedSavedQuery, setSelectedSavedQuery] = useState<
    SavedQuery | undefined
  >();
  const [showReferences, setShowReferences] = useState<number | null>(null);

  const { items, searchInputProps, isFiltered, SortableTH, clear, pagination } =
    useSearch({
      items: savedQueries,
      defaultSortField: "dateUpdated",
      localStorageKey: "savedqueries",
      searchFields: ["name^3", "sql"],
      pageSize: 20,
    });

  const handleDelete = useCallback(
    async (query: SavedQuery) => {
      await apiCall(`/saved-queries/${query.id}`, {
        method: "DELETE",
      });
      mutate();
    },
    [apiCall, mutate],
  );

  const handleEdit = useCallback((query: SavedQuery) => {
    setSelectedSavedQuery(query);
  }, []);

  const handleDuplicate = useCallback((query: SavedQuery) => {
    setSelectedSavedQuery({
      ...query,
      id: "",
      name: `${query.name}-copy`,
    });
  }, []);

  const canEdit = useCallback(
    (query: SavedQuery) => {
      const datasource = getDatasourceById(query.datasourceId);
      return datasource
        ? permissionsUtil.canUpdateSqlExplorerQueries(datasource, {})
        : false;
    },
    [getDatasourceById, permissionsUtil],
  );

  const canDelete = useCallback(
    (query: SavedQuery) => {
      const datasource = getDatasourceById(query.datasourceId);
      return datasource
        ? permissionsUtil.canDeleteSqlExplorerQueries(datasource)
        : false;
    },
    [getDatasourceById, permissionsUtil],
  );

  return (
    <>
      {selectedSavedQuery && (
        <SqlExplorerModal
          close={() => {
            setSelectedSavedQuery(undefined);
          }}
          initial={selectedSavedQuery}
          id={selectedSavedQuery?.id}
          mutate={mutate}
          trackingEventModalSource="saved-queries-list"
        />
      )}

      <div className="mb-3">
        <input
          type="search"
          className="form-control"
          placeholder="Search saved queries..."
          {...searchInputProps}
        />
      </div>

      {items.length > 0 ? (
        <>
          <table className="table appbox gbtable">
            <thead>
              <tr>
                <SortableTH field="name">Name</SortableTH>
                <SortableTH field="datasourceId">Data Source</SortableTH>
                <th style={{ width: 100 }}>Visualization</th>
                <th style={{ width: 100 }}>Rows</th>
                <th>References</th>
                <SortableTH field="dateUpdated" style={{ width: 150 }}>
                  Updated
                </SortableTH>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((query, i) => {
                const datasource = getDatasourceById(query.datasourceId);
                const datasourceName = datasource?.name || "Unknown";
                const linkedDashboardIds = query.linkedDashboardIds || [];
                const numReferences = linkedDashboardIds.length;

                return (
                  <tr key={query.id}>
                    <td>
                      <Link
                        href={`/sql-explorer/${query.id}`}
                        className="d-block"
                      >
                        {query.name}
                      </Link>
                    </td>
                    <td>{datasourceName}</td>
                    <td>
                      {query.dataVizConfig && query.dataVizConfig.length > 0
                        ? "Yes"
                        : "No"}
                    </td>
                    <td>{query.results?.results?.length || 0}</td>
                    <td>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                      >
                        <Tooltip
                          delay={0}
                          tipPosition="bottom"
                          state={showReferences === i}
                          popperStyle={{ marginLeft: 50, marginTop: 15 }}
                          flipTheme={false}
                          ignoreMouseEvents={true}
                          body={
                            <div
                              className="pl-3 pr-0 py-2"
                              style={{ minWidth: 250, maxWidth: 350 }}
                            >
                              <a
                                role="button"
                                style={{ top: 3, right: 5 }}
                                className="position-absolute text-dark-gray cursor-pointer"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setShowReferences(null);
                                }}
                              >
                                <BsXCircle size={16} />
                              </a>
                              <div
                                style={{ maxHeight: 300, overflowY: "auto" }}
                              >
                                {linkedDashboardIds.length > 0 && (
                                  <>
                                    <div className="mt-1 text-muted font-weight-bold">
                                      Dashboards:
                                    </div>
                                    <div className="mb-2">
                                      <ul className="pl-3 mb-0">
                                        {linkedDashboardIds.map(
                                          (dashboardId, j) => {
                                            const dashboard =
                                              dashboardsMap.get(dashboardId);
                                            if (!dashboard) return null;
                                            return (
                                              <Fragment key={"dashboard-" + j}>
                                                {j < MAX_REFERENCES ? (
                                                  <li
                                                    key={"f_" + j}
                                                    className="my-1"
                                                    style={{ maxWidth: 320 }}
                                                  >
                                                    <Link
                                                      href={`/experiment/${dashboard.experimentId}#dashboards/${dashboard.id}`}
                                                    >
                                                      {dashboard.title}
                                                    </Link>
                                                  </li>
                                                ) : j === MAX_REFERENCES ? (
                                                  <li
                                                    key={"f_" + j}
                                                    className="my-1"
                                                  >
                                                    <em>
                                                      {linkedDashboardIds.length -
                                                        j}{" "}
                                                      more...
                                                    </em>
                                                  </li>
                                                ) : null}
                                              </Fragment>
                                            );
                                          },
                                        )}
                                      </ul>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          }
                        >
                          <></>
                        </Tooltip>
                        {numReferences > 0 && (
                          <a
                            role="button"
                            className="link-purple nowrap"
                            onClick={(e) => {
                              e.preventDefault();
                              setShowReferences(
                                showReferences !== i ? i : null,
                              );
                            }}
                          >
                            {numReferences} reference
                            {numReferences !== 1 && "s"}
                            {showReferences === i ? (
                              <BiHide className="ml-2" />
                            ) : (
                              <BiShow className="ml-2" />
                            )}
                          </a>
                        )}
                      </div>
                    </td>
                    <td title={datetime(query.dateUpdated)}>
                      {date(query.dateUpdated)}
                    </td>
                    <td
                      onClick={(e) => e.stopPropagation()}
                      style={{ cursor: "initial" }}
                    >
                      <MoreMenu>
                        {canEdit(query) && (
                          <button
                            className="dropdown-item"
                            onClick={() => handleEdit(query)}
                          >
                            Edit
                          </button>
                        )}
                        {canEdit(query) && (
                          <button
                            className="dropdown-item"
                            onClick={() => handleDuplicate(query)}
                          >
                            Duplicate
                          </button>
                        )}
                        {canDelete(query) && (
                          <>
                            {canEdit(query) && (
                              <div className="dropdown-divider" />
                            )}
                            <DeleteButton
                              displayName="Saved Query"
                              onClick={() => handleDelete(query)}
                              useIcon={false}
                              className="dropdown-item text-danger"
                              text="Delete"
                              getConfirmationContent={async () => {
                                const dashboardIds =
                                  query.linkedDashboardIds || [];
                                if (dashboardIds.length === 0) return null;
                                return (
                                  <div>
                                    <Callout
                                      status="warning"
                                      mb="2"
                                    >{`This saved query is in use by ${
                                      dashboardIds.length
                                    } dashboard${
                                      dashboardIds.length === 1 ? "" : "s"
                                    }. If deleted, linked SQL Explorer blocks will lose their visualizations.`}</Callout>
                                    <ul>
                                      {dashboardIds.map((dashId) => {
                                        const dashboard =
                                          dashboardsMap.get(dashId);
                                        if (!dashboard) return null;
                                        if (!dashboard.experimentId)
                                          return (
                                            <li key={dashId}>
                                              <span>{dashboard.title}</span>
                                            </li>
                                          );
                                        return (
                                          <li key={dashId}>
                                            <Link
                                              href={`/experiment/${dashboard.experimentId}#dashboards/${dashId}`}
                                            >
                                              {dashboard.title}
                                            </Link>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </div>
                                );
                              }}
                            />
                          </>
                        )}
                      </MoreMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pagination}
        </>
      ) : isFiltered ? (
        <div className="appbox p-4 text-center">
          <p>No saved queries match your search.</p>
          <Button onClick={clear} color="outline-primary">
            Clear search
          </Button>
        </div>
      ) : (
        <div className="appbox p-5 text-center">
          <h3>No Saved Queries Yet</h3>
          <p>
            Once you save queries from the SQL Explorer, they&apos;ll appear
            here for easy access.
          </p>
        </div>
      )}
    </>
  );
}
