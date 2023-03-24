import { InformationSchemaInterface } from "@/../back-end/src/types/Integration";
import { FaDatabase, FaRedo } from "react-icons/fa";
import { useEffect, useState } from "react";
import { useAuth } from "@/services/auth";
import Tooltip from "../Tooltip/Tooltip";
import LoadingSpinner from "../LoadingSpinner";

export default function SchemaBrowserWrapper({
  children,
  datasourceName,
  datasourceId,
  informationSchema,
  mutate,
  setError,
}: {
  children: React.ReactNode;
  datasourceName: string;
  datasourceId: string;
  informationSchema: InformationSchemaInterface;
  mutate: () => void;
  setError: (error: string) => void;
}) {
  const { apiCall } = useAuth();
  const [fetching, setFetching] = useState(false);
  const [retryCount, setRetryCount] = useState(1);

  useEffect(() => {
    if (fetching) {
      if (
        retryCount > 1 &&
        retryCount < 8 &&
        informationSchema.status === "COMPLETE"
      ) {
        setFetching(false);
        setRetryCount(1);
      } else if (retryCount > 8) {
        setFetching(false);
        setError(
          "This query is taking quite a while. We're building this in the background. Feel free to leave this page and check back in a few minutes."
        );
        setRetryCount(1);
      } else {
        const timer = setTimeout(() => {
          mutate();
          setRetryCount(retryCount * 2);
        }, retryCount * 1000);
        return () => {
          clearTimeout(timer);
        };
      }
    }
  }, [fetching, mutate, retryCount, informationSchema, setError]);

  return (
    <div className="d-flex flex-column">
      <div className="d-flex justify-content-between">
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
