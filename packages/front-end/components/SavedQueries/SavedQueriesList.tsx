import { useState, useCallback } from "react";
import { SavedQueryInterface } from "back-end/types/saved-query";
import { date, datetime } from "shared/dates";
import { FaCode } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useSearch } from "@/services/search";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Button from "@/components/Button";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";

interface Props {
  savedQueries: SavedQueryInterface[];
  mutate: () => void;
}

export default function SavedQueriesList({ savedQueries, mutate }: Props) {
  const { apiCall } = useAuth();
  const { getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const [showSqlExplorerModal, setShowSqlExplorerModal] = useState(false);
  const [selectedSavedQuery, setSelectedSavedQuery] = useState<
    SavedQueryInterface | undefined
  >();

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTH,
    clear,
    pagination,
  } = useSearch({
    items: savedQueries,
    defaultSortField: "dateUpdated",
    localStorageKey: "savedqueries",
    searchFields: ["name^3", "description", "sql"],
    pageSize: 20,
  });

  const handleDelete = useCallback(
    async (query: SavedQueryInterface) => {
      await apiCall(`/saved-query/${query.id}`, {
        method: "DELETE",
      });
      mutate();
    },
    [apiCall, mutate]
  );

  const handleEdit = useCallback((query: SavedQueryInterface) => {
    setSelectedSavedQuery(query);
    setShowSqlExplorerModal(true);
  }, []);

  const handleRowClick = useCallback(
    (query: SavedQueryInterface) => {
      // Only allow row click for queries the user can edit
      const datasource = getDatasourceById(query.datasourceId);
      if (datasource && permissionsUtil.canUpdateSavedQueries(datasource)) {
        handleEdit(query);
      }
    },
    [getDatasourceById, permissionsUtil, handleEdit]
  );

  const canEdit = useCallback(
    (query: SavedQueryInterface) => {
      const datasource = getDatasourceById(query.datasourceId);
      return datasource
        ? permissionsUtil.canUpdateSavedQueries(datasource)
        : false;
    },
    [getDatasourceById, permissionsUtil]
  );

  const canDelete = useCallback(
    (query: SavedQueryInterface) => {
      const datasource = getDatasourceById(query.datasourceId);
      return datasource
        ? permissionsUtil.canDeleteSavedQueries(datasource)
        : false;
    },
    [getDatasourceById, permissionsUtil]
  );

  return (
    <>
      {showSqlExplorerModal && (
        <SqlExplorerModal
          close={() => {
            setShowSqlExplorerModal(false);
            setSelectedSavedQuery(undefined);
          }}
          savedQuery={selectedSavedQuery}
          mutate={mutate}
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
          <table className="table appbox gbtable table-hover">
            <thead>
              <tr>
                <SortableTH field="name" className="col-4">
                  Name
                </SortableTH>
                <th className="col-4">Description</th>
                <th className="col-2">Data Source</th>
                <SortableTH field="dateLastRan" className="col-1">
                  Last Run
                </SortableTH>
                <SortableTH field="dateUpdated" className="col-1">
                  Updated
                </SortableTH>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((query) => {
                const datasource = getDatasourceById(query.datasourceId);
                const datasourceName = datasource?.name || "Unknown";
                const canEditQuery = canEdit(query);

                return (
                  <tr
                    key={query.id}
                    onClick={() => handleRowClick(query)}
                    style={{
                      cursor: canEditQuery ? "pointer" : "default",
                    }}
                  >
                    <td>
                      <div className="d-flex align-items-center">
                        <FaCode className="text-muted mr-2" />
                        <div>
                          <div className="font-weight-bold">{query.name}</div>
                          {query.results && query.results.length > 0 && (
                            <small className="text-muted">
                              {query.results.length} row
                              {query.results.length !== 1 ? "s" : ""}
                            </small>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="text-ellipsis" style={{ maxWidth: 300 }}>
                        {query.description || (
                          <em className="text-muted">No description</em>
                        )}
                      </div>
                    </td>
                    <td>{datasourceName}</td>
                    <td>
                      {query.dateLastRan ? (
                        <span title={datetime(query.dateLastRan)}>
                          {date(query.dateLastRan)}
                        </span>
                      ) : (
                        <em className="text-muted">Never</em>
                      )}
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
