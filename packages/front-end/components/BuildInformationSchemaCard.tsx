import { useState } from "react";
import { useAuth } from "@/services/auth";
import LoadingSpinner from "./LoadingSpinner";

export default function BuildInformationSchemaCard({
  datasourceId,
  mutate,
}: {
  datasourceId: string;
  mutate: () => void;
}) {
  const [fetching, setFetching] = useState(status === "PENDING");
  const [error, setError] = useState<null | string>(null);
  const { apiCall } = useAuth();

  let fetchCount = 1;

  async function pollStatus() {
    const interval = fetchCount * 1000;

    if (fetchCount === 8) {
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
      fetchCount = fetchCount * 2;
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
        method: "POST",
      });
      pollStatus();
    } catch (e) {
      setFetching(false);
      setError(e.message);
    }
  }
  return (
    <div>
      <div className="alert alert-info">
        <div>
          {fetching ? (
            <span>
              We&apos;re generating the information schema for this datasource.
              This may take a minute, depending on the size of the datasource.
            </span>
          ) : (
            <span>
              Need help building your query? Click the button below to get
              insight into what tables and columns are available in the
              datasource.
            </span>
          )}
        </div>
        <button
          disabled={fetching}
          className="mt-2 btn btn-primary"
          onClick={async () => onClick()}
        >
          {fetching && <LoadingSpinner />} Generate Information Schema
        </button>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
    </div>
  );
}
