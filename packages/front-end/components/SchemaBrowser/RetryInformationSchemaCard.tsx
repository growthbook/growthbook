import { useEffect, useState } from "react";
import { InformationSchemaInterface } from "@/../back-end/src/types/Integration";
import { useAuth } from "@/services/auth";
import LoadingSpinner from "../LoadingSpinner";

export default function RetryInformationSchemaCard({
  datasourceId,
  mutate,
  informationSchema,
}: {
  datasourceId: string;
  mutate: () => void;
  informationSchema: InformationSchemaInterface;
}) {
  const [error, setError] = useState<null | string>(null);
  const { apiCall } = useAuth();
  const [fetching, setFetching] = useState(false);
  const [retryCount, setRetryCount] = useState(1);

  async function onClick() {
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
  }

  useEffect(() => {
    if (fetching) {
      if (retryCount > 8) {
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
  }, [fetching, mutate, retryCount]);

  return (
    <div>
      <div className="alert alert-warning d-flex align-items-center">
        <div>
          {fetching ? (
            <span>
              We&apos;re generating the information schema for this datasource.
              This may take a minute, depending on the size of the datasource.
            </span>
          ) : (
            <span>{informationSchema.error.message}</span>
          )}
        </div>
        <button
          disabled={fetching}
          className="btn btn-link"
          onClick={async () => onClick()}
        >
          {fetching && <LoadingSpinner />} Retry
        </button>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
    </div>
  );
}
