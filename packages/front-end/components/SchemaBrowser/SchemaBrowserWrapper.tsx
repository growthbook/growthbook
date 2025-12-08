import { InformationSchemaInterface } from "shared/types/integrations";
import { FaDatabase, FaRedo } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
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
}: {
  children: React.ReactNode;
  datasourceName: string;
  datasourceId: string;
  informationSchema?: InformationSchemaInterface;
  setError: (error: string | null) => void;
  setFetching: (fetching: boolean) => void;
  canRunQueries: boolean;
  fetching: boolean;
}) {
  const { apiCall } = useAuth();

  return (
    <AreaWithHeader
      backgroundColor="var(--color-surface)"
      header={
        <div className="d-flex justify-content-between px-2">
          <label className="font-weight-bold mb-1 d-flex align-items-center">
            <FaDatabase className="mr-2" />
            <span className="pl-1">{datasourceName}</span>
          </label>
          {informationSchema && !informationSchema.error && (
            <label className="pl-5">
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
                        You do not have permission to refresh this information
                        schema.
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
          )}
        </div>
      }
    >
      {children}
    </AreaWithHeader>
  );
}
