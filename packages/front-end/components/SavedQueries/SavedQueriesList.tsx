import { useState, useCallback } from "react";
import { date, datetime } from "shared/dates";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useSearch } from "@/services/search";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Button from "@/components/Button";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";

interface Props {
  savedQueries: SavedQuery[];
  mutate: () => void;
}

export default function SavedQueriesList({ savedQueries, mutate }: Props) {
  const { apiCall } = useAuth();
  const { getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const [selectedSavedQuery, setSelectedSavedQuery] = useState<
    SavedQuery | undefined
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
    [apiCall, mutate]
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
    [getDatasourceById, permissionsUtil]
  );

  const canDelete = useCallback(
    (query: SavedQuery) => {
      const datasource = getDatasourceById(query.datasourceId);
      return datasource
        ? permissionsUtil.canDeleteSqlExplorerQueries(datasource)
        : false;
    },
    [getDatasourceById, permissionsUtil]
  );

  return (
    <>
      {selectedSavedQuery && (
        <SqlExplorerModal
          close={() => {
            setSelectedSavedQuery(undefined);
          }}
          sql={selectedSavedQuery?.sql}
          name={selectedSavedQuery?.name}
          initialDatasourceId={selectedSavedQuery?.datasourceId}
          results={selectedSavedQuery?.results}
          dataVizConfig={selectedSavedQuery?.dataVizConfig}
          id={selectedSavedQuery?.id}
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
                <SortableTH field="name" className="col-auto">
                  Name
                </SortableTH>
                <SortableTH field="datasourceId" className="col-3">
                  Data Source
                </SortableTH>
                <th>Visualization</th>
                <th className="col-1">Rows</th>
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
                    onClick={() => setSelectedSavedQuery(query)}
                    style={{
                      cursor: canEditQuery ? "pointer" : "default",
                    }}
                  >
                    <td>
                      <div className="d-flex align-items-center">
                        <div>
                          <div className="font-weight-bold">{query.name}</div>
                        </div>
                      </div>
                    </td>
                    <td>{datasourceName}</td>
                    <td>
                      {query.dataVizConfig && query.dataVizConfig.length > 0
                        ? "Yes"
                        : "No"}
                    </td>
                    <td>{query.results?.results?.length || 0}</td>
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
