import { useState, useCallback } from "react";
import { date, datetime } from "shared/dates";
import { SavedQuery } from "shared/validators";
import { blockHasFieldOfType } from "shared/enterprise";
import { isString } from "shared/util";
import { BiShow } from "react-icons/bi";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useSearch } from "@/services/search";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Button from "@/components/Button";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";
import { useAllDashboards } from "@/hooks/useDashboards";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Modal from "@/components/Modal";
import Tooltip from "@/ui/Tooltip";
import DashboardReferencesList from "@/components/SavedQueries/DashboardReferencesList";

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
  const [showReferencesModal, setShowReferencesModal] = useState<number | null>(
    null,
  );

  const { items, isFiltered, SortableTH, clear, pagination } = useSearch({
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

      {showReferencesModal !== null &&
        items[showReferencesModal] &&
        (() => {
          const selectedQuery = items[showReferencesModal];
          const activeIds = (selectedQuery.linkedDashboardIds || []).filter(
            (dashId) =>
              dashboardsMap
                .get(dashId)
                ?.blocks?.some(
                  (block) =>
                    blockHasFieldOfType(block, "savedQueryId", isString) &&
                    block.savedQueryId === selectedQuery.id,
                ),
          );
          const modalDashboards = activeIds
            .map((id) => dashboardsMap.get(id))
            .filter((d): d is NonNullable<typeof d> => d != null);
          return (
            <Modal
              header={`'${selectedQuery.name}' References`}
              trackingEventModalType="show-saved-query-references"
              close={() => setShowReferencesModal(null)}
              open={true}
              useRadixButton={true}
              closeCta="Close"
            >
              <Text as="p" mb="3">
                This saved query is referenced by the following dashboards.
              </Text>
              <DashboardReferencesList dashboards={modalDashboards} />
            </Modal>
          );
        })()}

      {items.length > 0 ? (
        <div className="mt-3">
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
                const activeReferences = linkedDashboardIds.filter((dashId) =>
                  dashboardsMap
                    .get(dashId)
                    // Check that the link is still active for each dashboard
                    ?.blocks?.some(
                      (block) =>
                        blockHasFieldOfType(block, "savedQueryId", isString) &&
                        block.savedQueryId === query.id,
                    ),
                );
                const numReferences = activeReferences.length;

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
                    <td
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      {numReferences > 0 ? (
                        <Link
                          onClick={() => setShowReferencesModal(i)}
                          className="nowrap"
                        >
                          <BiShow /> {numReferences} reference
                          {numReferences === 1 ? "" : "s"}
                        </Link>
                      ) : (
                        <Tooltip content="No dashboards reference this saved query.">
                          <span
                            className="nowrap"
                            style={{
                              color: "var(--gray-10)",
                              cursor: "not-allowed",
                            }}
                          >
                            <BiShow /> 0 references
                          </span>
                        </Tooltip>
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
                              getConfirmationContent={async () => {
                                if (activeReferences.length === 0) return null;
                                return (
                                  <div>
                                    <Callout
                                      status="warning"
                                      mb="2"
                                    >{`This saved query is in use by ${
                                      activeReferences.length
                                    } dashboard${
                                      activeReferences.length === 1 ? "" : "s"
                                    }. If deleted, linked SQL Explorer blocks will lose their visualizations.`}</Callout>
                                    <ul>
                                      {activeReferences.map((dashId) => {
                                        const dashboard =
                                          dashboardsMap.get(dashId);
                                        if (!dashboard) return null;
                                        return (
                                          <li key={dashId}>
                                            <Link
                                              href={
                                                dashboard.experimentId
                                                  ? `/experiment/${dashboard.experimentId}#dashboards/${dashId}`
                                                  : `/product-analytics/dashboards/${dashId}`
                                              }
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
        </div>
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
