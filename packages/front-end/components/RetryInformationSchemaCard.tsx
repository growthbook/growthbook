import { useState } from "react";
import { InformationSchemaError } from "@/../back-end/src/types/Integration";
import { useAuth } from "@/services/auth";
import LoadingSpinner from "./LoadingSpinner";

export default function RetryInformationSchemaCard({
  datasourceId,
  mutate,
  informationSchemaError,
  informationSchemaId,
}: {
  datasourceId: string;
  mutate: () => void;
  informationSchemaError: InformationSchemaError;
  informationSchemaId: string;
}) {
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const { apiCall } = useAuth();

  let retryCount = 1;

  async function pollStatus() {
    const interval = retryCount * 1000;

    if (retryCount >= 8) {
      setFetching(false);
      setError(
        "This query is taking quite a while. We're building this in the background. Feel free to leave this page and check back in a few minutes."
      );
      return;
    }

    setTimeout(async () => {
      const res = await apiCall<{ status: number; isComplete: boolean }>(
        `/datasource/${datasourceId}/informationSchema/status`,
        {
          method: "GET",
        }
      );
      if (res.isComplete) {
        setFetching(false);
        mutate();
        return;
      }
      retryCount = retryCount * 2;
      pollStatus();
    }, interval);
  }

  async function onClick() {
    setFetching(true);
    setError(null);
    try {
      await apiCall<{
        status: number;
        message?: string;
      }>(`/datasource/${datasourceId}/informationSchema`, {
        method: "PUT",
        body: JSON.stringify({
          informationSchemaId: informationSchemaId,
        }),
      });
      pollStatus();
    } catch (e) {
      setFetching(false);
      setError(e.message);
    }
  }
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
            <span>{informationSchemaError.message}</span>
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
