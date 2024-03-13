import { InformationSchemaInterface } from "@back-end/src/types/Integration";
import { FaDatabase, FaRedo } from "react-icons/fa";
import { useAuth } from "@front-end/services/auth";
import Tooltip from "@front-end/components/Tooltip/Tooltip";
import LoadingSpinner from "@front-end/components/LoadingSpinner";

export default function SchemaBrowserWrapper({
  children,
  datasourceName,
  datasourceId,
  informationSchema,
  setFetching,
  setError,
  fetching,
}: {
  children: React.ReactNode;
  datasourceName: string;
  datasourceId: string;
  informationSchema: InformationSchemaInterface;
  setError: (error: string) => void;
  setFetching: (fetching: boolean) => void;
  fetching: boolean;
}) {
  const { apiCall } = useAuth();

  return (
    <div className="d-flex flex-column pt-2" style={{ flex: 1, height: "50%" }}>
      <div className="d-flex justify-content-between border-bottom px-2">
        <label className="font-weight-bold mb-1 d-flex align-items-center">
          <FaDatabase />
          <span className="pl-1">{datasourceName}</span>
        </label>
        {informationSchema && !informationSchema.error && (
          <label>
            <Tooltip
              body={`Last Updated: ${new Date(
                informationSchema.dateUpdated
              ).toLocaleString()}`}
              tipPosition="top"
            >
              <button
                className="btn btn-link p-0 text-secondary"
                disabled={informationSchema.status === "PENDING"}
                onClick={async (e) => {
                  e.preventDefault();
                  // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
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
      {children}
    </div>
  );
}
