import { useState } from "react";
import { useAuth } from "@/services/auth";
import LoadingSpinner from "./LoadingSpinner";

export default function PendingInformationSchemaCard({
  datasourceId,
  mutate,
}: {
  datasourceId: string;
  mutate: () => void;
}) {
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<null | string>(null);
  const { apiCall } = useAuth();

  let retryCount = 1;

  async function pollStatus() {
    const interval = retryCount * 1000;

    if (fetching) {
      if (retryCount >= 8) {
        setFetching(false);
        setError(
          "This query is taking quite a while. We're building this in the background. Feel free to leave this page and check back in a few minutes."
        );
        return;
      }

      setTimeout(async () => {
        const res = await apiCall<{ status: number; isComplete: boolean }>(
          `/datasource/${datasourceId}/schema/status`,
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
  }

  pollStatus();
  return (
    <div>
      {!error ? (
        <div className="alert alert-info d-flex align-items-center">
          <div>
            We&apos;re generating the information schema for this datasource.
            This may take a minute, depending on the size of the datasource.
          </div>
          <button disabled={true} className="btn btn-link">
            {fetching && <LoadingSpinner />} Checking Status
          </button>
        </div>
      ) : (
        <div className="alert alert-danger">{error}</div>
      )}
    </div>
  );
}
