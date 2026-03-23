import { InformationSchemaInterface } from "shared/types/integrations";
import { FaDatabase, FaFilter, FaRedo } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import Field from "@/components/Forms/Field";
import { AreaWithHeader } from "./SqlExplorerModal";

export default function SchemaBrowserWrapper({
  children,
  datasourceName,
  datasourceId,
  informationSchema,
  canRunQueries,
  setFetching,
  setError,
  fetching,
  showTableFilter,
  tableFilter,
  onToggleTableFilter,
  onTableFilterChange,
}: {
  children: React.ReactNode;
  datasourceName: string;
  datasourceId: string;
  informationSchema?: InformationSchemaInterface;
  setError: (error: string | null) => void;
  setFetching: (fetching: boolean) => void;
  canRunQueries: boolean;
  fetching: boolean;
  showTableFilter: boolean;
  tableFilter: string;
  onToggleTableFilter: () => void;
  onTableFilterChange: (value: string) => void;
}) {
  const { apiCall } = useAuth();

  return (
    <AreaWithHeader
      backgroundColor="var(--color-surface)"
      header={
        <>
          <div className="d-flex justify-content-between px-2">
            <label className="font-weight-bold mb-1 d-flex align-items-center">
              <FaDatabase className="mr-2" />
              <span className="pl-1">{datasourceName}</span>
            </label>
            {informationSchema && !informationSchema.error && (
              <div className="d-flex align-items-center pl-5">
                <Tooltip
                  body="Filter databases, schemas, and tables"
                  tipPosition="top"
                >
                  <button
                    className={`btn btn-link p-0 ${
                      showTableFilter ? "text-primary" : "text-secondary"
                    }`}
                    onClick={(e) => {
                      e.preventDefault();
                      onToggleTableFilter();
                    }}
                    aria-label="Toggle filter"
                    title="Add filter..."
                  >
                    <FaFilter />
                  </button>
                </Tooltip>
                <label className="ml-3 mb-0">
                  <Tooltip
                    body={
                      <div>
                        <div>
                          {`Last Updated: ${new Date(
                            informationSchema.dateUpdated,
                          ).toLocaleString()}`}
                        </div>
                        {!canRunQueries ? (
                          <div className="alert alert-warning mt-2">
                            You do not have permission to refresh this
                            information schema.
                          </div>
                        ) : null}
                      </div>
                    }
                    tipPosition="top"
                  >
                    <button
                      className="btn btn-link p-0 text-secondary"
                      disabled={fetching || !canRunQueries}
                      onClick={async (e) => {
                        e.preventDefault();
                        setError(null);
                        try {
                          await apiCall<{
                            status: number;
                            message?: string;
                          }>(`/datasource/${datasourceId}/schema`, {
                            method: "PUT",
                            body: JSON.stringify({
                              informationSchemaId: informationSchema.id,
                            }),
                          });
                          setFetching(true);
                        } catch (e) {
                          setError(e.message);
                        }
                      }}
                    >
                      {fetching ? <LoadingSpinner /> : <FaRedo />}
                    </button>
                  </Tooltip>
                </label>
              </div>
            )}
          </div>
          {showTableFilter && (
            <div className="px-2 pb-2 d-flex align-items-center">
              <Field
                type="search"
                value={tableFilter}
                onChange={(e) => onTableFilterChange(e.target.value)}
                placeholder="Search..."
                containerClassName="mb-0 flex-grow-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                  }
                }}
              />
            </div>
          )}
        </>
      }
    >
      {children}
    </AreaWithHeader>
  );
}
