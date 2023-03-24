import { useEffect, useState } from "react";
import { InformationSchemaInterface } from "@/../back-end/src/types/Integration";
import { useAuth } from "@/services/auth";
import LoadingSpinner from "../LoadingSpinner";

export default function BuildInformationSchemaCard({
  datasourceId,
  mutate,
  informationSchema,
}: {
  datasourceId: string;
  mutate: () => void;
  informationSchema: InformationSchemaInterface;
}) {
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const { apiCall } = useAuth();
  const [retryCount, setRetryCount] = useState(1);

  async function onClick() {
    setError(null);
    try {
      await apiCall<{
        status: number;
        message?: string;
      }>(`/datasource/${datasourceId}/schema`, {
        method: "POST",
      });
      setFetching(true);
    } catch (e) {
      setFetching(false);
      setError(e.message);
    }
  }

  useEffect(() => {
    if (fetching) {
      if (
        retryCount > 1 &&
        retryCount < 8 &&
        informationSchema?.status === "COMPLETE"
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
  }, [fetching, mutate, retryCount, informationSchema]);

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
          onClick={async (e) => {
            e.preventDefault();
            onClick();
          }}
        >
          {fetching && <LoadingSpinner />} Generate Information Schema
        </button>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
    </div>
  );
}
